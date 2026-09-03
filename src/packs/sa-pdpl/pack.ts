import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  consentWithdrawalRule,
  crossBorderTransferRule,
  jurisdictionMatcher,
  noticeContentsRule,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  sensitiveDataFormRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "sa-pdpl",
  regulation: "PDPL (Personal Data Protection Law, Kingdom of Saudi Arabia)",
  jurisdiction: "Saudi Arabia",
};

const marketingConsent = defineRule({
  id: "sa-pdpl-marketing-requires-consent",
  requirement:
    "Personal data may not be used for advertising or awareness material without the data subject's consent, and every such message must provide a mechanism to opt out.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "PDPL Art. 26; Implementing Regulation Art. 21",
  remediation:
    "Collect a separate, unticked consent for marketing, and include an opt-out mechanism in every message. SDAIA has issued enforcement decisions specifically for marketing without consent.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const form of page.forms) {
        for (const checkbox of form.consentCheckboxes) {
          if (!/market|newsletter|subscribe|promotion|advertis/i.test(checkbox.label)) continue;
          if (!checkbox.preChecked && !checkbox.purposeBundled) continue;
          findings.push(
            buildFinding(marketingConsent, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
              status: "violation",
              affectedUrl: page.url,
              affectedElement: `form[${form.formIndex}] checkbox: ${checkbox.label}`,
              observedBehavior: `A marketing consent labelled "${checkbox.label}" is ${
                checkbox.preChecked ? "pre-ticked" : "bundled with other purposes"
              }.`,
              expectedBehavior: "Marketing consent is separate, unticked, and recorded.",
              evidence: [context.evidence.domFragment("Marketing consent control", checkbox.label)],
              manualReviewRequired: false,
            })
          );
        }
      }
    }
    return findings;
  },
});

const registration = defineRule({
  id: "sa-pdpl-controller-registration",
  requirement:
    "Controllers within the scope of the PDPL must register on the national data controller register, and appoint a personal data protection officer where the prescribed criteria are met.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "PDPL Art. 30; Implementing Regulation Art. 32; SDAIA DPO Rules",
  remediation:
    "Register with SDAIA on the national platform, and appoint and publish a personal data protection officer where the criteria apply.",
  run: (context) => {
    const page = context.pages[0];
    if (!page) return [];
    return [
      buildFinding(registration, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "Whether the controller is registered with SDAIA, and whether the DPO criteria are met, cannot be determined from the site.",
        expectedBehavior: "The controller is registered, and a DPO appointed where required.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const saPdplPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "SA",
  regulation: IDENTITY.regulation,
  authority: "Saudi Data and Artificial Intelligence Authority (SDAIA)",
  version: "1.0.0",
  effectiveDate: "2023-09-14",
  applicability: jurisdictionMatcher(/saudi|ksa|^sa$|pdpl/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "sa-pdpl-privacy-policy-present",
      requirement:
        "The controller must make a privacy policy available to data subjects before collecting their personal data, stating the purpose, the data collected, how it is stored and processed, and how it is destroyed.",
      severity: "high",
      confidence: "high",
      legalReference: "PDPL Art. 12",
      remediation: "Publish a privacy policy meeting Art. 12 and make it available before collection.",
    }),
    noticeContentsRule(
      IDENTITY,
      {
        id: "sa-pdpl-notice-required-contents",
        requirement:
          "The controller must inform the data subject of the legal basis and purpose of collection, its identity and address, the recipients, the consequences of refusing to provide the data, and their rights.",
        severity: "medium",
        confidence: "low",
        legalReference: "PDPL Art. 13, 14",
        remediation: "Add the missing topics, and have the wording reviewed against Art. 13 by Saudi counsel.",
      },
      ["controller-identity", "controller-contact", "processing-purposes", "legal-bases", "recipients", "data-subject-rights"]
    ),
    preCheckedConsentRule(IDENTITY, {
      id: "sa-pdpl-consent-not-prechecked",
      requirement:
        "Where processing rests on consent, that consent must be freely given and specific; the controller may not make consent a condition of a service unless the service is directly related to the processing.",
      severity: "high",
      confidence: "high",
      legalReference: "PDPL Art. 5, 6; Implementing Regulation Art. 8",
      remediation: "Ship every consent checkbox unchecked, and do not condition unrelated services on consent.",
    }),
    consentWithdrawalRule(IDENTITY, {
      id: "sa-pdpl-consent-withdrawal-available",
      requirement: "The data subject has the right to withdraw consent to the processing of their personal data at any time.",
      severity: "high",
      confidence: "medium",
      legalReference: "PDPL Art. 4(4)",
      remediation: "Provide a permanently available route to withdraw consent.",
    }),
    marketingConsent,
    registration,
    sensitiveDataFormRule(IDENTITY, {
      id: "sa-pdpl-sensitive-data-handling",
      requirement:
        "Sensitive data - including health, genetic, biometric, credit and religious data - attracts heightened conditions, and may not be used for marketing at all.",
      severity: "critical",
      confidence: "low",
      legalReference: "PDPL Art. 1 (definition of sensitive data), Art. 26; Implementing Regulation Art. 24",
      remediation: "Document the basis for each sensitive category, apply enhanced controls, and never use it for marketing.",
    }),
    crossBorderTransferRule(IDENTITY, {
      id: "sa-pdpl-cross-border-transfer",
      requirement:
        "Personal data may be transferred outside the Kingdom only for a purpose the law permits, subject to a transfer risk assessment where required, and without prejudice to national security or the vital interests of the Kingdom.",
      severity: "high",
      confidence: "low",
      legalReference: "PDPL Art. 29; Regulation on Personal Data Transfer outside the Kingdom",
      remediation:
        "Complete a transfer risk assessment for continuous or large-scale transfers of sensitive data, and record the permitted purpose for every transfer.",
    }),
  ] as Rule[],
};
