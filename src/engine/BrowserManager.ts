import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type LaunchOptions } from "playwright";
import type { AuthenticationConfig, BrowserConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

const ENGINES: Record<NonNullable<BrowserConfig["engine"]>, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

/**
 * Chromium's setuid sandbox cannot run as uid 0, which is the default in most
 * container images. Rather than making every containerised user discover
 * this through an opaque launch failure, the flag is added automatically -
 * and logged, because disabling the sandbox is a real trade-off and should
 * never happen silently.
 */
function containerSandboxArgs(config: BrowserConfig): string[] {
  if (config.engine && config.engine !== "chromium") return [];
  if ((config.args ?? []).some((arg) => arg.startsWith("--no-sandbox"))) return [];
  if (process.env.UNIVERSCAN_NO_SANDBOX === "0") return [];

  const forced = process.env.UNIVERSCAN_NO_SANDBOX === "1";
  const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!forced && !runningAsRoot) return [];

  logger.warn(
    "Adding --no-sandbox: Chromium's sandbox cannot run as root, which is the default in most containers. Set UNIVERSCAN_NO_SANDBOX=0 to opt out, or run the scan as a non-root user to keep the sandbox."
  );
  return ["--no-sandbox", "--disable-dev-shm-usage"];
}

/** Resolves proxy credentials from the environment; they never live in a config file. */
function resolveProxy(config: BrowserConfig): LaunchOptions["proxy"] {
  const proxy = config.proxy;
  if (!proxy?.server) return undefined;
  const username = proxy.usernameEnvVar ? process.env[proxy.usernameEnvVar] : undefined;
  const password = proxy.passwordEnvVar ? process.env[proxy.passwordEnvVar] : undefined;
  if (proxy.usernameEnvVar && !username) {
    logger.warn(`Proxy username env var ${proxy.usernameEnvVar} is not set; connecting without credentials.`);
  }
  return { server: proxy.server, bypass: proxy.bypass, username, password };
}

/**
 * Owns the Playwright browser lifecycle. One BrowserManager per scan; callers
 * create one or more BrowserContexts from it (e.g. one per consent state so
 * cookie/storage state never leaks between simulated visitors).
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private readonly config: BrowserConfig;

  constructor(config: BrowserConfig = {}) {
    this.config = config;
  }

  /** The engine actually in use, for reporting and for capability decisions. */
  get engine(): NonNullable<BrowserConfig["engine"]> {
    return this.config.engine ?? "chromium";
  }

  get navigationTimeoutMs(): number {
    return this.config.navigationTimeoutMs ?? 30_000;
  }

  async launch(): Promise<void> {
    if (this.browser) return;
    // UNIVERSCAN_CHROMIUM_PATH lets a CI/sandbox environment point at a
    // pre-installed browser instead of the one Playwright would download;
    // an explicit config value wins over it.
    const executablePath = this.config.executablePath || process.env.UNIVERSCAN_CHROMIUM_PATH || undefined;
    const browserType = ENGINES[this.engine];

    const options: LaunchOptions = {
      headless: this.config.headless ?? true,
      executablePath,
      channel: this.config.channel,
      args: [...containerSandboxArgs(this.config), ...(this.config.args ?? [])],
      timeout: this.config.launchTimeoutMs ?? 60_000,
      proxy: resolveProxy(this.config),
    };

    try {
      this.browser = await browserType.launch(options);
    } catch (error) {
      // The default message points at Playwright internals; this one points
      // at what the operator can actually do about it.
      const detail = (error as Error).message.split("\n")[0];
      throw new Error(
        `Could not launch ${this.engine}: ${detail}. Install it with 'npx playwright install --with-deps ${this.engine}', point browser.executablePath (or UNIVERSCAN_CHROMIUM_PATH) at an existing binary, or set browser.channel to use a system browser.`
      );
    }
    logger.debug(`Launched ${this.engine}${this.config.channel ? ` (channel ${this.config.channel})` : ""}`);
  }

  /**
   * Creates an isolated browser context.
   *
   * `globalPrivacyControl` asserts a universal opt-out signal for the whole
   * context, both halves of it: the `Sec-GPC: 1` request header on every
   * request, and `navigator.globalPrivacyControl === true` for scripts that
   * read the DOM property instead.
   */
  async newContext(options?: {
    storageStatePath?: string;
    globalPrivacyControl?: boolean;
    viewport?: { width: number; height: number };
    isMobile?: boolean;
    locale?: string;
  }): Promise<BrowserContext> {
    if (!this.browser) throw new Error("BrowserManager.launch() must be called first");
    const context = await this.browser.newContext({
      storageState: options?.storageStatePath,
      viewport: options?.viewport ?? { width: 1366, height: 900 },
      // isMobile and hasTouch are Chromium-only; passing them to Firefox or
      // WebKit throws rather than being ignored.
      isMobile: this.engine === "chromium" ? options?.isMobile : undefined,
      hasTouch: this.engine === "chromium" ? options?.isMobile : undefined,
      locale: options?.locale,
      ignoreHTTPSErrors: this.config.ignoreHTTPSErrors ?? false,
      extraHTTPHeaders: options?.globalPrivacyControl ? { "Sec-GPC": "1" } : undefined,
    });
    context.setDefaultNavigationTimeout(this.navigationTimeoutMs);
    if (options?.globalPrivacyControl) {
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
          get: () => true,
          configurable: true,
        });
      });
    }
    return context;
  }

  /**
   * Produces an authenticated context per the scan's AuthenticationConfig.
   * Credentials are read from environment variables only; they are never
   * written into config files, findings, or reports.
   */
  async newAuthenticatedContext(auth: AuthenticationConfig | undefined): Promise<BrowserContext> {
    if (!auth || auth.method === "none") {
      return this.newContext();
    }

    if (auth.method === "storage-state") {
      if (!auth.storageStatePath) {
        throw new Error("authentication.storageStatePath is required for method 'storage-state'");
      }
      return this.newContext({ storageStatePath: auth.storageStatePath });
    }

    if (auth.method === "password") {
      const username = auth.usernameEnvVar ? process.env[auth.usernameEnvVar] : undefined;
      const password = auth.passwordEnvVar ? process.env[auth.passwordEnvVar] : undefined;
      if (!username || !password) {
        throw new Error(
          `Authentication credentials not found in environment variables ${auth.usernameEnvVar}/${auth.passwordEnvVar}`
        );
      }
      const context = await this.newContext();
      if (auth.loginUrl) {
        const page = await context.newPage();
        await page.goto(auth.loginUrl, { waitUntil: "domcontentloaded" });
        const userField = page.locator('input[type="email"], input[type="text"], input[name*="user" i]').first();
        const passField = page.locator('input[type="password"]').first();
        await userField.fill(username);
        await passField.fill(password);
        await Promise.all([
          page.waitForLoadState("networkidle").catch(() => undefined),
          passField.press("Enter"),
        ]);
        await page.close();
      } else {
        logger.warn("authentication.method is 'password' but no loginUrl was provided; skipping login step");
      }
      return context;
    }

    if (auth.method === "custom-script") {
      if (!auth.customScriptPath) {
        throw new Error("authentication.customScriptPath is required for method 'custom-script'");
      }
      const context = await this.newContext();
      const mod = (await import(auth.customScriptPath)) as { authenticate?: (ctx: BrowserContext) => Promise<void> };
      if (typeof mod.authenticate !== "function") {
        throw new Error(`${auth.customScriptPath} must export an async 'authenticate(context)' function`);
      }
      await mod.authenticate(context);
      return context;
    }

    return this.newContext();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
