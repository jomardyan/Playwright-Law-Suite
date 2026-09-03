import { describe, expect, it } from "vitest";
import { loadConfigFromObject } from "../src/config/loader.js";
import { EvidenceStore } from "../src/engine/EvidenceStore.js";
import { euGdprEprivacyPack } from "../src/packs/eu-gdpr/pack.js";
import { thPdpaPack } from "../src/packs/th-pdpa/pack.js";
import type { CapturedState, PageContext, RegulatoryPack, ScanContext } from "../src/engine/types.js";

function pageContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    page: null as unknown as PageContext["page"],
    browserContext: null as unknown as PageContext["browserContext"],
    url: "https://shop.example/",
    route: { url: "https://shop.example/", priority: 100, source: "config" },
    consentFlow: null,
    accessibilityViolations: [],
    interactionChecks: [],
    forms: [],
    privacyDocuments: [],
    securityHeaders: null,
    aiInteraction: null,
    consumerJourney: null,
    ...overrides,
  };
}

function scanContext(pages: PageContext[]): ScanContext {
  return {
    config: loadConfigFromObject({ target: { url: "https://shop.example" }, jurisdictions: ["European Union", "Thailand"] }),
    mode: "live",
    pages,
    thirdPartyServices: [],
    evidence: new EvidenceStore("/tmp/universcan-consent-storage-test"),
    startedAt: new Date().toISOString(),
  };
}

async function runRule(pack: RegulatoryPack, ruleId: string, context: ScanContext) {
  const rule = pack.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found in ${pack.id}`);
  if (!rule.applicable(context)) return [];
  return rule.run(context);
}

function beforeConsentState(overrides: Partial<CapturedState> = {}): CapturedState {
  return {
    consentState: "before-consent",
    url: "https://shop.example/",
    cookies: [],
    localStorageKeys: [],
    sessionStorageKeys: [],
    thirdPartyRequests: [],
    ...overrides,
  };
}

const consentFlow = (overrides = {}) => ({
  states: [] as CapturedState[],
  gpcProbeRan: false,
  bannerAcceptControlFound: true,
  bannerRejectControlFound: true,
  withdrawalControlFound: true,
  requestsBeforeAnyConsentAction: [],
  ...overrides,
});

describe("pre-consent tracking detection", () => {
  it("flags a first-party analytics identifier written before any consent action", async () => {
    // No request to google-analytics.com is made when the tag is proxied
    // server-side, but `_ga` is still written to the visitor's device, which
    // is what Art. 5(3) ePrivacy governs.
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({
          states: [beforeConsentState({ cookies: [{ name: "_ga", domain: "shop.example", secure: true, httpOnly: false, sameSite: "Lax" }] })],
        }),
      }),
    ]);

    const findings = await runRule(euGdprEprivacyPack, "gdpr-eprivacy-tracking-before-consent", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("violation");
    expect(findings[0].observedBehavior).toContain("_ga");
    expect(findings[0].affectedElement).toContain("cookie");
  });

  it("flags a tracking identifier held in web storage as well as in a cookie", async () => {
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({
          states: [beforeConsentState({ localStorageKeys: ["ajs_anonymous_id"], sessionStorageKeys: ["_uetsid"] })],
        }),
      }),
    ]);

    const findings = await runRule(euGdprEprivacyPack, "gdpr-eprivacy-tracking-before-consent", context);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.affectedElement).join(" ")).toContain("localStorage");
  });

  it("does not flag a session cookie or the site's own consent record", async () => {
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({
          states: [
            beforeConsentState({
              cookies: [
                { name: "sessionid", domain: "shop.example", secure: true, httpOnly: true, sameSite: "Lax" },
                { name: "OptanonConsent", domain: "shop.example", secure: true, httpOnly: false, sameSite: "Lax" },
              ],
              localStorageKeys: ["cart", "theme"],
            }),
          ],
        }),
      }),
    ]);

    expect(await runRule(euGdprEprivacyPack, "gdpr-eprivacy-tracking-before-consent", context)).toEqual([]);
  });

  it("reports nothing when the consent flow captured no before-consent state", async () => {
    // Absence of evidence is not evidence of compliance: with no captured
    // state there is simply nothing to find here.
    const context = scanContext([pageContext({ consentFlow: consentFlow({ states: [] }) })]);
    expect(await runRule(euGdprEprivacyPack, "gdpr-eprivacy-tracking-before-consent", context)).toEqual([]);
  });

  it("applies the same storage check in a shared rule used by another regime", async () => {
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({
          states: [beforeConsentState({ cookies: [{ name: "_fbp", domain: "shop.example", secure: true, httpOnly: false, sameSite: "Lax" }] })],
        }),
      }),
    ]);

    const findings = await runRule(thPdpaPack, "th-pdpa-tracking-before-consent", context);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].observedBehavior).toContain("_fbp");
  });
});

describe("consent banner presence reporting", () => {
  const runRejectRule = (bannerDetected: boolean | undefined) =>
    runRule(
      euGdprEprivacyPack,
      "gdpr-eprivacy-reject-control-present",
      scanContext([
        pageContext({
          consentFlow: consentFlow({
            bannerAcceptControlFound: false,
            bannerRejectControlFound: false,
            bannerDetected,
          }),
        }),
      ])
    );

  it("distinguishes a page with no banner at all from one whose controls were not understood", async () => {
    const noBanner = await runRejectRule(false);
    expect(noBanner[0].observedBehavior).toContain("No consent banner markup");

    const bannerButNoControls = await runRejectRule(true);
    expect(bannerButNoControls[0].observedBehavior).toContain("Consent banner markup was present");
  });

  it("says the banner question was not established when it was not probed", async () => {
    const unknown = await runRejectRule(undefined);
    expect(unknown[0].observedBehavior).toContain("was not established");
    expect(unknown[0].status).toBe("manual-review");
  });
});
