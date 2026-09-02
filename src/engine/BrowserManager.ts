import { chromium, type Browser, type BrowserContext } from "playwright";
import type { AuthenticationConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

/**
 * Owns the Playwright browser lifecycle. One BrowserManager per scan; callers
 * create one or more BrowserContexts from it (e.g. one per consent state so
 * cookie/storage state never leaks between simulated visitors).
 */
export class BrowserManager {
  private browser: Browser | null = null;

  async launch(): Promise<void> {
    if (this.browser) return;
    // UNIVERSCAN_CHROMIUM_PATH lets a CI/sandbox environment point at a
    // pre-installed Chromium build instead of the one Playwright would try
    // to download; normal installs should leave this unset.
    const executablePath = process.env.UNIVERSCAN_CHROMIUM_PATH || undefined;
    this.browser = await chromium.launch({ headless: true, executablePath });
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
      isMobile: options?.isMobile,
      hasTouch: options?.isMobile,
      locale: options?.locale,
      extraHTTPHeaders: options?.globalPrivacyControl ? { "Sec-GPC": "1" } : undefined,
    });
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
