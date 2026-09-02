import { describe, expect, it } from "vitest";
import { loadConfigFromObject } from "../src/config/loader.js";
import { PackLoader } from "../src/packs/PackLoader.js";
import { euAccessibilityActPack } from "../src/packs/eu-accessibility-act/pack.js";
import { euAiActPack } from "../src/packs/eu-ai-act/pack.js";
import { euConsumerRightsPack } from "../src/packs/eu-consumer-rights/pack.js";
import { usStatePrivacyPack } from "../src/packs/us-state-privacy/pack.js";
import { inDpdpPack } from "../src/packs/in-dpdp/pack.js";
import { globalDataSecurityPack } from "../src/packs/global-data-security/pack.js";
import { EvidenceStore } from "../src/engine/EvidenceStore.js";
import type { PageContext, RegulatoryPack, ScanContext } from "../src/engine/types.js";

const ALL_PACKS: RegulatoryPack[] = [
  euAccessibilityActPack,
  euAiActPack,
  euConsumerRightsPack,
  usStatePrivacyPack,
  inDpdpPack,
  globalDataSecurityPack,
];

function pageContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    // Rules under test never touch the Playwright objects; the cast keeps the
    // fixture free of a real browser.
    page: null as unknown as PageContext["page"],
    browserContext: null as unknown as PageContext["browserContext"],
    url: "https://shop.example/checkout",
    route: { url: "https://shop.example/checkout", priority: 95, source: "config" },
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

function scanContext(pages: PageContext[], configOverrides = {}): ScanContext {
  return {
    config: loadConfigFromObject({
      target: { url: "https://shop.example" },
      jurisdictions: ["European Union"],
      ...configOverrides,
    }),
    mode: "live",
    pages,
    thirdPartyServices: [],
    evidence: new EvidenceStore("/tmp/universcan-test-evidence"),
    startedAt: new Date().toISOString(),
  };
}

