import type { BrowserContext, Frame, Page } from "playwright";
import type { BrowserManager } from "../../engine/BrowserManager.js";
import type { ConsentSimulationConfig } from "../../config/schema.js";
import type { CapturedState, ConsentState } from "../../engine/types.js";
import { extractHttpHost } from "../../utils/domainClassifier.js";
import { logger } from "../../utils/logger.js";

interface TrackedRequest {
  url: string;
  domain: string;
  resourceType: string;
  timestamp: string;
  /** Which no-interaction visit observed this request, 1-based. */
  visit?: number;
}

/**
 * Markup that a consent banner is present, whether or not this scanner can
 * work out how to dismiss it. Distinguishing "no banner at all" from "a
 * banner whose reject control was not found" matters: the first is a
 * different finding from the second, and reporting them as one hides a site
 * that does no consent management whatsoever.
 */
const BANNER_MARKERS = [
  "#onetrust-banner-sdk",
  "#onetrust-consent-sdk",
  "#CybotCookiebotDialog",
  "#usercentrics-root",
  "#didomi-host",
  "#didomi-notice",
  "#qc-cmp2-container",
  "#truste-consent-track",
  ".cky-consent-container",
  ".osano-cm-window",
  ".cc-window",
  ".cmplz-cookiebanner",
  ".iubenda-cs-container",
  "#axeptio_overlay",
  "#termly-code-snippet-support",
  "[id*='cookie-banner' i]",
  "[class*='cookie-banner' i]",
  "[id*='cookie-consent' i]",
  "[class*='cookie-consent' i]",
  "[id*='cookie-notice' i]",
  "[class*='cookie-notice' i]",
  "[aria-label*='cookie' i][role='dialog']",
  "[role='dialog'][class*='consent' i]",
  "[data-testid*='cookie-banner' i]",
];

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

function attachRequestTracking(context: BrowserContext, requests: TrackedRequest[], visit?: number): void {
  context.on("request", (request) => {
    const url = request.url();
    // `data:`, `blob:` and extension URLs never leave the browser. Recording
    // them produced inventory entries whose "domain" was a base64 payload,
    // and inflated the recipient count in every transfer finding.
    const domain = extractHttpHost(url);
    if (!domain) return;
    requests.push({
      url,
      domain,
      resourceType: request.resourceType(),
      timestamp: new Date().toISOString(),
      ...(visit === undefined ? {} : { visit }),
    });
  });
}

/**
 * Every frame of the page, main document first.
 *
 * Consent platforms routinely render their banner inside a cross-origin
 * iframe (TrustArc, Sourcepoint and Quantcast do by default). Searching only
 * the main document therefore missed the reject control on exactly those
 * sites, and reported "an accept control but no way to refuse" against a
 * banner that had one - a false positive on a site that had done the work.
 */
function framesOf(page: Page): Frame[] {
  try {
    return page.frames();
  } catch {
    return [page.mainFrame()];
  }
}

/**
 * Finds the first control matching any of `selectors` across every frame,
 * requiring it to be visible.
 *
 * Visibility matters in both directions. A CMP leaves its markup in the DOM
 * after the banner is dismissed, so a hidden `#onetrust-reject-all-handler`
 * is not a control the visitor can use; and clicking a hidden element times
 * out, which the previous implementation could not distinguish from "no such
 * control exists".
 */
