import { existsSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Resolves the Chromium the end-to-end suites launch, from three places in
 * order of precedence: an explicit UNIVERSCAN_CHROMIUM_PATH, the pinned
 * binary a sandbox image drops at /opt/pw-browsers/chromium, and whatever
 * `playwright install chromium` put in Playwright's own browser directory,
 * which is the CI case. Each suite used to hardcode the sandbox path alone,
 * so on a CI runner every one of them skipped itself and the browser-backed
 * half of the suite never ran.
 */
function resolveChromium(): string | undefined {
  const explicit = process.env.UNIVERSCAN_CHROMIUM_PATH;
  if (explicit) return existsSync(explicit) ? explicit : undefined;

  const sandboxPath = "/opt/pw-browsers/chromium";
  if (existsSync(sandboxPath)) return sandboxPath;

  try {
    // Points at the revision this Playwright build expects, which is only
    // present once the browser has been installed.
    const installed = chromium.executablePath();
    if (installed && existsSync(installed)) return installed;
  } catch {
    // Thrown when no browser is registered for this platform at all.
  }

  return undefined;
}

const resolved = resolveChromium();

/** Whether a browser is available; the e2e suites skip themselves when it is not. */
export const hasLocalChromium = resolved !== undefined;

if (resolved) {
  process.env.UNIVERSCAN_CHROMIUM_PATH = resolved;
} else if (process.env.UNIVERSCAN_REQUIRE_CHROMIUM === "1") {
  // CI sets this so that a failed browser install surfaces as a red suite
  // rather than as a quietly reduced test count.
  throw new Error(
    "UNIVERSCAN_REQUIRE_CHROMIUM=1, but no Chromium could be found. Install one with " +
      "'npx playwright install --with-deps chromium', or point UNIVERSCAN_CHROMIUM_PATH at an existing binary."
  );
}
