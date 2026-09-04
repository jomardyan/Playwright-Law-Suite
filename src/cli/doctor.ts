import { access, constants, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UniVerscanConfig } from "../config/schema.js";
import { BrowserManager } from "../engine/BrowserManager.js";
import { PackLoader } from "../packs/PackLoader.js";

/**
 * Environment preflight.
 *
 * Integration failures in this tool are nearly always environmental - no
 * browser, a sandbox that cannot start as root, a proxy the browser does not
 * know about, an unwritable output directory. Each of those surfaces as a
 * different opaque error deep inside a scan. This checks them up front and
 * says what to do about each one.
 */

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it. Omitted when the check passed. */
  hint?: string;
}

/**
 * Lowest Node the project supports, and it must match `engines.node` in
 * package.json: a floor lower than that reports an environment as healthy
 * that npm will refuse to install into. Node 18 reached end of life in April
 * 2025; 20 is the oldest line CI exercises.
 */
export const MINIMUM_NODE_MAJOR = 20;

export function checkNodeVersion(version: string = process.version): CheckResult {
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  if (Number.isNaN(major)) {
    return { name: "Node.js", status: "warn", detail: `Could not parse version "${version}".` };
  }
  if (major < MINIMUM_NODE_MAJOR) {
    return {
      name: "Node.js",
      status: "fail",
      detail: `${version} is below the supported floor.`,
      hint: `UniVerscan needs Node ${MINIMUM_NODE_MAJOR} or newer for global fetch and AbortSignal.timeout.`,
    };
  }
  if (major % 2 !== 0) {
    return {
      name: "Node.js",
      status: "warn",
      detail: `${version} is an odd-numbered release, which is not an LTS line.`,
      hint: "Prefer an even-numbered LTS release for CI.",
    };
  }
  return { name: "Node.js", status: "ok", detail: version };
}

/**
 * Chromium's setuid sandbox cannot run as uid 0. This is the single most
 * common containerised failure, and the message it produces on its own does
 * not mention root at all.
 *
 * `getuid` is passed in rather than defaulted, so `null` unambiguously means
 * "this platform has no uid" (Windows) instead of colliding with "use the
 * real one". A default parameter cannot express that difference.
 */
export function checkSandbox(getuid: (() => number) | null, env: NodeJS.ProcessEnv): CheckResult {
  const isRoot = typeof getuid === "function" && getuid() === 0;
  if (!isRoot) return { name: "Browser sandbox", status: "ok", detail: "Not running as root; sandbox stays enabled." };
  if (env.UNIVERSCAN_NO_SANDBOX === "0") {
    return {
      name: "Browser sandbox",
      status: "fail",
      detail: "Running as root with UNIVERSCAN_NO_SANDBOX=0, so Chromium will refuse to start.",
      hint: "Run as a non-root user, or unset UNIVERSCAN_NO_SANDBOX to let --no-sandbox be added automatically.",
    };
  }
  return {
    name: "Browser sandbox",
    status: "warn",
    detail: "Running as root, so --no-sandbox will be added automatically.",
    hint: "Running the scan as a non-root user keeps the sandbox on. In Docker, add a USER line.",
  };
}

/**
 * Node's global `fetch` does not honour proxy environment variables, and the
 * browser only honours a proxy that was configured explicitly. A proxied
 * network with neither set will fail in confusing, partial ways.
 */
export function checkProxy(config: UniVerscanConfig, env: NodeJS.ProcessEnv = process.env): CheckResult {
  const envProxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  const configured = config.browser?.proxy?.server;

  if (configured) {
    return { name: "Proxy", status: "ok", detail: `Browser traffic routes through ${configured}.` };
  }
  if (envProxy) {
    return {
      name: "Proxy",
      status: "warn",
      detail: `A proxy is set in the environment (${envProxy}) but not in the config, so browser traffic will bypass it.`,
      hint: 'Set browser.proxy.server to the same value so the scan sees the network your users do.',
    };
  }
  return { name: "Proxy", status: "ok", detail: "No proxy configured or detected." };
}

