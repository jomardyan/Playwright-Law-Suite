import type { BrowserContext, Page } from "playwright";
import type { BrowserManager } from "../../engine/BrowserManager.js";
import type { ConsentSimulationConfig } from "../../config/schema.js";
import type { CapturedState, ConsentState } from "../../engine/types.js";
import { extractDomain } from "../../utils/domainClassifier.js";
import { logger } from "../../utils/logger.js";

interface TrackedRequest {
  url: string;
  domain: string;
  resourceType: string;
  timestamp: string;
}

async function captureBrowserState(page: Page, requests: TrackedRequest[], consentState: ConsentState): Promise<CapturedState> {
  const cookies = await page.context().cookies();
  const storage = await page
    .evaluate(() => ({
      localStorage: Object.keys(window.localStorage ?? {}),
      sessionStorage: Object.keys(window.sessionStorage ?? {}),
    }))
    .catch(() => ({ localStorage: [] as string[], sessionStorage: [] as string[] }));

  return {
    consentState,
    url: page.url(),
    cookies: cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    })),
    localStorageKeys: storage.localStorage,
    sessionStorageKeys: storage.sessionStorage,
    // Snapshot, not a live reference: the request-tracking listener stays
    // attached to the context after this call returns (e.g. through the
    // withdrawal phase), and would otherwise keep mutating this array.
    thirdPartyRequests: [...requests],
  };
}

function attachRequestTracking(context: BrowserContext, requests: TrackedRequest[]): void {
  context.on("request", (request) => {
    requests.push({
      url: request.url(),
      domain: extractDomain(request.url()),
      resourceType: request.resourceType(),
      timestamp: new Date().toISOString(),
    });
  });
}

async function clickFirstMatch(page: Page, selectors: string[] | undefined, timeoutMs = 4000): Promise<boolean> {
  for (const selector of selectors ?? []) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) continue;
      await locator.click({ timeout: timeoutMs });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export interface ConsentFlowResult {
  states: CapturedState[];
  /**
   * True when the GPC probe ran. When false, the `gpc-signal` state is absent
   * from `states` and rules must report `not-evaluated`, never a pass.
   */
  gpcProbeRan: boolean;
  bannerAcceptControlFound: boolean;
  bannerRejectControlFound: boolean;
  withdrawalControlFound: boolean;
  /** Requests observed on the very first paint, before any consent interaction. */
  requestsBeforeAnyConsentAction: TrackedRequest[];
}

/**
 * Simulates a new visitor with a clean profile across the consent states
 * called out in the spec: initial (no consent given), reject-all, accept-all,
 * and optionally consent withdrawal. Each state uses a fresh browser context
 * so no cookie/storage state leaks between simulated visitors.
 */
export class CookieScanner {
  constructor(private readonly browserManager: BrowserManager, private readonly config: ConsentSimulationConfig) {}

  async runConsentFlow(url: string): Promise<ConsentFlowResult> {
    const states: CapturedState[] = [];
    let gpcProbeRan = false;

    // --- Initial visit: no interaction with any consent control. ---
    const initialContext = await this.browserManager.newContext();
    const initialRequests: TrackedRequest[] = [];
    attachRequestTracking(initialContext, initialRequests);
    const initialPage = await initialContext.newPage();
    await initialPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);
    await initialPage.waitForTimeout(1500);
    const initialState = await captureBrowserState(initialPage, initialRequests, "before-consent");
    states.push(initialState);
    await initialContext.close();

    let bannerRejectControlFound = false;
    let bannerAcceptControlFound = false;
    let withdrawalControlFound = false;

    // --- Universal opt-out signal (Global Privacy Control) ---
    // A separate simulated visitor that asserts GPC and takes no other
    // consent action, so a rule can compare it against the plain
    // before-consent visit. Both halves of the signal are sent: the
    // `Sec-GPC: 1` request header and `navigator.globalPrivacyControl`.
    if (this.config.probeGlobalPrivacyControl !== false) {
      const gpcContext = await this.browserManager.newContext({ globalPrivacyControl: true });
      const gpcRequests: TrackedRequest[] = [];
      attachRequestTracking(gpcContext, gpcRequests);
      const gpcPage = await gpcContext.newPage();
      await gpcPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);
      await gpcPage.waitForTimeout(1500);
      states.push(await captureBrowserState(gpcPage, gpcRequests, "gpc-signal"));
      gpcProbeRan = true;
      await gpcContext.close();
    }

    // --- Reject-all ---
    const rejectContext = await this.browserManager.newContext();
    const rejectRequests: TrackedRequest[] = [];
    attachRequestTracking(rejectContext, rejectRequests);
    const rejectPage = await rejectContext.newPage();
    await rejectPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);
    bannerRejectControlFound = await clickFirstMatch(rejectPage, this.config.rejectSelectors);
    await rejectPage.waitForTimeout(1500);
    states.push(await captureBrowserState(rejectPage, rejectRequests, "reject-all"));
    await rejectContext.close();

    // --- Accept-all ---
    const acceptContext = await this.browserManager.newContext();
    const acceptRequests: TrackedRequest[] = [];
    attachRequestTracking(acceptContext, acceptRequests);
    const acceptPage = await acceptContext.newPage();
    await acceptPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);
    bannerAcceptControlFound = await clickFirstMatch(acceptPage, this.config.acceptSelectors);
    await acceptPage.waitForTimeout(1500);
    states.push(await captureBrowserState(acceptPage, acceptRequests, "accept-all"));

    // --- Withdrawal (reuse the accept-all context/session) ---
    if (this.config.testWithdrawal) {
      const withdrawalRequests: TrackedRequest[] = [];
      attachRequestTracking(acceptContext, withdrawalRequests);
      const manageLink = acceptPage.locator(
        "text=/manage cookies|cookie settings|privacy settings|manage consent/i"
      ).first();
      if ((await manageLink.count().catch(() => 0)) > 0) {
        try {
          await manageLink.click({ timeout: 4000 });
          withdrawalControlFound = await clickFirstMatch(acceptPage, this.config.rejectSelectors);
          await acceptPage.waitForTimeout(1500);
          states.push(await captureBrowserState(acceptPage, withdrawalRequests, "withdrawn"));
        } catch (error) {
          logger.debug("Consent withdrawal flow failed", error);
        }
      }
    }
    await acceptContext.close();

    return {
      states,
      gpcProbeRan,
      bannerAcceptControlFound,
      bannerRejectControlFound,
      withdrawalControlFound,
      requestsBeforeAnyConsentAction: initialRequests,
    };
  }
}