async function findVisibleControl(
  page: Page,
  selectors: string[] | undefined,
  timeoutMs: number
): Promise<{ frame: Frame; selector: string } | null> {
  for (const selector of selectors ?? []) {
    for (const frame of framesOf(page)) {
      try {
        const locator = frame.locator(selector).first();
        if ((await locator.count()) === 0) continue;
        if (!(await locator.isVisible({ timeout: timeoutMs }).catch(() => false))) continue;
        return { frame, selector };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Locates a visible control and clicks it. Reports whether each half worked. */
async function clickFirstMatch(
  page: Page,
  selectors: string[] | undefined,
  timeoutMs = 4000
): Promise<{ found: boolean; clicked: boolean }> {
  const match = await findVisibleControl(page, selectors, Math.min(timeoutMs, 1500));
  if (!match) return { found: false, clicked: false };
  try {
    await match.frame.locator(match.selector).first().click({ timeout: timeoutMs });
    return { found: true, clicked: true };
  } catch {
    // The control exists and is visible; something (an overlay, an animation)
    // stopped the click. It is still a control the visitor has, so it counts
    // as found - reporting "no reject control" here would be wrong.
    return { found: true, clicked: false };
  }
}

/** True when anything on the page looks like a consent banner. */
async function detectBanner(page: Page): Promise<boolean> {
  for (const frame of framesOf(page)) {
    for (const marker of BANNER_MARKERS) {
      const visible = await frame
        .locator(marker)
        .first()
        .isVisible({ timeout: 250 })
        .catch(() => false);
      if (visible) return true;
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
  /**
   * True when consent-banner markup was seen at all. `false` alongside
   * `bannerAcceptControlFound: false` means no consent mechanism was found;
   * `true` alongside it means a banner exists whose controls this scanner
   * could not identify, which is a prompt for a person rather than a verdict.
   *
   * Optional because a caller that built this result without running the
   * probe has no answer. `undefined` means "not established" and must never
   * be read as `false`.
   */
  bannerDetected?: boolean;
  /** True when the accept control was found but could not actually be clicked. */
  acceptControlNotClickable?: boolean;
  /**
   * Requests observed before any consent interaction, unioned across every
   * no-interaction visit. Each entry records which visit saw it.
   */
  requestsBeforeAnyConsentAction: TrackedRequest[];
  /**
   * How many no-interaction visits the pre-consent result rests on. Optional
   * so a hand-built result is not forced to claim a number; `undefined` means
   * the basis was not recorded.
   */
  beforeConsentVisits?: number;
}

/**
 * Simulates a new visitor with a clean profile across the consent states
 * called out in the spec: initial (no consent given), reject-all, accept-all,
 * and optionally consent withdrawal. Each state uses a fresh browser context
 * so no cookie/storage state leaks between simulated visitors.
 */
export class CookieScanner {
  constructor(private readonly browserManager: BrowserManager, private readonly config: ConsentSimulationConfig) {}

  private get settleMs(): number {
    return this.config.settleMs ?? 1500;
  }

  async runConsentFlow(url: string): Promise<ConsentFlowResult> {
    const states: CapturedState[] = [];
    let gpcProbeRan = false;

    // --- No-interaction visits. ---
    //
    // Repeated deliberately. A site does not load the same set of trackers on
    // every request: two consecutive scans of the same page observed 36
    // third-party services before consent and then 3, which turned a critical
    // finding into silence without anything changing on the site. The visits
    // are independent (a fresh context each time) and their observations are
    // unioned, so a tracker that fires on some loads is still reported.
    const visits = Math.max(1, Math.min(5, this.config.beforeConsentVisits ?? 2));
    const initialRequests: TrackedRequest[] = [];
    const unionCookies = new Map<string, CapturedState["cookies"][number]>();
    const unionLocal = new Set<string>();
    const unionSession = new Set<string>();
    let bannerDetected = false;
    let lastVisitedUrl = url;

    for (let visit = 1; visit <= visits; visit += 1) {
      const visitContext = await this.browserManager.newContext();
      const visitRequests: TrackedRequest[] = [];
      attachRequestTracking(visitContext, visitRequests, visit);
      const visitPage = await visitContext.newPage();
      await visitPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);
      await visitPage.waitForTimeout(this.settleMs);
      // A banner seen on any visit is a banner the site has; some sites show
      // it only to a fraction of requests.
      bannerDetected = bannerDetected || (await detectBanner(visitPage).catch(() => false));
      const state = await captureBrowserState(visitPage, visitRequests, "before-consent");
      lastVisitedUrl = state.url;
      initialRequests.push(...visitRequests);
      for (const cookie of state.cookies) unionCookies.set(`${cookie.name}|${cookie.domain}`, cookie);
      for (const key of state.localStorageKeys) unionLocal.add(key);
      for (const key of state.sessionStorageKeys) unionSession.add(key);
      await visitContext.close();
    }

    states.push({
      consentState: "before-consent",
      url: lastVisitedUrl,
      cookies: Array.from(unionCookies.values()),
      localStorageKeys: Array.from(unionLocal),
      sessionStorageKeys: Array.from(unionSession),
      thirdPartyRequests: [...initialRequests],
    });

    let bannerRejectControlFound = false;
    let bannerAcceptControlFound = false;
    let withdrawalControlFound = false;
    let acceptControlNotClickable = false;

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
      await gpcPage.waitForTimeout(this.settleMs);
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
    await rejectPage.waitForTimeout(this.settleMs);
    const rejectResult = await clickFirstMatch(rejectPage, this.config.rejectSelectors);
    bannerRejectControlFound = rejectResult.found;
    await rejectPage.waitForTimeout(this.settleMs);
    states.push(await captureBrowserState(rejectPage, rejectRequests, "reject-all"));
    await rejectContext.close();

    // --- Accept-all ---
    const acceptContext = await this.browserManager.newContext();
    const acceptRequests: TrackedRequest[] = [];
    attachRequestTracking(acceptContext, acceptRequests);
    const acceptPage = await acceptContext.newPage();
    await acceptPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);
    await acceptPage.waitForTimeout(this.settleMs);
    const acceptResult = await clickFirstMatch(acceptPage, this.config.acceptSelectors);
    bannerAcceptControlFound = acceptResult.found;
    acceptControlNotClickable = acceptResult.found && !acceptResult.clicked;
    await acceptPage.waitForTimeout(this.settleMs);
    states.push(await captureBrowserState(acceptPage, acceptRequests, "accept-all"));

    // --- Withdrawal (reuse the accept-all context/session) ---
    if (this.config.testWithdrawal) {
      const withdrawalRequests: TrackedRequest[] = [];
      attachRequestTracking(acceptContext, withdrawalRequests);
      withdrawalControlFound = await this.attemptWithdrawal(acceptPage);
      if (withdrawalControlFound) {
        states.push(await captureBrowserState(acceptPage, withdrawalRequests, "withdrawn"));
      }
    }
    await acceptContext.close();

    return {
      states,
      gpcProbeRan,
      bannerAcceptControlFound,
      bannerRejectControlFound,
      withdrawalControlFound,
      bannerDetected,
      acceptControlNotClickable,
      requestsBeforeAnyConsentAction: initialRequests,
      beforeConsentVisits: visits,
    };
  }

  /**
   * Looks for a persistent route back to the consent choice after consent was
   * granted, and uses it.
   *
   * The reopening control is what Art. 7(3) GDPR is really about - "as easy
   * to withdraw as to give". Sites expose it as a footer link, a floating
   * badge, or a CMP-specific handle, so all three are tried before concluding
   * there is none.
   */
  private async attemptWithdrawal(page: Page): Promise<boolean> {
    const reopenSelectors = this.config.withdrawalSelectors ?? DEFAULT_WITHDRAWAL_SELECTORS;
    const reopen = await findVisibleControl(page, reopenSelectors, 1000);
    if (!reopen) return false;
    try {
      await reopen.frame.locator(reopen.selector).first().click({ timeout: 4000 });
      await page.waitForTimeout(this.settleMs);
      // Reaching the settings surface is itself the withdrawal route, so it
      // counts even when the refusal control inside it cannot be operated;
      // the state captured afterwards is what a rule inspects to see whether
      // the withdrawal actually took effect.
      await clickFirstMatch(page, this.config.rejectSelectors);
      await page.waitForTimeout(this.settleMs);
      return true;
    } catch (error) {
      logger.debug("Consent withdrawal flow failed", error);
      return false;
    }
  }
}

/**
 * Routes back to the consent choice, in the wording and markup sites actually
 * use. Text matching covers the major EU languages because a German site
 * labels its control "Cookie-Einstellungen", not "cookie settings" - and an
 * English-only heuristic reported every non-English site as having no way to
 * withdraw consent.
 */
export const DEFAULT_WITHDRAWAL_SELECTORS = [
  "#ot-sdk-btn",
  ".ot-sdk-show-settings",
  "#CybotCookiebotDialogBodyEdgeMoreDetails",
  ".cky-btn-revisit-wrapper",
  "#usercentrics-psl",
  ".osano-cm-widget",
  "#didomi-icon",
  ".iubenda-tp-btn",
  ".cmplz-manage-consent",
  "[class*='cookie-settings' i]",
  "[id*='cookie-settings' i]",
  "text=/manage cookies|cookie settings|cookie preferences|privacy settings|manage consent|consent settings|manage preferences/i",
  "text=/cookie-einstellungen|datenschutzeinstellungen|einwilligung (verwalten|ändern)/i",
  "text=/(gérer|paramètres) (les )?(cookies|de confidentialité)|préférences cookies/i",
  "text=/configuraci[oó]n de cookies|preferencias de cookies|gestionar cookies/i",
  "text=/impostazioni (dei )?cookie|preferenze cookie/i",
  "text=/cookie-instellingen|privacyinstellingen/i",
  "text=/ustawienia (plików )?cookie|zarządzaj zgodami/i",
];
