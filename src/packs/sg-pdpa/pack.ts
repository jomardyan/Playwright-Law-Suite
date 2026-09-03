import { classifyDomain } from "../../utils/domainClassifier.js";
import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  consentWithdrawalRule,
  contactPublishedRule,
  crossBorderTransferRule,
  jurisdictionMatcher,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "sg-pdpa",
  regulation: "PDPA (Personal Data Protection Act 2012, Singapore)",
  jurisdiction: "Singapore",
};

/**
 * Singapore deliberately has no ePrivacy-style cookie rule. The PDPA works
 * through notification and consent for personal data, and the PDPC accepts
 * that consent for cookies may be given through browser settings in some
 * circumstances.
 *
 * This pack therefore does **not** report a pre-consent analytics tag as a
 * violation the way an EU pack would. Doing so would invent an obligation
 * Singapore has not imposed. Trackers are surfaced for review instead, and
 * the obligations Singapore does impose - notification, a named DPO, the Do
 * Not Call rules - are checked directly.
 */
const cookieConsentPosture = defineRule({
  id: "sg-pdpa-cookie-personal-data-notification",
  requirement:
    "Where cookies collect personal data, the organisation must notify the individual of the purposes and obtain consent, which in some circumstances may be given through browser settings.",
  severity: "medium",
  confidence: "low",
  automationLevel: "evidence-only",
  legalReference: "PDPA 2012, s. 13, 14, 20; PDPC Advisory Guidelines on the PDPA for Selected Topics, ch. 3 (online activities)",
  remediation:
    "Notify the purposes for which cookie data is used. Singapore does not require an EU-style opt-in banner, but a notification obligation still attaches wherever the cookie data is personal data.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const trackers = (page.consentFlow?.requestsBeforeAnyConsentAction ?? []).filter((request) =>
        ["analytics", "advertising", "session-recording"].includes(classifyDomain(request.domain).category)
      );
      if (trackers.length === 0) continue;
      const notified = page.privacyDocuments.some(
        (doc) => (doc.label === "cookie-policy" || doc.label === "privacy-policy") && doc.url
      );
      if (notified) continue;
      const domains = Array.from(new Set(trackers.map((request) => request.domain)));
      findings.push(
        buildFinding(cookieConsentPosture, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "missing-disclosure",
          affectedUrl: page.url,
          affectedElement: domains.join(", "),
          observedBehavior: `Tracking services were observed (${domains.join(", ")}) with no privacy or cookie notice describing the purposes they serve.`,
          expectedBehavior: "The purposes for which cookie-collected personal data is used are notified to the individual.",
          evidence: [context.evidence.requestLog("Tracking services observed", trackers)],
        })
      );
    }
    return findings;
  },
});

const dataProtectionOfficer = defineRule({
  id: "sg-pdpa-dpo-business-contact-published",
  requirement:
    "An organisation must designate at least one individual as its data protection officer and make that person's business contact information available to the public.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "PDPA 2012, s. 11(3), 11(5)",
  remediation:
    "Publish the DPO's business contact information - a role-based email address is acceptable - on the website, and register it with ACRA where required.",
  run: (context) => {
    const findings = [];
    const seen = new Set<string>();
    for (const page of context.pages) {
      const notice = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
      if (!notice?.url || notice.textLength === 0 || seen.has(notice.url)) continue;
      seen.add(notice.url);
      const published = notice.disclosures.some(
        (entry) =>
          (entry.category === "dpo-information" || entry.category === "controller-contact") && entry.status === "detected"
      );
      if (published) continue;
      findings.push(
        buildFinding(dataProtectionOfficer, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "missing-disclosure",
          affectedUrl: notice.url,
          observedBehavior: "No data protection officer business contact was found in the published notice.",
          expectedBehavior: "The DPO's business contact information is publicly available.",
          evidence: [context.evidence.note("Contact disclosure detection", notice.disclosures)],
        })
      );
    }
    return findings;
  },
});

const doNotCall = defineRule({
  id: "sg-pdpa-do-not-call-marketing",
  requirement:
    "Before sending a marketing message to a Singapore telephone number, the sender must check the Do Not Call Registry, and every message must identify the sender and give clear contact details.",
  severity: "high",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "PDPA 2012, Part 9 (Do Not Call Provisions), s. 43, 44, 45",
  remediation:
    "Check the DNC Registry before each send unless clear and unambiguous consent in evidential form is held, and identify the sender in every message.",
  run: (context) => {
    const collectsPhone = context.pages.some((page) =>
      page.forms.some((form) => form.fields.some((field) => field.category === "phone"))
    );
    const page = context.pages[0];
    if (!collectsPhone || !page) return [];
    return [
      buildFinding(doNotCall, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "A form collects a telephone number. Whether the Do Not Call Registry is checked before marketing to it, or clear and unambiguous consent is held, cannot be established by scanning.",
        expectedBehavior: "The DNC Registry is checked before marketing, unless evidential consent is held.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const sgPdpaPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "SG",
  regulation: IDENTITY.regulation,
  authority: "Personal Data Protection Commission (PDPC)",
  version: "1.0.0",
  effectiveDate: "2014-07-02",
  applicability: jurisdictionMatcher(/singapore|^sg$/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "sg-pdpa-notification-obligation",
      requirement:
        "An organisation must inform the individual of the purposes for which their personal data will be collected, used or disclosed, on or before collecting it.",
      severity: "high",
      confidence: "high",
      legalReference: "PDPA 2012, s. 20 (Notification Obligation)",
      remediation: "Publish a notice stating the purposes, and link it from every page that collects personal data.",
    }),
    cookieConsentPosture,
    dataProtectionOfficer,
    preCheckedConsentRule(IDENTITY, {
      id: "sg-pdpa-consent-not-bundled-or-prechecked",
      requirement:
        "An organisation must not obtain consent by providing false or misleading information, or as a condition of providing a product or service beyond what is reasonable.",
      severity: "high",
      confidence: "high",
      legalReference: "PDPA 2012, s. 14(2), 14(3)",
      remediation: "Ship optional consent checkboxes unchecked, and do not condition the service on them.",
    }),
    consentWithdrawalRule(IDENTITY, {
      id: "sg-pdpa-withdrawal-of-consent",
      requirement:
        "An individual may at any time withdraw consent by giving reasonable notice, and the organisation must not prohibit the withdrawal.",
      severity: "high",
      confidence: "medium",
      legalReference: "PDPA 2012, s. 16",
      remediation: "Provide a clear route to withdraw consent, and act on it within a reasonable period.",
    }),
    doNotCall,
    contactPublishedRule(IDENTITY, {
      id: "sg-pdpa-access-and-correction-route",
      requirement:
        "An organisation must provide a route by which an individual can request access to their personal data and ask for it to be corrected.",
      severity: "medium",
      confidence: "medium",
      legalReference: "PDPA 2012, s. 21, 22",
      remediation: "Publish a working contact route for access and correction requests.",
    }),
    crossBorderTransferRule(IDENTITY, {
      id: "sg-pdpa-transfer-limitation",
      requirement:
        "An organisation must not transfer personal data outside Singapore except in accordance with the requirements prescribed to ensure a comparable standard of protection.",
      severity: "high",
      confidence: "low",
      legalReference: "PDPA 2012, s. 26; Personal Data Protection Regulations 2021, reg. 10-12",
      remediation:
        "Bind each overseas recipient by contract, binding corporate rules, or another prescribed mechanism providing a comparable standard of protection.",
    }),
  ] as Rule[],
};
