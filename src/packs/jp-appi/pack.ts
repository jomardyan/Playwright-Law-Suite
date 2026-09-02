import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "jp-appi";
const REGULATION = "APPI (Act on the Protection of Personal Information)";
const JURISDICTION = "Japan";

const appiPrivacyPolicy = defineRule({
  id: "appi-privacy-policy-present",
  requirement: "Businesses handling personal information must publicly disclose the purpose of use and related handling information.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "APPI (Act No. 57 of 2003, as amended), Art. 21, 32",
  remediation: "Publish a privacy policy stating the purpose of use of personal information and how data subjects can request disclosure/correction/suspension of use.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy");
      if (!doc?.url) {
        findings.push(
          buildFinding(appiPrivacyPolicy, PACK_ID, REGULATION, JURISDICTION, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "No privacy policy link was found on this page.",
            expectedBehavior: "An APPI-compliant privacy policy is discoverable.",
          })
        );
      }
    }
    return findings;
  },
});

const appiCookiePersonalRelatedInfo = defineRule({
  id: "appi-cookie-personal-related-information",
  requirement: "Provision of cookie-derived personal-related information (PRI) to a third party who will link it to personal data requires the third party to confirm the data subject's consent (2022 APPI amendment).",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "APPI Art. 26-2 (personal-related information provisions, 2022 amendment)",
  remediation: "Confirm with legal counsel whether any third-party tag/pixel constitutes a PRI transfer requiring consent confirmation under Art. 26-2.",
  run: (context) =>
    context.pages
      .filter((page) => (page.consentFlow?.requestsBeforeAnyConsentAction.length ?? 0) > 0)
      .map((page) =>
        buildFinding(appiCookiePersonalRelatedInfo, PACK_ID, REGULATION, JURISDICTION, {
          status: "manual-review",
          affectedUrl: page.url,
          observedBehavior: `${page.consentFlow?.requestsBeforeAnyConsentAction.length ?? 0} third-party request(s) observed; automated tooling cannot determine PRI-linkage status.`,
          expectedBehavior: "Third-party PRI transfers are reviewed for APPI Art. 26-2 consent-confirmation obligations.",
          manualReviewRequired: true,
        })
      ),
});

export const jpAppiPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "JP",
  regulation: REGULATION,
  authority: "Personal Information Protection Commission (PPC)",
  version: "1.0.0",
  effectiveDate: "2022-04-01",
  applicability: (config) =>
    config.jurisdictions.some((j) => /japan|^jp$/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /japan|^jp$/i.test(m)),
  rules: [appiPrivacyPolicy, appiCookiePersonalRelatedInfo] as Rule[],
};
