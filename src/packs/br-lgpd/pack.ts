import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "br-lgpd";
const REGULATION = "LGPD (Lei Geral de Protecao de Dados)";
const JURISDICTION = "Brazil";

const lgpdPrivacyNotice = defineRule({
  id: "lgpd-privacy-notice-present",
  requirement: "Data subjects must receive clear information about processing of their personal data (aviso de privacidade).",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "LGPD Lei 13.709/2018, Art. 9",
  remediation: "Publish a privacy notice describing processing purposes, data shared, retention, and data subject rights, per ANPD guidance.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy");
      if (!doc?.url) {
        findings.push(
          buildFinding(lgpdPrivacyNotice, PACK_ID, REGULATION, JURISDICTION, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "No privacy notice link was found on this page.",
            expectedBehavior: "An LGPD Art. 9 compliant privacy notice is discoverable.",
          })
        );
      }
    }
    return findings;
  },
});

const lgpdCookieConsent = defineRule({
  id: "lgpd-anpd-cookie-consent",
  requirement: "Non-essential cookies should be gated behind a consent mechanism consistent with ANPD cookie guidance and LGPD consent requirements (free, informed, unambiguous).",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "LGPD Art. 7-8; ANPD cookie guidance",
  remediation: "Implement a consent banner offering a genuine reject option before non-essential cookies load.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      if (!page.consentFlow) continue;
      if (!page.consentFlow.bannerRejectControlFound && !page.consentFlow.bannerAcceptControlFound) {
        findings.push(
          buildFinding(lgpdCookieConsent, PACK_ID, REGULATION, JURISDICTION, {
            status: "manual-review",
            affectedUrl: page.url,
            observedBehavior: "No consent banner controls were detected by heuristic matching.",
            expectedBehavior: "A consent mechanism is present if non-essential cookies are used.",
            manualReviewRequired: true,
          })
        );
      }
    }
    return findings;
  },
});

export const brLgpdPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "BR",
  regulation: REGULATION,
  authority: "Autoridade Nacional de Protecao de Dados (ANPD)",
  version: "1.0.0",
  effectiveDate: "2020-09-18",
  applicability: (config) =>
    config.jurisdictions.some((j) => /brazil|^br$/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /brazil|^br$/i.test(m)),
  rules: [lgpdPrivacyNotice, lgpdCookieConsent] as Rule[],
};
