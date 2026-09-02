import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "au-privacy-dda";
const REGULATION = "Australian Privacy Act / Privacy Principles / DDA digital accessibility";
const JURISDICTION = "Australia";

const appPrivacyPolicy = defineRule({
  id: "app-privacy-policy-present",
  requirement: "APP 1 requires an up-to-date, clearly expressed privacy policy about the management of personal information.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "Privacy Act 1988 (Cth), Australian Privacy Principle 1",
  remediation: "Publish a privacy policy addressing APP 1.4 content requirements and link it prominently.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy");
      if (!doc?.url) {
        findings.push(
          buildFinding(appPrivacyPolicy, PACK_ID, REGULATION, JURISDICTION, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "No privacy policy link was found on this page.",
            expectedBehavior: "An APP 1 compliant privacy policy is discoverable.",
          })
        );
      }
    }
    return findings;
  },
});

const ddaAccessibilityManualReview = defineRule({
  id: "dda-digital-accessibility-manual-review",
  requirement: "Digital services should conform to WCAG 2.2 AA as the technical benchmark commonly relied on for Disability Discrimination Act complaints; automated WCAG findings from the wcag-accessibility pack feed this assessment but legal adequacy still requires human review.",
  severity: "manual-review",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Disability Discrimination Act 1992 (Cth); WCAG 2.2 AA",
  remediation: "Review automated WCAG findings alongside a manual accessibility audit before relying on conformance for DDA purposes.",
  run: (context) =>
    context.pages.map((page) =>
      buildFinding(ddaAccessibilityManualReview, PACK_ID, REGULATION, JURISDICTION, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior: `${page.accessibilityViolations.length} automated WCAG violation(s) detected on this page; see the wcag-accessibility pack for detail.`,
        expectedBehavior: "Manual accessibility review confirms DDA-adequate conformance beyond automated coverage.",
        manualReviewRequired: true,
      })
    ),
});

export const auPrivacyAccessibilityPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "AU",
  regulation: REGULATION,
  authority: "Office of the Australian Information Commissioner (OAIC); Australian Human Rights Commission",
  version: "1.0.0",
  effectiveDate: "2014-03-12",
  applicability: (config) =>
    config.jurisdictions.some((j) => /australia|^au$/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /australia|^au$/i.test(m)),
  rules: [appPrivacyPolicy, ddaAccessibilityManualReview] as Rule[],
};
