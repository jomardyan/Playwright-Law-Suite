import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  consentWithdrawalRule,
  crossBorderTransferRule,
  jurisdictionMatcher,
  noticeContentsRule,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  rejectControlRule,
  sensitiveDataFormRule,
  trackingBeforeConsentRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "th-pdpa",
  regulation: "PDPA (Personal Data Protection Act B.E. 2562, Thailand)",
  jurisdiction: "Thailand",
};

/**
 * The PDPC has been explicit that continuing to browse after seeing a banner
 * is not consent: an affirmative action is required before non-essential
 * cookies are set. This rule looks for the implied-consent pattern - a banner
 * that only acknowledges, with no way to refuse.
 */
const impliedConsentRejected = defineRule({
  id: "th-pdpa-implied-consent-not-valid",
  requirement:
    "Consent must be given by an explicit statement or a clear affirmative action. Continuing to browse after a notice, or an 'accept by using this site' banner, is not consent.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "PDPA B.E. 2562, s. 19; PDPC cookie guidance",
  remediation:
    "Replace any acknowledgement-only banner with one offering an explicit accept and an equally available reject, and set no non-essential cookie until the visitor chooses.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow) continue;
      // A banner that can only be dismissed, never refused, is the shape the
      // regulator has said does not produce valid consent.
      if (!flow.bannerAcceptControlFound || flow.bannerRejectControlFound) continue;
      findings.push(
        buildFinding(impliedConsentRejected, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "probable-violation",
          affectedUrl: page.url,
          observedBehavior:
            "The consent banner offers only an acknowledgement, with no way to refuse. Under the PDPA that produces no valid consent for non-essential processing.",
          expectedBehavior: "An explicit affirmative action, with refusal equally available, precedes any non-essential processing.",
          evidence: [
            context.evidence.note("Consent controls detected", {
              accept: flow.bannerAcceptControlFound,
              reject: flow.bannerRejectControlFound,
            }),
          ],
        })
      );
    }
    return findings;
  },
});

export const thPdpaPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "TH",
  regulation: IDENTITY.regulation,
  authority: "Personal Data Protection Committee (PDPC)",
  version: "1.0.0",
  effectiveDate: "2022-06-01",
  applicability: jurisdictionMatcher(/thailand|^th$|thai/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "th-pdpa-privacy-notice-present",
      requirement:
        "Before or at the time of collection, the controller must inform the data subject of the purpose, the data collected, the retention period, the recipients, its identity and contact details, and their rights.",
      severity: "high",
      confidence: "high",
      legalReference: "PDPA B.E. 2562, s. 23",
      remediation: "Publish a privacy notice covering s. 23 and link it from every page.",
    }),
    noticeContentsRule(
      IDENTITY,
      {
        id: "th-pdpa-notice-required-contents",
        requirement: "The notice must cover each matter s. 23 enumerates.",
        severity: "medium",
        confidence: "low",
        legalReference: "PDPA B.E. 2562, s. 23",
        remediation: "Add the missing topics, and have the wording reviewed against s. 23 by Thai counsel.",
      },
      ["processing-purposes", "retention-periods", "recipients", "controller-contact", "data-subject-rights"]
    ),
    trackingBeforeConsentRule(IDENTITY, {
      id: "th-pdpa-tracking-before-consent",
      requirement: "Non-essential cookies and trackers must not be set before the data subject gives explicit consent.",
      severity: "critical",
      confidence: "high",
      legalReference: "PDPA B.E. 2562, s. 19; PDPC cookie guidance",
      remediation: "Gate every analytics, advertising and session-recording tag behind an explicit opt-in.",
    }),
    impliedConsentRejected,
    rejectControlRule(IDENTITY, {
      id: "th-pdpa-reject-control-present",
      requirement:
        "A request for consent must be presented in a clearly distinguishable form, and the data subject must be as free to refuse as to agree.",
      severity: "high",
      confidence: "medium",
      legalReference: "PDPA B.E. 2562, s. 19",
      remediation: "Add a reject control on the first layer of the banner, equal in prominence to accept.",
    }),
    preCheckedConsentRule(IDENTITY, {
      id: "th-pdpa-consent-not-prechecked",
      requirement: "Consent must be an explicit statement or clear affirmative action; a pre-ticked box is not consent.",
      severity: "high",
      confidence: "high",
      legalReference: "PDPA B.E. 2562, s. 19",
      remediation: "Ship every consent checkbox unchecked.",
    }),
    consentWithdrawalRule(IDENTITY, {
      id: "th-pdpa-consent-withdrawal-available",
      requirement:
        "The data subject may withdraw consent at any time, and withdrawal must be as easy as giving consent.",
      severity: "high",
      confidence: "medium",
      legalReference: "PDPA B.E. 2562, s. 19",
      remediation: "Provide a withdrawal route no harder to use than the one that collected consent.",
    }),
    sensitiveDataFormRule(IDENTITY, {
      id: "th-pdpa-sensitive-data-explicit-consent",
      requirement:
        "Sensitive personal data may not be collected without the data subject's explicit consent, save for the narrow statutory exceptions.",
      severity: "critical",
      confidence: "low",
      legalReference: "PDPA B.E. 2562, s. 26",
      remediation: "Obtain explicit consent for each sensitive category, separately from any general consent.",
    }),
    crossBorderTransferRule(IDENTITY, {
      id: "th-pdpa-cross-border-transfer",
      requirement:
        "Personal data may be sent abroad only where the destination has adequate protection, or where one of the statutory conditions is met.",
      severity: "high",
      confidence: "low",
      legalReference: "PDPA B.E. 2562, s. 28, 29",
      remediation:
        "Check each recipient's location, and where protection is not adequate, rely on a documented statutory condition or binding corporate rules.",
    }),
  ] as Rule[],
};
