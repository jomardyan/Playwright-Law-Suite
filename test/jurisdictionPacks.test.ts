import { describe, expect, it } from "vitest";
import { loadConfigFromObject } from "../src/config/loader.js";
import { PackLoader } from "../src/packs/PackLoader.js";
import { EvidenceStore } from "../src/engine/EvidenceStore.js";
import { cnPiplPack } from "../src/packs/cn-pipl/pack.js";
import { krPipaPack } from "../src/packs/kr-pipa/pack.js";
import { chFadpPack } from "../src/packs/ch-fadp/pack.js";
import { caQcLaw25Pack } from "../src/packs/ca-qc-law25/pack.js";
import { thPdpaPack } from "../src/packs/th-pdpa/pack.js";
import { sgPdpaPack } from "../src/packs/sg-pdpa/pack.js";
import { zaPopiaPack } from "../src/packs/za-popia/pack.js";
import { saPdplPack } from "../src/packs/sa-pdpl/pack.js";
import { ngNdpaPack } from "../src/packs/ng-ndpa/pack.js";
import { usAdaTitleIiPack } from "../src/packs/us-ada-title-ii/pack.js";
import type { PageContext, RegulatoryPack, ScanContext } from "../src/engine/types.js";

const NEW_PACKS: RegulatoryPack[] = [
  cnPiplPack,
  krPipaPack,
  chFadpPack,
  caQcLaw25Pack,
  thPdpaPack,
  sgPdpaPack,
  zaPopiaPack,
  saPdplPack,
  ngNdpaPack,
  usAdaTitleIiPack,
];

function request(domain: string) {
  return { url: `https://${domain}/tag.js`, domain, resourceType: "script", timestamp: new Date().toISOString() };
}

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

function scanContext(pages: PageContext[], configOverrides = {}): ScanContext {
  return {
    config: loadConfigFromObject({ target: { url: "https://shop.example" }, ...configOverrides }),
    mode: "live",
    pages,
    thirdPartyServices: [],
    evidence: new EvidenceStore("/tmp/universcan-jurisdiction-test"),
    startedAt: new Date().toISOString(),
  };
}

