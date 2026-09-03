import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  crossBorderTransferRule,
  jurisdictionMatcher,
  noticeContentsRule,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  sensitiveDataFormRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "za-popia",
  regulation: "POPIA (Protection of Personal Information Act 4 of 2013, South Africa)",
  jurisdiction: "South Africa",
};

/**
 * POPIA s. 69 makes unsolicited electronic direct marketing opt-in: it is
 * prohibited unless the data subject has consented, or is an existing
 * customer marketed to about similar products with an opt-out at every
 * contact. A newsletter signup that is pre-ticked, or bundled into another
 * consent, therefore fails.
 */
const directMarketingOptIn = defineRule({
  id: "popia-direct-marketing-opt-in",
  requirement:
    "Unsolicited electronic direct marketing is prohibited unless the data subject has consented, or is an existing customer being marketed similar products with an opportunity to object at every communication.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "POPIA s. 69; Information Regulator Guidance Note on Direct Marketing (2024)",
  remediation:
    "Ship marketing opt-ins unchecked and unbundled, record the consent, and give an opt-out in every electronic communication. A non-customer may be asked for consent once only.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const form of page.forms) {
        for (const checkbox of form.consentCheckboxes) {
          const marketing = /market|newsletter|subscribe|promotion|offers/i.test(checkbox.label);
          if (!marketing) continue;
          if (!checkbox.preChecked && !checkbox.purposeBundled) continue;
          findings.push(
            buildFinding(directMarketingOptIn, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
              status: "violation",
              affectedUrl: page.url,
              affectedElement: `form[${form.formIndex}] checkbox: ${checkbox.label}`,
              observedBehavior: checkbox.preChecked
                ? `A direct-marketing consent labelled "${checkbox.label}" is pre-ticked on page load.`
                : `A direct-marketing consent labelled "${checkbox.label}" appears bundled with other purposes.`,
              expectedBehavior:
                "Direct-marketing consent is unticked, requested separately, and recorded.",
              evidence: [context.evidence.domFragment("Direct marketing consent control", checkbox.label)],
              manualReviewRequired: false,
            })
          );
        }
      }
    }
    return findings;
  },
});

const informationOfficer = defineRule({
  id: "popia-information-officer-registered",
  requirement:
    "Every responsible party must have an Information Officer, registered with the Information Regulator, who encourages compliance and deals with requests and complaints.",
  severity: "medium",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "POPIA s. 55, 56; Regulations relating to the Protection of Personal Information, reg. 4",
  remediation:
    "Register the Information Officer with the Information Regulator and publish their contact details alongside the PAIA manual.",
  run: (context) => {
    const findings = [];
    const seen = new Set<string>();
    for (const page of context.pages) {
      const notice = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
      if (!notice?.url || notice.textLength === 0 || seen.has(notice.url)) continue;
      seen.add(notice.url);
      const named = notice.disclosures.some(
        (entry) =>
          (entry.category === "dpo-information" || entry.category === "controller-contact") && entry.status === "detected"
      );
      if (named) continue;
      findings.push(
        buildFinding(informationOfficer, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "missing-disclosure",
          affectedUrl: notice.url,
          observedBehavior: "No Information Officer contact was found in the published notice.",
          expectedBehavior: "The Information Officer's contact details are published and registered with the Regulator.",
          evidence: [context.evidence.note("Contact disclosure detection", notice.disclosures)],
        })
      );
    }
    return findings;
  },
});

const paiaManual = defineRule({
  id: "popia-paia-manual-available",
  requirement:
    "A responsible party must make available a manual under the Promotion of Access to Information Act describing the records it holds and how to request access to them.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Promotion of Access to Information Act 2 of 2000, s. 51; POPIA s. 17",
  remediation: "Publish the PAIA manual on the website and keep it current.",
  run: (context) => {
    const page = context.pages[0];
    if (!page) return [];
    return [
      buildFinding(paiaManual, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "Whether a current PAIA manual is published, and whether it reflects the records actually held, cannot be established by scanning.",
        expectedBehavior: "A current PAIA manual is available on the website.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const zaPopiaPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "ZA",
  regulation: IDENTITY.regulation,
  authority: "Information Regulator (South Africa)",
  version: "1.0.0",
  effectiveDate: "2021-07-01",
  applicability: jurisdictionMatcher(/south africa|^za$|popia/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "popia-notification-to-data-subject",
      requirement:
        "A responsible party must take reasonably practicable steps to ensure the data subject is aware of the information collected, the purpose, the recipients, whether supply is voluntary or mandatory, and their rights.",
      severity: "high",
      confidence: "high",
      legalReference: "POPIA s. 18",
      remediation: "Publish a s. 18 notification and link it from every page that collects personal information.",
    }),
    noticeContentsRule(
      IDENTITY,
      {
        id: "popia-notification-required-contents",
        requirement: "The s. 18 notification must cover each matter that section enumerates.",
        severity: "medium",
        confidence: "low",
        legalReference: "POPIA s. 18(1)",
        remediation: "Add the missing topics, and have the wording reviewed against s. 18 by South African counsel.",
      },
      ["controller-identity", "controller-contact", "processing-purposes", "recipients", "data-subject-rights"]
    ),
    directMarketingOptIn,
    preCheckedConsentRule(IDENTITY, {
      id: "popia-consent-not-prechecked",
      requirement:
        "Consent means any voluntary, specific and informed expression of will; a pre-ticked box is not a voluntary expression of will.",
      severity: "high",
      confidence: "high",
      legalReference: "POPIA s. 1 (definition of consent), s. 11(1)(a)",
      remediation: "Ship every consent checkbox unchecked.",
    }),
    informationOfficer,
    paiaManual,
    sensitiveDataFormRule(IDENTITY, {
      id: "popia-special-personal-information",
      requirement:
        "Processing of special personal information - including health, biometric and religious or political information - is prohibited unless a statutory exclusion or an authorisation applies.",
      severity: "critical",
      confidence: "low",
      legalReference: "POPIA s. 26, 27",
      remediation:
        "Establish and document which s. 27 ground permits each special category, or stop collecting it.",
    }),
    crossBorderTransferRule(IDENTITY, {
      id: "popia-transborder-information-flow",
      requirement:
        "Personal information may be transferred outside South Africa only where the recipient is subject to a law, binding corporate rules or agreement providing an adequate level of protection, or another s. 72 ground applies.",
      severity: "high",
      confidence: "low",
      legalReference: "POPIA s. 72",
      remediation: "Bind each foreign recipient by an agreement or rules upholding POPIA's principles.",
    }),
  ] as Rule[],
};
