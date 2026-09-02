import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "ca-pipeda";
const REGULATION = "PIPEDA";
const JURISDICTION = "Canada";

const pipedaPrivacyPolicy = defineRule({
  id: "pipeda-privacy-policy-present",
  requirement: "Organizations must make readily available information about their policies and practices for managing personal information.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "PIPEDA, Schedule 1, Principle 4.8 (Openness)",
  remediation: "Publish a privacy policy describing collection, use, and disclosure practices, and how to contact the organization about them.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy");
      if (!doc?.url) {
        findings.push(
          buildFinding(pipedaPrivacyPolicy, PACK_ID, REGULATION, JURISDICTION, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "No privacy policy link was found on this page.",
            expectedBehavior: "A PIPEDA Principle 4.8 compliant privacy policy is discoverable.",
          })
        );
      }
    }
    return findings;
  },
});

const provincialExtensionReminder = defineRule({
  id: "pipeda-provincial-extension-review",
  requirement: "Quebec (Law 25), British Columbia (PIPA), and Alberta (PIPA) impose additional/substituted requirements beyond PIPEDA depending on where the organization operates.",
  severity: "manual-review",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Act respecting the protection of personal information in the private sector (Quebec Law 25); BC PIPA; Alberta PIPA",
  remediation: "Confirm which provincial privacy statute applies based on company/customer location and review for additional requirements (e.g. Law 25 privacy impact assessments).",
  run: (context) =>
    context.pages.slice(0, 1).map((page) =>
      buildFinding(provincialExtensionReminder, PACK_ID, REGULATION, JURISDICTION, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior: "This pack evaluates federal PIPEDA baseline requirements only.",
        expectedBehavior: "Applicable provincial privacy statutes are separately reviewed.",
        manualReviewRequired: true,
      })
    ),
});

export const caPipedaPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "CA",
  regulation: REGULATION,
  authority: "Office of the Privacy Commissioner of Canada (OPC)",
  version: "1.0.0",
  effectiveDate: "2001-01-01",
  applicability: (config) =>
    config.jurisdictions.some((j) => /canada|^ca$/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /canada|^ca$/i.test(m)),
  rules: [pipedaPrivacyPolicy, provincialExtensionReminder] as Rule[],
};
