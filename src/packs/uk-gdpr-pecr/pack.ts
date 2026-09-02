import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "uk-gdpr-pecr";
const REGULATION = "UK GDPR / PECR";
const JURISDICTION = "United Kingdom";

const pecrConsentControls = defineRule({
  id: "pecr-storage-and-access-consent",
  requirement: "Storage and access technologies (cookies, similar tech) beyond what is strictly necessary require consent under PECR, mirroring the reject/accept parity required under UK GDPR.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Privacy and Electronic Communications Regulations (PECR) reg. 6; UK GDPR Art. 4(11), 7",
  remediation: "Ensure the consent banner offers a reject control no harder to use than the accept control, per ICO guidance.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      if (!page.consentFlow) continue;
      if (page.consentFlow.bannerAcceptControlFound && !page.consentFlow.bannerRejectControlFound) {
        findings.push(
          buildFinding(pecrConsentControls, PACK_ID, REGULATION, JURISDICTION, {
            status: "probable-violation",
            affectedUrl: page.url,
            observedBehavior: "An accept-all control was detected without an equally accessible reject-all control.",
            expectedBehavior: "Reject-all is presented with the same prominence as accept-all (ICO guidance on cookies).",
          })
        );
      }
    }
    return findings;
  },
});

const ukPrivacyNotice = defineRule({
  id: "uk-gdpr-privacy-notice-present",
  requirement: "A UK GDPR-compliant privacy notice must be discoverable, addressing the ICO's transparency requirements.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "UK GDPR Art. 13, 14; Data Protection Act 2018",
  remediation: "Publish a privacy notice covering identity/contact details, purposes, legal basis, retention, and data subject rights.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy");
      if (!doc?.url) {
        findings.push(
          buildFinding(ukPrivacyNotice, PACK_ID, REGULATION, JURISDICTION, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "No privacy notice link was found on this page.",
            expectedBehavior: "A privacy notice is discoverable, typically from the site footer.",
          })
        );
      }
    }
    return findings;
  },
});

export const ukGdprPecrPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "GB",
  regulation: REGULATION,
  authority: "Information Commissioner's Office (ICO)",
  version: "1.0.0",
  effectiveDate: "2021-01-01",
  applicability: (config) =>
    config.jurisdictions.some((j) => /^uk$/i.test(j) || /united kingdom/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /^uk$/i.test(m) || /united kingdom/i.test(m)),
  rules: [pecrConsentControls, ukPrivacyNotice] as Rule[],
};