async function runRule(pack: RegulatoryPack, ruleId: string, context: ScanContext) {
  const rule = pack.rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found in pack ${pack.id}`);
  if (!rule.applicable(context)) return [];
  return rule.run(context);
}

describe("new pack registration", () => {
  it("registers every new pack with the loader", () => {
    const ids = new PackLoader().listBuiltIn().map((p) => p.id);
    for (const pack of ALL_PACKS) {
      expect(ids).toContain(pack.id);
    }
  });

  it("gives every rule an explicit legal reference, remediation, and automation level", () => {
    for (const pack of ALL_PACKS) {
      for (const rule of pack.rules) {
        expect(rule.legalReference, `${pack.id}/${rule.id} legalReference`).toBeTruthy();
        expect(rule.remediation, `${pack.id}/${rule.id} remediation`).toBeTruthy();
        expect(rule.automationLevel, `${pack.id}/${rule.id} automationLevel`).toBeTruthy();
      }
    }
  });

  it("uses globally unique rule ids across every built-in pack", () => {
    const seen = new Set<string>();
    for (const pack of new PackLoader().listBuiltIn()) {
      for (const rule of pack.rules) {
        expect(seen.has(rule.id), `duplicate rule id: ${rule.id}`).toBe(false);
        seen.add(rule.id);
      }
    }
  });
});

describe("eu-accessibility-act pack", () => {
  it("applies to an EU e-commerce service and not to a US-only one", () => {
    expect(
      euAccessibilityActPack.applicability(
        loadConfigFromObject({ jurisdictions: ["European Union"], businessSector: "e-commerce" })
      )
    ).toBe(true);
    expect(
      euAccessibilityActPack.applicability(loadConfigFromObject({ jurisdictions: ["United States - California"] }))
    ).toBe(false);
  });

  it("does not apply to an EU service in a sector the EAA does not cover", () => {
    expect(
      euAccessibilityActPack.applicability(
        loadConfigFromObject({ jurisdictions: ["European Union"], businessSector: "industrial-machinery" })
      )
    ).toBe(false);
  });

  it("reports WCAG 2.1 A/AA failures and ignores 2.2-only ones", async () => {
    const context = scanContext([
      pageContext({
        accessibilityViolations: [
          { id: "color-contrast", impact: "serious", description: "", help: "Contrast too low", helpUrl: "", tags: ["wcag2aa", "cat.color"], nodes: [] },
          { id: "target-size", impact: "minor", description: "", help: "Target too small", helpUrl: "", tags: ["wcag22aa"], nodes: [] },
        ],
      }),
    ]);
    const findings = await runRule(euAccessibilityActPack, "eaa-en-301-549-wcag-aa-conformance", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].observedBehavior).toContain("color-contrast");
    expect(findings[0].observedBehavior).not.toContain("target-size");
  });

  it("flags a missing accessibility statement as a missing disclosure", async () => {
    const context = scanContext([
      pageContext({ privacyDocuments: [{ label: "privacy-policy", url: "https://shop.example/privacy", textLength: 100, disclosures: [] }] }),
    ]);
    const findings = await runRule(euAccessibilityActPack, "eaa-accessibility-statement-present", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("missing-disclosure");
  });
});

describe("eu-ai-act-transparency pack", () => {
  it("flags an AI chat surface with no disclosure text as a probable violation", async () => {
    const context = scanContext([
      pageContext({
        aiInteraction: {
          url: "https://shop.example/checkout",
          interactionSignals: [{ kind: "vendor-script", detail: "Intercom (widget.intercom.io)" }],
          disclosureSignals: [],
          generatedContentSignals: [],
        },
      }),
    ]);
    const findings = await runRule(euAiActPack, "ai-act-interaction-disclosure", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("probable-violation");
  });

  it("does not flag a disclosure violation when disclosure text is present", async () => {
    const context = scanContext([
      pageContext({
        aiInteraction: {
          url: "https://shop.example/checkout",
          interactionSignals: [{ kind: "widget-markup", detail: "1 element matching [class*='chatbot']" }],
          disclosureSignals: [{ kind: "page-text", detail: "You are chatting with an AI assistant" }],
          generatedContentSignals: [],
        },
      }),
    ]);
    expect(await runRule(euAiActPack, "ai-act-interaction-disclosure", context)).toHaveLength(0);
  });

  it("raises disclosure timing for manual review once disclosure text exists", async () => {
    const context = scanContext([
      pageContext({
        aiInteraction: {
          url: "https://shop.example/checkout",
          interactionSignals: [{ kind: "widget-markup", detail: "chatbot" }],
          disclosureSignals: [{ kind: "page-text", detail: "AI assistant" }],
          generatedContentSignals: [],
        },
      }),
    ]);
    const findings = await runRule(euAiActPack, "ai-act-disclosure-timing", context);
    expect(findings[0].status).toBe("manual-review");
    expect(findings[0].manualReviewRequired).toBe(true);
  });

  it("produces nothing at all on a page with no AI surface", async () => {
    const context = scanContext([pageContext()]);
    for (const rule of euAiActPack.rules) {
      expect(await rule.run(context)).toEqual([]);
    }
  });
});

describe("eu-consumer-rights pack", () => {
  const journey = (overrides = {}) => ({
    url: "https://shop.example/checkout",
    isSubscriptionSurface: false,
    isOrderCompletionSurface: true,
    withdrawalControls: [],
    orderButtons: [],
    ambiguousOrderButtons: [],
    autoRenewalDisclosures: [],
    urgencyClaims: [],
    traderIdentityLinked: true,
    ...overrides,
  });

  it("flags an order button that hides the payment obligation", async () => {
    const context = scanContext([
      pageContext({
        consumerJourney: journey({
          orderButtons: [{ text: "Complete your order", tag: "button", visible: true }],
          ambiguousOrderButtons: [{ text: "Complete your order", tag: "button", visible: true }],
        }),
      }),
    ]);
    const findings = await runRule(euConsumerRightsPack, "crd-order-button-payment-obligation", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].observedBehavior).toContain("Complete your order");
  });

  it("flags a subscription surface with no withdrawal control anywhere in the scan", async () => {
    const context = scanContext([pageContext({ consumerJourney: journey({ isSubscriptionSurface: true }) })]);
    const findings = await runRule(euConsumerRightsPack, "crd-withdrawal-function-present", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("probable-violation");
  });

  it("does not flag withdrawal when a cancel control exists on any scanned page", async () => {
    const context = scanContext([
      pageContext({ consumerJourney: journey({ isSubscriptionSurface: true }) }),
      pageContext({
        url: "https://shop.example/account",
        consumerJourney: journey({ withdrawalControls: [{ text: "Cancel subscription", tag: "button", visible: true }] }),
      }),
    ]);
    expect(await runRule(euConsumerRightsPack, "crd-withdrawal-function-present", context)).toHaveLength(0);
  });

  it("flags a pre-ticked marketing checkbox as a confirmed violation", async () => {
    const context = scanContext([
      pageContext({
        forms: [
          {
            formIndex: 0,
            action: null,
            method: "post",
            usesHttps: true,
            actionIsThirdParty: false,
            fields: [],
            consentCheckboxes: [{ label: "Sign me up for marketing emails", preChecked: true, purposeBundled: false }],
          },
        ],
      }),
    ]);
    const findings = await runRule(euConsumerRightsPack, "crd-no-pre-checked-additional-payments", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("violation");
    expect(findings[0].manualReviewRequired).toBe(false);
  });

  it("only reports missing trader identity when no scanned page links it", async () => {
    const partial = scanContext([
      pageContext({ consumerJourney: journey({ traderIdentityLinked: false }) }),
      pageContext({ url: "https://shop.example/about", consumerJourney: journey({ traderIdentityLinked: true }) }),
    ]);
    expect(await runRule(euConsumerRightsPack, "ecd-trader-identity-available", partial)).toHaveLength(0);

    const none = scanContext([pageContext({ consumerJourney: journey({ traderIdentityLinked: false }) })]);
    expect(await runRule(euConsumerRightsPack, "ecd-trader-identity-available", none)).toHaveLength(1);
  });

  it("does not apply to a declared business-to-business service", () => {
    expect(
      euConsumerRightsPack.applicability(
        loadConfigFromObject({ jurisdictions: ["European Union"], businessSector: "b2b-saas" })
      )
    ).toBe(false);
  });
});

describe("us-state-privacy pack", () => {
  const consentFlow = (overrides = {}) => ({
    states: [],
    gpcProbeRan: true,
    bannerAcceptControlFound: true,
    bannerRejectControlFound: true,
    withdrawalControlFound: false,
    requestsBeforeAnyConsentAction: [],
    ...overrides,
  });

  const capturedState = (consentState: string, domains: string[]) => ({
    consentState: consentState as never,
    url: "https://shop.example/",
    cookies: [],
    localStorageKeys: [],
    sessionStorageKeys: [],
    thirdPartyRequests: domains.map((domain) => ({
      url: `https://${domain}/pixel`,
      domain,
      resourceType: "script",
      timestamp: new Date().toISOString(),
    })),
  });

  it("flags advertising requests that still fire while GPC is asserted", async () => {
    const context = scanContext(
      [pageContext({ consentFlow: consentFlow({ states: [capturedState("gpc-signal", ["doubleclick.net"])] }) })],
      { jurisdictions: ["United States - Colorado"] }
    );
    const findings = await runRule(usStatePrivacyPack, "us-state-gpc-signal-honoured", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("probable-violation");
    expect(findings[0].affectedElement).toContain("doubleclick.net");
  });

  it("reports not-evaluated, never a pass, when the GPC probe was disabled", async () => {
    const context = scanContext([pageContext({ consentFlow: consentFlow({ gpcProbeRan: false }) })], {
      jurisdictions: ["United States - Colorado"],
    });
    const findings = await runRule(usStatePrivacyPack, "us-state-gpc-signal-honoured", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("not-evaluated");
    expect(findings[0].manualReviewRequired).toBe(true);
  });

  it("marks behaviour as inconsistent when GPC changes nothing at all", async () => {
    const context = scanContext(
      [
        pageContext({
          consentFlow: consentFlow({
            states: [
              capturedState("before-consent", ["doubleclick.net"]),
              capturedState("gpc-signal", ["doubleclick.net"]),
            ],
          }),
        }),
      ],
      { jurisdictions: ["United States - Colorado"] }
    );
    const findings = await runRule(usStatePrivacyPack, "us-state-gpc-changes-nothing", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("inconsistent");
  });

  it("stays quiet when the GPC visit suppresses the advertising request", async () => {
    const context = scanContext(
      [
        pageContext({
          consentFlow: consentFlow({
            states: [capturedState("before-consent", ["doubleclick.net"]), capturedState("gpc-signal", [])],
          }),
        }),
      ],
      { jurisdictions: ["United States - Colorado"] }
    );
    expect(await runRule(usStatePrivacyPack, "us-state-gpc-signal-honoured", context)).toHaveLength(0);
    expect(await runRule(usStatePrivacyPack, "us-state-gpc-changes-nothing", context)).toHaveLength(0);
  });
});

describe("global-data-security pack", () => {
  const security = (overrides = {}) => ({
    url: "https://shop.example/checkout",
    https: true,
    headers: {},
    missing: [],
    cookieIssues: [],
    mixedContentRequests: [],
    ...overrides,
  });

  it("loads for any scan that names a jurisdiction", () => {
    expect(globalDataSecurityPack.applicability(loadConfigFromObject({ jurisdictions: ["Japan"] }))).toBe(true);
    expect(globalDataSecurityPack.applicability(loadConfigFromObject({ jurisdictions: [] }))).toBe(false);
  });

  it("flags plaintext transport but not a loopback dev server", async () => {
    const remote = scanContext([
      pageContext({ url: "http://shop.example/", securityHeaders: security({ https: false, url: "http://shop.example/" }) }),
    ]);
    expect(await runRule(globalDataSecurityPack, "security-transport-encryption", remote)).toHaveLength(1);

    const local = scanContext([
      pageContext({ url: "http://localhost:3000/", securityHeaders: security({ https: false, url: "http://localhost:3000/" }) }),
    ]);
    expect(await runRule(globalDataSecurityPack, "security-transport-encryption", local)).toHaveLength(0);
  });

  it("reports missing security headers as a risk with concrete remediation", async () => {
    const context = scanContext([
      pageContext({ securityHeaders: security({ missing: ["strict-transport-security", "content-security-policy"] }) }),
    ]);
    const findings = await runRule(globalDataSecurityPack, "security-response-headers", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("risk");
    expect(findings[0].observedBehavior).toContain("strict-transport-security");
  });

  it("separates a missing Secure flag from a merely unset SameSite", async () => {
    const context = scanContext([
      pageContext({
        securityHeaders: security({
          cookieIssues: [
            { name: "sid", domain: "shop.example", problem: "not-secure-on-https" },
            { name: "prefs", domain: "shop.example", problem: "samesite-unset" },
          ],
        }),
      }),
    ]);
    const findings = await runRule(globalDataSecurityPack, "security-cookie-attributes", context);
    expect(findings.map((f) => f.status).sort()).toEqual(["risk", "violation"]);
  });

  it("flags a personal-data form submitting over plaintext", async () => {
    const context = scanContext([
      pageContext({
        forms: [
          {
            formIndex: 0,
            action: "http://shop.example/subscribe",
            method: "post",
            usesHttps: false,
            actionIsThirdParty: false,
            fields: [{ name: "email", type: "email", category: "email", required: true, autocomplete: null }],
            consentCheckboxes: [],
          },
        ],
      }),
    ]);
    const findings = await runRule(globalDataSecurityPack, "security-form-transport", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });
});

describe("in-dpdp pack", () => {
  it("applies to India and records the 2027 enforcement date rather than implying it already bites", () => {
    expect(inDpdpPack.applicability(loadConfigFromObject({ jurisdictions: ["India"] }))).toBe(true);
    expect(inDpdpPack.applicability(loadConfigFromObject({ jurisdictions: ["European Union"] }))).toBe(false);
    expect(inDpdpPack.effectiveDate).toBe("2027-05-13");
  });

  it("flags a missing notice and reports an unreadable one as not-evaluated", async () => {
    const missing = scanContext([pageContext({ privacyDocuments: [] })], { jurisdictions: ["India"] });
    expect(await runRule(inDpdpPack, "dpdp-consent-notice-present", missing)).toHaveLength(1);

    const unreadable = scanContext(
      [pageContext({ privacyDocuments: [{ label: "privacy-policy", url: "https://shop.example/privacy", textLength: 0, disclosures: [] }] })],
      { jurisdictions: ["India"] }
    );
    const findings = await runRule(inDpdpPack, "dpdp-notice-required-contents", unreadable);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("not-evaluated");
  });

  it("flags one-click consent with no matching withdrawal route", async () => {
    const context = scanContext(
      [
        pageContext({
          consentFlow: {
            states: [],
            gpcProbeRan: true,
            bannerAcceptControlFound: true,
            bannerRejectControlFound: true,
            withdrawalControlFound: false,
            requestsBeforeAnyConsentAction: [],
          },
        }),
      ],
      { jurisdictions: ["India"] }
    );
    const findings = await runRule(inDpdpPack, "dpdp-consent-withdrawal-ease", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("probable-violation");
  });
});