export function checkCaBundle(env: NodeJS.ProcessEnv = process.env): CheckResult {
  // Order matters: verification being disabled outranks a configured CA
  // bundle. Checking the reassuring condition first would let the dangerous
  // one hide behind it, which is how this was originally written.
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return {
      name: "TLS trust",
      status: "fail",
      detail: "NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification process-wide.",
      hint: "Unset it and add your corporate root via NODE_EXTRA_CA_CERTS. A scan that ignores certificates cannot report on transport security.",
    };
  }
  if (env.NODE_EXTRA_CA_CERTS) {
    return { name: "TLS trust", status: "ok", detail: `NODE_EXTRA_CA_CERTS is set (${env.NODE_EXTRA_CA_CERTS}).` };
  }
  return { name: "TLS trust", status: "ok", detail: "Using the default trust store." };
}

export async function checkOutputDirectory(outputDir: string): Promise<CheckResult> {
  try {
    const probe = await mkdtemp(join(tmpdir(), "universcan-probe-"));
    await rm(probe, { recursive: true, force: true });
  } catch (error) {
    return {
      name: "Temp directory",
      status: "fail",
      detail: `Cannot write to the system temp directory: ${(error as Error).message}`,
      hint: "Set TMPDIR to a writable path.",
    };
  }

  try {
    await access(outputDir, constants.W_OK);
    return { name: "Output directory", status: "ok", detail: `${outputDir} is writable.` };
  } catch {
    // Not existing yet is fine - the reporters create it. Only an existing
    // but unwritable directory is a problem.
    try {
      await access(outputDir, constants.F_OK);
      return {
        name: "Output directory",
        status: "fail",
        detail: `${outputDir} exists but is not writable.`,
        hint: "Fix the permissions, or point --out somewhere else.",
      };
    } catch {
      return { name: "Output directory", status: "ok", detail: `${outputDir} does not exist yet and will be created.` };
    }
  }
}

/** Actually launches the browser, since nothing else proves it will start. */
export async function checkBrowser(config: UniVerscanConfig): Promise<CheckResult> {
  const manager = new BrowserManager(config.browser ?? {});
  const engine = manager.engine;
  try {
    await manager.launch();
    const context = await manager.newContext();
    const page = await context.newPage();
    await page.setContent("<!doctype html><title>probe</title><p>ok</p>");
    const title = await page.title();
    await context.close();
    await manager.close();
    if (title !== "probe") {
      return { name: "Browser", status: "warn", detail: `${engine} started but rendered unexpectedly.` };
    }
    return { name: "Browser", status: "ok", detail: `${engine} launches and renders.` };
  } catch (error) {
    await manager.close().catch(() => undefined);
    return {
      name: "Browser",
      status: "fail",
      detail: (error as Error).message,
      hint: `Install it with 'npx playwright install --with-deps ${engine}', or set browser.executablePath / browser.channel.`,
    };
  }
}

export async function checkPacks(config: UniVerscanConfig): Promise<CheckResult> {
  const loader = new PackLoader();
  const all = loader.listBuiltIn();
  const applicable = await loader.load(config);
  if (applicable.length === 0) {
    return {
      name: "Regulatory packs",
      status: "warn",
      detail: `${all.length} pack(s) available, but none apply to the current configuration.`,
      hint: "Set jurisdictions, or run 'universcan autoscan' to detect them.",
    };
  }
  const ruleCount = applicable.reduce((sum, pack) => sum + pack.rules.length, 0);
  return {
    name: "Regulatory packs",
    status: "ok",
    detail: `${applicable.length} of ${all.length} pack(s) apply, contributing ${ruleCount} rule(s).`,
  };
}

/** Runs every check. Ordered cheapest first so obvious problems surface fast. */
export async function runDoctor(
  config: UniVerscanConfig,
  options: { skipBrowser?: boolean } = {}
): Promise<CheckResult[]> {
  const results: CheckResult[] = [
    checkNodeVersion(),
    { name: "Platform", status: "ok", detail: `${process.platform} ${process.arch}` },
    checkSandbox(process.getuid?.bind(process) ?? null, process.env),
    checkProxy(config),
    checkCaBundle(),
    await checkOutputDirectory(config.reporting.outputDir),
    await checkPacks(config),
  ];
  if (!options.skipBrowser) results.push(await checkBrowser(config));
  return results;
}

/** Worst status present, which the CLI turns into an exit code. */
export function overallStatus(results: readonly CheckResult[]): CheckStatus {
  if (results.some((result) => result.status === "fail")) return "fail";
  if (results.some((result) => result.status === "warn")) return "warn";
  return "ok";
}
