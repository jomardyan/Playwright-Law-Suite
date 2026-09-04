import { classifyDomain, isNonEssentialTrackingCategory } from "../../utils/domainClassifier.js";
import type { Finding, RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  consentWithdrawalRule,
  jurisdictionMatcher,
  noticeContentsRule,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  rejectControlRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "kr-pipa",
  regulation: "PIPA (Personal Information Protection Act, Republic of Korea)",
  jurisdiction: "South Korea",
};

/**
 * PIPA requires the privacy policy itself to disclose the installation and
 * operation of "automatic personal information collection devices" - cookies
 * and comparable trackers - and how the user can refuse them. Saying that
 * cookies are used is not enough; the refusal route must be stated.
 */
const automaticCollectionDisclosure = defineRule({
  id: "pipa-automatic-collection-device-disclosure",
  requirement:
    "The privacy policy must disclose the installation, operation and refusal of automatic personal information collection devices such as cookies, including how the user can refuse them.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "PIPA Art. 30(1); Enforcement Decree Art. 31",
  remediation:
    "Add a section to the privacy policy naming the trackers in use, their purpose, and the concrete steps a user can take to refuse them - not merely a statement that cookies are used.",
  run: (context) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const page of context.pages) {
      const trackers = (page.consentFlow?.requestsBeforeAnyConsentAction ?? []).filter((request) =>
        isNonEssentialTrackingCategory(classifyDomain(request.domain).category)
      );
      const notice = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
      const cookiePolicy = page.privacyDocuments.find((doc) => doc.label === "cookie-policy");
      if (trackers.length === 0) continue;
      const key = notice?.url ?? page.url;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cookiePolicy?.url) continue;

      findings.push(
        buildFinding(automaticCollectionDisclosure, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "missing-disclosure",
          affectedUrl: page.url,
          observedBehavior: `${trackers.length} automatic collection device(s) were observed (${Array.from(new Set(trackers.map((t) => t.domain))).join(", ")}), but no dedicated cookie policy describing how to refuse them was found.`,
          expectedBehavior:
            "The privacy policy discloses the trackers in use and the route to refuse them.",
          evidence: [context.evidence.requestLog("Automatic collection devices observed", trackers)],
        })
      );
    }
    return findings;
  },
});

/**
 * A 2023 amendment gives data subjects a portability right, phased in from
 * March 2025. Whether the route exists cannot be seen from a landing page,
 * so this is raised for review wherever the service collects personal data.
 */
const dataPortability = defineRule({
  id: "pipa-data-portability-route",
  requirement:
    "A data subject may require personal information about them to be transmitted to themselves, to another controller, or to a specialised institution, in a structured and machine-readable form.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "PIPA Art. 35-2 (transmission demand right, phased in from 13 March 2025)",
  remediation:
    "Publish a route by which a data subject can request transmission of their data, and be able to deliver it in a structured, commonly used, machine-readable format.",
  run: (context) => {
    const collectsPersonalData = context.pages.some((page) =>
      page.forms.some((form) => form.fields.some((field) => field.category !== null))
    );
    const page = context.pages[0];
    if (!collectsPersonalData || !page) return [];
    return [
      buildFinding(dataPortability, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "The service collects personal data through forms. Whether a transmission-demand route exists, and whether it delivers a machine-readable export, cannot be established by scanning.",
        expectedBehavior: "A documented route exists for a data subject to demand transmission of their data.",
        manualReviewRequired: true,
      }),
    ];
  },
});

const domesticRepresentative = defineRule({
  id: "pipa-domestic-representative-designated",
  requirement:
    "A controller without an address in Korea that meets the prescribed thresholds must designate a domestic representative in writing and state that representative's name, address, telephone number and email in its privacy policy.",
  severity: "high",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "PIPA Art. 31-2; Enforcement Decree Art. 32-2 (in force 2 October 2025)",
  remediation:
    "Designate a domestic representative in writing and publish their name, address, telephone number and email address in the privacy policy.",
  run: (context) => {
    const page = context.pages[0];
    if (!page) return [];
    return [
      buildFinding(domesticRepresentative, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "Whether this controller is established in Korea, and whether it meets the thresholds requiring a domestic representative, cannot be determined from the site.",
        expectedBehavior:
          "Where required, a domestic representative is designated and their full contact details appear in the privacy policy.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const krPipaPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "KR",
  regulation: IDENTITY.regulation,
  authority: "Personal Information Protection Commission (PIPC)",
  version: "1.0.0",
  effectiveDate: "2023-09-15",
  applicability: jurisdictionMatcher(/south korea|korea|^kr$|pipa/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "pipa-privacy-policy-present",
      requirement:
        "A controller must establish a privacy policy and make it continuously available so that data subjects can readily check it.",
      severity: "high",
      confidence: "high",
      legalReference: "PIPA Art. 30",
      remediation: "Publish a privacy policy and link it from every page so it is continuously available.",
    }),
    noticeContentsRule(
      IDENTITY,
      {
        id: "pipa-privacy-policy-required-contents",
        requirement:
          "The privacy policy must state the purpose of processing, the items processed and the retention period, any provision to third parties, the procedure for destruction, the rights of data subjects and how to exercise them, and the privacy officer's contact details.",
        severity: "medium",
        confidence: "low",
        legalReference: "PIPA Art. 30(1); Enforcement Decree Art. 31",
        remediation:
          "Add the missing topics. Keyword presence is not legal sufficiency; have the wording reviewed against Art. 30 by Korean counsel.",
      },
      ["processing-purposes", "retention-periods", "recipients", "data-subject-rights", "controller-contact"]
    ),
    automaticCollectionDisclosure,
    rejectControlRule(IDENTITY, {
      id: "pipa-refusal-as-available-as-consent",
      requirement:
        "Consent must be obtained separately from other matters and must be distinguishable; a data subject must be able to refuse consent to optional processing without losing the service.",
      severity: "high",
      confidence: "medium",
      legalReference: "PIPA Art. 22, 22-2",
      remediation:
        "Offer a refusal control alongside the acceptance control, and do not condition the service on consent to optional processing.",
    }),
    preCheckedConsentRule(IDENTITY, {
      id: "pipa-consent-not-prechecked",
      requirement:
        "Consent must be a clear affirmative indication from the data subject, given separately for each purpose; a pre-ticked box is not consent.",
      severity: "high",
      confidence: "high",
      legalReference: "PIPA Art. 22",
      remediation: "Ship every consent checkbox unchecked and ask for each purpose separately.",
    }),
    consentWithdrawalRule(IDENTITY, {
      id: "pipa-consent-withdrawal-available",
      requirement:
        "A data subject may withdraw consent at any time, and the method of withdrawal must be no more difficult than the method of giving it.",
      severity: "high",
      confidence: "medium",
      legalReference: "PIPA Art. 4, 37",
      remediation: "Provide a withdrawal route that is no harder to use than the one that collected consent.",
    }),
    dataPortability,
    domesticRepresentative,
  ] as Rule[],
};
