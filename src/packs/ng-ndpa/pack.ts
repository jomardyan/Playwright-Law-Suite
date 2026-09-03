import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  consentWithdrawalRule,
  contactPublishedRule,
  crossBorderTransferRule,
  jurisdictionMatcher,
  noticeContentsRule,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  rejectControlRule,
  trackingBeforeConsentRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "ng-ndpa",
  regulation: "NDPA (Nigeria Data Protection Act 2023)",
  jurisdiction: "Nigeria",
};

/**
 * The NDPC expects a cookie policy that says what cookies are used, what
 * they are for, who deploys them, and how consent can be withdrawn - a
 * more specific list than most regimes spell out.
 */
const cookiePolicyContents = defineRule({
  id: "ndpa-cookie-policy-contents",
  requirement:
    "A cookie policy must state which cookies are used, their purpose, the organisation deploying them, and how consent can be withdrawn.",
  severity: "medium",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "NDPA 2023 s. 27, 34; NDPC guidance on cookie consent",
  remediation:
    "Publish a cookie policy naming each cookie, its purpose, the deploying organisation, and the withdrawal route.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const trackers = page.consentFlow?.requestsBeforeAnyConsentAction ?? [];
      if (trackers.length === 0) continue;
      if (page.privacyDocuments.some((doc) => doc.label === "cookie-policy" && doc.url)) continue;
      findings.push(
        buildFinding(cookiePolicyContents, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "missing-disclosure",
          affectedUrl: page.url,
          observedBehavior: `${trackers.length} third-party request(s) were observed, but no cookie policy was found.`,
          expectedBehavior:
            "A cookie policy names the cookies, their purpose, who deploys them, and how to withdraw consent.",
          evidence: [context.evidence.requestLog("Third-party requests observed", trackers)],
        })
      );
    }
    return findings;
  },
});

const dataProtectionOfficer = defineRule({
  id: "ndpa-data-protection-officer",
  requirement:
    "A data controller of major importance must designate a data protection officer with expert knowledge of data protection law, and publish that officer's contact details.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "NDPA 2023 s. 32; NDPC General Application and Implementation Directive",
  remediation:
    "Where the thresholds for a data controller of major importance are met, designate and register a DPO and publish their contact details.",
  run: (context) => {
    const page = context.pages[0];
    if (!page) return [];
    return [
      buildFinding(dataProtectionOfficer, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "Whether this controller meets the 'major importance' thresholds, and so must designate and register a DPO, cannot be determined from the site.",
        expectedBehavior: "Where required, a DPO is designated, registered with the NDPC, and published.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const ngNdpaPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "NG",
  regulation: IDENTITY.regulation,
  authority: "Nigeria Data Protection Commission (NDPC)",
  version: "1.0.0",
  effectiveDate: "2023-06-12",
  applicability: jurisdictionMatcher(/nigeria|^ng$|ndpa|ndpr/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "ndpa-privacy-notice-present",
      requirement:
        "A data controller must provide the data subject, before or at the point of collection, with its identity and contact details, the purpose and legal basis, the recipients, the retention period, and their rights.",
      severity: "high",
      confidence: "high",
      legalReference: "NDPA 2023 s. 27",
      remediation: "Publish an accessible, plain-language privacy policy and link it from every page.",
    }),
    noticeContentsRule(
      IDENTITY,
      {
        id: "ndpa-notice-required-contents",
        requirement: "The notice must cover each matter s. 27 enumerates.",
        severity: "medium",
        confidence: "low",
        legalReference: "NDPA 2023 s. 27",
        remediation: "Add the missing topics, and have the wording reviewed against s. 27 by Nigerian counsel.",
      },
      ["controller-identity", "controller-contact", "processing-purposes", "legal-bases", "retention-periods", "data-subject-rights"]
    ),
    trackingBeforeConsentRule(IDENTITY, {
      id: "ndpa-tracking-before-consent",
      requirement:
        "Where consent is the legal basis, non-essential cookies and trackers must not be set before the data subject gives it.",
      severity: "high",
      confidence: "high",
      legalReference: "NDPA 2023 s. 25, 26; NDPC guidance on cookie consent",
      remediation: "Gate every analytics, advertising and session-recording tag behind an affirmative opt-in.",
    }),
    rejectControlRule(IDENTITY, {
      id: "ndpa-reject-control-present",
      requirement:
        "Consent must be freely given, specific, informed and unambiguous, which requires the data subject to be able to refuse as easily as to accept.",
      severity: "high",
      confidence: "medium",
      legalReference: "NDPA 2023 s. 26",
      remediation: "Add a clear reject control to the first layer of the cookie banner.",
    }),
    preCheckedConsentRule(IDENTITY, {
      id: "ndpa-consent-not-prechecked",
      requirement:
        "Consent requires a clear affirmative action; pre-ticked boxes and implied consent are not valid.",
      severity: "high",
      confidence: "high",
      legalReference: "NDPA 2023 s. 26(2)",
      remediation: "Ship every consent checkbox unchecked.",
    }),
    consentWithdrawalRule(IDENTITY, {
      id: "ndpa-consent-withdrawal-available",
      requirement:
        "A data subject may withdraw consent at any time, and it must be as easy to withdraw as to give.",
      severity: "high",
      confidence: "medium",
      legalReference: "NDPA 2023 s. 26(3)",
      remediation: "Provide a withdrawal route no harder to use than the one that collected consent.",
    }),
    cookiePolicyContents,
    dataProtectionOfficer,
    contactPublishedRule(IDENTITY, {
      id: "ndpa-controller-contact-published",
      requirement: "The controller's identity and contact details must be given to the data subject.",
      severity: "medium",
      confidence: "medium",
      legalReference: "NDPA 2023 s. 27(1)(a)",
      remediation: "Publish the controller's legal identity and a working contact route.",
    }),
    crossBorderTransferRule(IDENTITY, {
      id: "ndpa-cross-border-transfer",
      requirement:
        "Personal data may be transferred out of Nigeria only where the recipient is subject to a law or mechanism affording an adequate level of protection, or another statutory ground applies.",
      severity: "high",
      confidence: "low",
      legalReference: "NDPA 2023 s. 41, 43",
      remediation: "Assess the adequacy of each destination and put a recognised mechanism in place where it is lacking.",
    }),
  ] as Rule[],
};
