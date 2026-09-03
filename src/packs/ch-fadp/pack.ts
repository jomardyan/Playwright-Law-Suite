import { classifyDomain } from "../../utils/domainClassifier.js";
import type { Finding, RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  contactPublishedRule,
  crossBorderTransferRule,
  jurisdictionMatcher,
  noticeContentsRule,
  privacyNoticePresentRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "ch-fadp",
  regulation: "revFADP (revised Swiss Federal Act on Data Protection)",
  jurisdiction: "Switzerland",
};

/**
 * Switzerland deliberately did not copy the EU's blanket opt-in. The FDPIC's
 * cookie guidance sets a tiered model: strictly necessary cookies need no
 * consent but must be disclosed, functional cookies may run on an opt-out
 * basis, and advertising or profiling cookies need explicit opt-in.
 *
 * Only the last tier is checked as a violation here. Treating a Swiss site's
 * analytics like an EU one's would report a breach of a rule Switzerland
 * does not have.
 */
const OPT_IN_CATEGORIES = new Set(["advertising", "session-recording"]);

const profilingOptIn = defineRule({
  id: "fadp-profiling-cookies-require-opt-in",
  requirement:
    "Cookies used for advertising or for high-risk profiling require the data subject's express consent before they are set.",
  severity: "high",
  confidence: "medium",
  automationLevel: "fully-automated",
  legalReference: "revFADP Art. 6(6), Art. 5(f) (high-risk profiling); FDPIC cookie guidance (January 2025, updated October 2025)",
  remediation:
    "Gate advertising and profiling tags behind an explicit opt-in. Strictly necessary cookies need no consent, and functional cookies may remain opt-out, so only this tier has to move.",
  run: (context) => {
    const findings: Finding[] = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow) continue;
      const offenders = flow.requestsBeforeAnyConsentAction.filter((request) =>
        OPT_IN_CATEGORIES.has(classifyDomain(request.domain).category)
      );
      if (offenders.length === 0) continue;
      const domains = Array.from(new Set(offenders.map((request) => request.domain)));
      findings.push(
        buildFinding(profilingOptIn, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "violation",
          affectedUrl: page.url,
          affectedElement: domains.join(", "),
          observedBehavior: `Advertising or profiling services loaded before any consent action: ${domains.join(", ")}.`,
          expectedBehavior: "Advertising and profiling cookies are set only after an express opt-in.",
          evidence: [context.evidence.requestLog("Pre-consent advertising/profiling requests", offenders)],
          manualReviewRequired: false,
        })
      );
    }
    return findings;
  },
});

const essentialCookieDisclosure = defineRule({
  id: "fadp-cookie-disclosure-in-notice",
  requirement:
    "Cookies that require no consent must still be disclosed, so the data subject can understand what is set and why.",
  severity: "medium",
  confidence: "low",
  automationLevel: "partially-automated",
  legalReference: "revFADP Art. 19 (duty to inform); FDPIC cookie guidance",
  remediation: "List the cookies set without consent, their purpose and their lifetime, in the privacy or cookie policy.",
  run: (context) => {
    const findings: Finding[] = [];
    for (const page of context.pages) {
      const cookiesSet = page.consentFlow?.states.find((state) => state.consentState === "before-consent")?.cookies ?? [];
      if (cookiesSet.length === 0) continue;
      if (page.privacyDocuments.some((doc) => doc.label === "cookie-policy" && doc.url)) continue;
      findings.push(
        buildFinding(essentialCookieDisclosure, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "missing-disclosure",
          affectedUrl: page.url,
          observedBehavior: `${cookiesSet.length} cookie(s) were set before any consent action, but no cookie policy describing them was found.`,
          expectedBehavior: "Cookies set without consent are disclosed with their purpose and lifetime.",
          evidence: [context.evidence.cookieSnapshot("Cookies set before consent", cookiesSet)],
        })
      );
    }
    return findings;
  },
});

const swissRepresentative = defineRule({
  id: "fadp-swiss-representative-designated",
  requirement:
    "A controller domiciled abroad must designate a representative in Switzerland where it processes personal data of people in Switzerland on a large scale, regularly, and with a high risk to their personality.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "revFADP Art. 14, 15",
  remediation:
    "Where the thresholds are met, designate a Swiss representative, publish their name and address, and keep a register of processing activities available to them.",
  run: (context) => {
    const page = context.pages[0];
    if (!page) return [];
    return [
      buildFinding(swissRepresentative, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "Whether the controller is domiciled abroad, and whether the large-scale/high-risk thresholds are met, cannot be determined from the site.",
        expectedBehavior: "Where required, a Swiss representative is designated and published.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const chFadpPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "CH",
  regulation: IDENTITY.regulation,
  authority: "Federal Data Protection and Information Commissioner (FDPIC)",
  version: "1.0.0",
  effectiveDate: "2023-09-01",
  applicability: jurisdictionMatcher(/switzerland|swiss|^ch$|fadp|dsg/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "fadp-privacy-notice-present",
      requirement:
        "The controller must inform the data subject, adequately and in advance, of any collection of personal data.",
      severity: "high",
      confidence: "high",
      legalReference: "revFADP Art. 19",
      remediation: "Publish a privacy notice and link it from every page.",
    }),
    noticeContentsRule(
      IDENTITY,
      {
        id: "fadp-notice-required-contents",
        requirement:
          "The notice must give at least the controller's identity and contact details, the purpose of processing, the recipients or categories of recipients, and, for a disclosure abroad, the destination state and the safeguard relied on.",
        severity: "medium",
        confidence: "low",
        legalReference: "revFADP Art. 19(2), 19(4)",
        remediation:
          "Add the missing topics. Keyword presence is not legal sufficiency; have the wording reviewed against Art. 19 by Swiss counsel.",
      },
      ["controller-identity", "controller-contact", "processing-purposes", "recipients", "international-transfers"]
    ),
    profilingOptIn,
    essentialCookieDisclosure,
    crossBorderTransferRule(IDENTITY, {
      id: "fadp-disclosure-abroad-safeguards",
      requirement:
        "Personal data may be disclosed abroad only to a state the Federal Council has recognised as providing adequate protection, or under one of the safeguards the Act permits.",
      severity: "high",
      confidence: "low",
      legalReference: "revFADP Art. 16, 17",
      remediation:
        "Check each recipient state against the Federal Council's adequacy list, and where it is absent, put a recognised safeguard in place and name the destination state in the notice.",
    }),
    contactPublishedRule(IDENTITY, {
      id: "fadp-controller-contact-published",
      requirement: "The controller's identity and contact details must appear in the information given to data subjects.",
      severity: "medium",
      confidence: "medium",
      legalReference: "revFADP Art. 19(2)(a)",
      remediation: "Publish the controller's legal identity and a working contact route in the privacy notice.",
    }),
    swissRepresentative,
  ] as Rule[],
};
