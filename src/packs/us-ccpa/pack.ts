import { classifyDomain } from "../../utils/domainClassifier.js";
import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "us-ca-ccpa-cpra";
const REGULATION = "CCPA / CPRA";
const JURISDICTION = "United States - California";

const doNotSellLinkPresent = defineRule({
  id: "ccpa-do-not-sell-link-present",
  requirement: "Businesses that sell or share personal information must post a 'Do Not Sell or Share My Personal Information' link (or equivalent opt-out mechanism / Global Privacy Control support).",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Cal. Civ. Code 1798.135; CPRA regulations 11 CCR 7013-7027",
  remediation: "Add a 'Do Not Sell or Share My Personal Information' link in the footer, or honor the Global Privacy Control signal, if the site sells/shares personal information with third parties.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "do-not-sell");
      const hasAdvertisingThirdParties = (page.consentFlow?.requestsBeforeAnyConsentAction ?? []).some(
        (req) => classifyDomain(req.domain).category === "advertising"
      );
      if (hasAdvertisingThirdParties && !doc?.url) {
        findings.push(
          buildFinding(doNotSellLinkPresent, PACK_ID, REGULATION, JURISDICTION, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "Advertising-category third-party requests were observed but no 'Do Not Sell/Share' link was found.",
            expectedBehavior: "A 'Do Not Sell or Share My Personal Information' link or GPC support is present.",
          })
        );
      }
    }
    return findings;
  },
});

const caPrivacyDisclosures = defineRule({
  id: "ccpa-privacy-disclosures",
  requirement: "The privacy policy must include California-specific disclosures: categories of personal information collected, purposes, categories of third parties, and consumer rights (know, delete, correct, opt-out, limit use of sensitive PI, non-discrimination).",
  severity: "medium",
  confidence: "low",
  automationLevel: "evidence-only",
  legalReference: "Cal. Civ. Code 1798.100 et seq.",
  remediation: "Have legal counsel review the privacy policy against the CCPA/CPRA-required disclosure list.",
  run: (context) => {
    const findings = [];
    const seen = new Set<string>();
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy" && d.url);
      if (!doc?.url || seen.has(doc.url)) continue;
      seen.add(doc.url);
      findings.push(
        buildFinding(caPrivacyDisclosures, PACK_ID, REGULATION, JURISDICTION, {
          status: "manual-review",
          affectedUrl: doc.url,
          observedBehavior: "Automated keyword scanning cannot reliably confirm CCPA/CPRA-specific categorical disclosures.",
          expectedBehavior: "Privacy policy contains all CCPA/CPRA-required disclosure categories.",
          manualReviewRequired: true,
        })
      );
    }
    return findings;
  },
});

const coppaAgeGate = defineRule({
  id: "coppa-child-directed-data-collection",
  requirement: "Sites/services directed to children under 13 must not collect personal information without verifiable parental consent.",
  severity: "critical",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Children's Online Privacy Protection Act (COPPA), 15 U.S.C. 6501-6506",
  remediation: "Confirm whether the audience/content is child-directed; if so, implement verifiable parental consent before any data collection.",
  applicable: (context) => (context.config.businessSector ?? "").toLowerCase().includes("child") ||
    (context.config.businessSector ?? "").toLowerCase().includes("education") ||
    (context.config.businessSector ?? "").toLowerCase().includes("kids"),
  run: (context) => {
    return context.pages.map((page) =>
      buildFinding(coppaAgeGate, PACK_ID, "COPPA", "United States - Federal", {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior: "Business sector configuration suggests this application may be child-directed; automated tools cannot determine audience or verifiable-parental-consent adequacy.",
        expectedBehavior: "Verifiable parental consent obtained before collecting personal information from children under 13.",
        manualReviewRequired: true,
      })
    );
  },
});

export const usCcpaCpraPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "US-CA",
  regulation: REGULATION,
  authority: "California Privacy Protection Agency (CPPA)",
  version: "1.0.0",
  effectiveDate: "2023-01-01",
  applicability: (config) =>
    config.jurisdictions.some((j) => /california|us-ca|ccpa|cpra/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /california|us-ca/i.test(m)),
  rules: [doNotSellLinkPresent, caPrivacyDisclosures, coppaAgeGate] as Rule[],
};