async function runRule(pack: RegulatoryPack, ruleId: string, context: ScanContext) {
  const rule = pack.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found in ${pack.id}`);
  if (!rule.applicable(context)) return [];
  return rule.run(context);
}

const consentFlow = (overrides = {}) => ({
  states: [],
  gpcProbeRan: false,
  bannerAcceptControlFound: true,
  bannerRejectControlFound: true,
  withdrawalControlFound: true,
  requestsBeforeAnyConsentAction: [],
  ...overrides,
});

describe("new jurisdiction packs: shared invariants", () => {
  it("registers every new pack with the loader", () => {
    const ids = new PackLoader().listBuiltIn().map((pack) => pack.id);
    for (const pack of NEW_PACKS) expect(ids, pack.id).toContain(pack.id);
  });

  it("gives every rule an explicit legal reference, remediation and automation level", () => {
    for (const pack of NEW_PACKS) {
      for (const rule of pack.rules) {
        expect(rule.legalReference, `${pack.id}/${rule.id}`).toBeTruthy();
        expect(rule.remediation, `${pack.id}/${rule.id}`).toBeTruthy();
        expect(rule.automationLevel, `${pack.id}/${rule.id}`).toBeTruthy();
      }
    }
  });

  it("keeps every rule id globally unique across all 24 packs", () => {
    const seen = new Set<string>();
    for (const pack of new PackLoader().listBuiltIn()) {
      for (const rule of pack.rules) {
        expect(seen.has(rule.id), `duplicate rule id: ${rule.id}`).toBe(false);
        seen.add(rule.id);
      }
    }
  });

  it("names an authority and a real effective date for every pack", () => {
    for (const pack of NEW_PACKS) {
      expect(pack.authority, pack.id).toBeTruthy();
      expect(pack.effectiveDate, pack.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(pack.effectiveDate)), pack.id).toBe(false);
    }
  });

  it("asserts nothing against a compliant page, only review prompts", async () => {
    // A page with a notice, a working consent flow, no trackers and no
    // forms gives a rule nothing to object to. Anything emitted here must
    // be a prompt for a human, never a claim that something is wrong -
    // that is the difference between a finding and a fabrication.
    const cleanPage = pageContext({
      consentFlow: consentFlow(),
      privacyDocuments: [
        {
          label: "privacy-policy",
          url: "https://shop.example/privacy",
          textLength: 4000,
          disclosures: [
            "controller-identity",
            "controller-contact",
            "dpo-information",
            "processing-purposes",
            "legal-bases",
            "recipients",
            "international-transfers",
            "retention-periods",
            "data-subject-rights",
            "supervisory-authority",
            "consent-withdrawal",
            "automated-decision-making",
          ].map((category) => ({ category, status: "detected" as const, matchedKeywords: ["x"] })),
        },
        { label: "cookie-policy", url: "https://shop.example/cookies", textLength: 900, disclosures: [] },
      ],
    });
    const context = scanContext([cleanPage], { jurisdictions: ["United States"], businessSector: "government" });

    const asserted = new Set(["violation", "probable-violation", "risk", "missing-disclosure", "inconsistent"]);
    for (const pack of NEW_PACKS) {
      for (const rule of pack.rules) {
        if (!rule.applicable(context)) continue;
        for (const finding of await rule.run(context)) {
          expect(
            asserted.has(finding.status),
            `${pack.id}/${rule.id} asserted "${finding.status}" against a clean page: ${finding.observedBehavior}`
          ).toBe(false);
        }
      }
    }
  });

  it("emits a missing-disclosure, not a violation, when a page has no notice at all", async () => {
    const context = scanContext([pageContext()]);
    const findings = await runRule(cnPiplPack, "pipl-privacy-notice-present", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("missing-disclosure");
  });
});

describe("cn-pipl", () => {
  it("flags a single bundled consent where data reaches other handlers", async () => {
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("doubleclick.net")] }),
      }),
    ]);
    const findings = await runRule(cnPiplPack, "pipl-separate-consent-for-sensitive-processing", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].observedBehavior).toContain("separate consent");
  });

  it("raises the impact assessment even with no live page, since it is a records question", async () => {
    const rule = cnPiplPack.rules.find((entry) => entry.id === "pipl-impact-assessment-required");
    expect(rule?.requiresLivePages).toBe(false);
  });
});

describe("ch-fadp: Switzerland's tiered cookie model", () => {
  it("flags advertising cookies set before opt-in", async () => {
    const context = scanContext([
      pageContext({ consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("doubleclick.net")] }) }),
    ]);
    const findings = await runRule(chFadpPack, "fadp-profiling-cookies-require-opt-in", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("violation");
  });

  it("does NOT flag analytics, which Switzerland does not put in the opt-in tier", async () => {
    // The FDPIC's tiered model treats functional and analytics cookies
    // differently from the EU's blanket opt-in. Reporting them here would
    // assert a rule Switzerland has not made.
    const context = scanContext([
      pageContext({ consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("google-analytics.com")] }) }),
    ]);
    expect(await runRule(chFadpPack, "fadp-profiling-cookies-require-opt-in", context)).toHaveLength(0);
  });
});

describe("ca-qc-law25", () => {
  it("treats tracking active on arrival as a failure of confidentiality by default", async () => {
    const context = scanContext([
      pageContext({ consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("google-analytics.com")] }) }),
    ]);
    const findings = await runRule(caQcLaw25Pack, "law25-confidentiality-by-default", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("violation");
  });

  it("stays quiet when nothing is active before the visitor acts", async () => {
    const context = scanContext([pageContext({ consentFlow: consentFlow() })]);
    expect(await runRule(caQcLaw25Pack, "law25-confidentiality-by-default", context)).toHaveLength(0);
  });
});

describe("th-pdpa", () => {
  it("rejects an acknowledgement-only banner as implied consent", async () => {
    const context = scanContext([
      pageContext({ consentFlow: consentFlow({ bannerRejectControlFound: false }) }),
    ]);
    const findings = await runRule(thPdpaPack, "th-pdpa-implied-consent-not-valid", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].observedBehavior).toContain("no way to refuse");
  });

  it("accepts a banner that offers a real refusal", async () => {
    const context = scanContext([pageContext({ consentFlow: consentFlow() })]);
    expect(await runRule(thPdpaPack, "th-pdpa-implied-consent-not-valid", context)).toHaveLength(0);
  });
});

describe("sg-pdpa: notification, not an EU-style banner", () => {
  it("has no rule requiring opt-in before analytics, because Singapore does not require one", () => {
    const ids = sgPdpaPack.rules.map((rule) => rule.id);
    expect(ids).not.toContain("sg-pdpa-tracking-before-consent");
  });

  it("reports missing notification when trackers run with no notice at all", async () => {
    const context = scanContext([
      pageContext({ consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("google-analytics.com")] }) }),
    ]);
    const findings = await runRule(sgPdpaPack, "sg-pdpa-cookie-personal-data-notification", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe("missing-disclosure");
  });

  it("is satisfied by a published notice, without demanding a consent banner", async () => {
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("google-analytics.com")] }),
        privacyDocuments: [
          { label: "privacy-policy", url: "https://shop.example/privacy", textLength: 500, disclosures: [] },
        ],
      }),
    ]);
    expect(await runRule(sgPdpaPack, "sg-pdpa-cookie-personal-data-notification", context)).toHaveLength(0);
  });
});

describe("za-popia", () => {
  it("flags a pre-ticked marketing consent under the s. 69 opt-in rule", async () => {
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
            scope: "form" as const,
            consentCheckboxes: [{ label: "Send me marketing emails", preChecked: true, purposeBundled: false, hidden: false }],
          },
        ],
      }),
    ]);
    const findings = await runRule(zaPopiaPack, "popia-direct-marketing-opt-in", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
  });

  it("ignores a non-marketing consent box, which s. 69 does not govern", async () => {
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
            scope: "form" as const,
            consentCheckboxes: [{ label: "I accept the terms", preChecked: true, purposeBundled: false, hidden: false }],
          },
        ],
      }),
    ]);
    expect(await runRule(zaPopiaPack, "popia-direct-marketing-opt-in", context)).toHaveLength(0);
  });
});

describe("us-ada-title-ii", () => {
  it("applies only to public-sector targets, not to a private US retailer", () => {
    const publicEntity = loadConfigFromObject({
      jurisdictions: ["United States"],
      businessSector: "government",
    });
    const retailer = loadConfigFromObject({
      jurisdictions: ["United States"],
      businessSector: "e-commerce",
    });
    const unknownSector = loadConfigFromObject({ jurisdictions: ["United States"] });

    expect(usAdaTitleIiPack.applicability(publicEntity)).toBe(true);
    expect(usAdaTitleIiPack.applicability(retailer)).toBe(false);
    expect(usAdaTitleIiPack.applicability(unknownSector)).toBe(false);
  });

  it("reports WCAG 2.1 A/AA failures but not 2.2-only ones, which the rule does not adopt", async () => {
    const context = scanContext(
      [
        pageContext({
          accessibilityViolations: [
            { id: "color-contrast", impact: "serious", description: "", help: "Contrast", helpUrl: "", tags: ["wcag2aa"], nodes: [] },
            { id: "target-size", impact: "minor", description: "", help: "Target size", helpUrl: "", tags: ["wcag22aa"], nodes: [] },
          ],
        }),
      ],
      { jurisdictions: ["United States"], businessSector: "government" }
    );
    const findings = await runRule(usAdaTitleIiPack, "ada-title-ii-wcag-21-aa-conformance", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].observedBehavior).toContain("color-contrast");
    expect(findings[0].observedBehavior).not.toContain("target-size");
  });

  it("records the DOJ-extended compliance date rather than the original", () => {
    expect(usAdaTitleIiPack.effectiveDate).toBe("2027-04-26");
  });
});

describe("kr-pipa", () => {
  it("requires the notice to describe how to refuse automatic collection devices", async () => {
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("google-analytics.com")] }),
        privacyDocuments: [
          { label: "privacy-policy", url: "https://shop.example/privacy", textLength: 500, disclosures: [] },
        ],
      }),
    ]);
    const findings = await runRule(krPipaPack, "pipa-automatic-collection-device-disclosure", context);
    expect(findings).toHaveLength(1);
    expect(findings[0].observedBehavior).toContain("refuse");
  });

  it("is satisfied by a dedicated cookie policy", async () => {
    const context = scanContext([
      pageContext({
        consentFlow: consentFlow({ requestsBeforeAnyConsentAction: [request("google-analytics.com")] }),
        privacyDocuments: [
          { label: "cookie-policy", url: "https://shop.example/cookies", textLength: 500, disclosures: [] },
        ],
      }),
    ]);
    expect(await runRule(krPipaPack, "pipa-automatic-collection-device-disclosure", context)).toHaveLength(0);
  });
});
