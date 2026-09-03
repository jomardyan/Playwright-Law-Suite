import { classifyDomain } from "../../utils/domainClassifier.js";
import type { Finding, RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  consentWithdrawalRule,
  jurisdictionMatcher,
  noticeContentsRule,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  sensitiveDataFormRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "cn-pipl",
  regulation: "PIPL (Personal Information Protection Law of the People's Republic of China)",
  jurisdiction: "China",
};

/**
 * PIPL's distinguishing feature is "separate consent" (单独同意): several
 * processing activities need their own, specific consent rather than being
 * bundled into a general acceptance. A single "agree to everything" control
 * therefore fails PIPL even where it would satisfy other regimes.
 */
const separateConsent = defineRule({
  id: "pipl-separate-consent-for-sensitive-processing",
  requirement:
    "Separate consent is required before processing sensitive personal information, providing personal information to another handler, publicly disclosing it, or transferring it outside China. A single bundled acceptance does not satisfy this.",
  severity: "critical",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "PIPL Art. 23, 25, 29, 39",
  remediation:
    "Ask for each of these purposes on its own control, describing that purpose specifically, rather than folding them into one 'accept all' action.",
  run: (context) => {
    const findings: Finding[] = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow?.bannerAcceptControlFound) continue;
      const thirdPartyRecipients = Array.from(
        new Set(
          flow.requestsBeforeAnyConsentAction
            .filter((request) => {
              const category = classifyDomain(request.domain).category;
              return category === "advertising" || category === "analytics" || category === "session-recording";
            })
            .map((request) => request.domain)
        )
      );
      if (thirdPartyRecipients.length === 0) continue;
      findings.push(
        buildFinding(separateConsent, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "probable-violation",
          affectedUrl: page.url,
          affectedElement: thirdPartyRecipients.join(", "),
          observedBehavior: `A single consent control was found, while personal information appears to reach other handlers (${thirdPartyRecipients.join(", ")}). PIPL requires separate consent for provision to another handler, not a bundled acceptance.`,
          expectedBehavior:
            "Provision to another handler is consented to separately, with that purpose described specifically.",
          evidence: [context.evidence.requestLog("Third-party recipients observed before consent", flow.requestsBeforeAnyConsentAction)],
        })
      );
    }
    return findings;
  },
});

const crossBorderNotice = defineRule({
  id: "pipl-cross-border-transfer-notice",
  requirement:
    "Before transferring personal information outside China, the handler must inform the individual of the foreign recipient's name and contact method, the processing purpose and methods, the categories of personal information, and how to exercise their rights against that recipient - and obtain separate consent.",
  severity: "critical",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "PIPL Art. 38, 39; CAC Measures on Certification for Cross-Border Transfer (in force 1 January 2026)",
  remediation:
    "Name each foreign recipient and its contact method in the notice, obtain separate consent for the transfer, complete a personal information protection impact assessment, and use one of the three lawful routes: CAC security assessment, standard contract, or certification.",
  run: (context) => {
    const recipients = Array.from(new Set(context.thirdPartyServices.map((record) => record.domain)));
    const page = context.pages[0];
    if (!page || recipients.length === 0) return [];
    return [
      buildFinding(crossBorderNotice, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior: `Personal information may reach ${recipients.length} third-party domain(s). Whether any is outside China, and which of the three lawful transfer routes covers it, cannot be determined from the browser.`,
        expectedBehavior:
          "Each out-of-China recipient is named in the notice, separately consented to, and covered by a security assessment, standard contract, or certification.",
        evidence: [context.evidence.note("Third-party recipients observed", recipients)],
        manualReviewRequired: true,
      }),
    ];
  },
});

const impactAssessment = defineRule({
  id: "pipl-impact-assessment-required",
  requirement:
    "A personal information protection impact assessment must be carried out, and its record retained for at least three years, before processing sensitive personal information, using personal information for automated decision-making, entrusting processing to another party, or transferring data abroad.",
  severity: "manual-review",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "PIPL Art. 55, 56",
  remediation:
    "Complete and retain a PIPIA for each triggering activity. A current assessment on file is a precondition for a lawful cross-border transfer, not paperwork to follow it.",
  requiresLivePages: false,
  run: (context) => [
    buildFinding(impactAssessment, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
      status: "manual-review",
      affectedUrl: context.pages[0]?.url ?? context.config.target.url,
      observedBehavior:
        "Whether the required impact assessments exist and are current cannot be established by scanning a website.",
      expectedBehavior: "A retained, current PIPIA covers every triggering processing activity.",
      manualReviewRequired: true,
    }),
  ],
});

const automatedDecisionTransparency = defineRule({
  id: "pipl-automated-decision-making-transparency",
  requirement:
    "Where personal information is used for automated decision-making, the transparency and fairness of the outcome must be ensured, and the individual must be offered a way to refuse decisions made solely by automated means, or an option not based on their personal characteristics.",
  severity: "high",
  confidence: "low",
  automationLevel: "evidence-only",
  legalReference: "PIPL Art. 24",
  remediation:
    "Offer an easy way to refuse personalised recommendations, and a route to a human decision where an automated one has a significant effect on the individual.",
  run: (context) => {
    const findings: Finding[] = [];
    for (const page of context.pages) {
      const profiling = (page.consentFlow?.requestsBeforeAnyConsentAction ?? []).filter(
        (request) => classifyDomain(request.domain).category === "advertising"
      );
      if (profiling.length === 0) continue;
      findings.push(
        buildFinding(automatedDecisionTransparency, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "manual-review",
          affectedUrl: page.url,
          observedBehavior: `Advertising or profiling services were observed (${Array.from(new Set(profiling.map((r) => r.domain))).join(", ")}). Whether an option to refuse personalised decision-making is offered cannot be verified automatically.`,
          expectedBehavior:
            "An easy way to refuse automated personalised decision-making is offered where it applies.",
          evidence: [context.evidence.requestLog("Profiling-capable services observed", profiling)],
          manualReviewRequired: true,
        })
      );
    }
    return findings;
  },
});

export const cnPiplPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "CN",
  regulation: IDENTITY.regulation,
  authority: "Cyberspace Administration of China (CAC)",
  version: "1.0.0",
  effectiveDate: "2021-11-01",
  applicability: jurisdictionMatcher(/china|^cn$|pipl|prc/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "pipl-privacy-notice-present",
      requirement:
        "Before processing, the handler must tell the individual its identity and contact method, the purpose and method of processing, the categories of personal information, the retention period, and how to exercise their rights.",
      severity: "high",
      confidence: "high",
      legalReference: "PIPL Art. 17",
      remediation:
        "Publish a notice in clear language covering the handler's identity and contact, purpose and method, categories, retention period, and the routes to exercise rights.",
    }),
    noticeContentsRule(
      IDENTITY,
      {
        id: "pipl-notice-required-contents",
        requirement:
          "The notice must be truthful, accurate and complete, and must cover the matters PIPL Art. 17 enumerates.",
        severity: "medium",
        confidence: "low",
        legalReference: "PIPL Art. 17, 18",
        remediation:
          "Add the missing topics. Keyword presence is not legal sufficiency; have the wording reviewed against Art. 17 by PRC counsel.",
      },
      ["controller-identity", "controller-contact", "processing-purposes", "retention-periods", "data-subject-rights"]
    ),
    separateConsent,
    crossBorderNotice,
    impactAssessment,
    automatedDecisionTransparency,
    consentWithdrawalRule(IDENTITY, {
      id: "pipl-consent-withdrawal-available",
      requirement:
        "Where processing rests on consent, the individual has the right to withdraw it, and the handler must provide a convenient way to do so.",
      severity: "high",
      confidence: "medium",
      legalReference: "PIPL Art. 15",
      remediation: "Provide a convenient, always-available route to withdraw consent.",
    }),
    preCheckedConsentRule(IDENTITY, {
      id: "pipl-consent-not-prechecked",
      requirement:
        "Consent must be given voluntarily and explicitly by the individual on a fully informed basis; a pre-ticked box is not consent.",
      severity: "high",
      confidence: "high",
      legalReference: "PIPL Art. 14",
      remediation: "Ship every consent checkbox unchecked and require an affirmative action.",
    }),
    sensitiveDataFormRule(IDENTITY, {
      id: "pipl-sensitive-information-separate-consent",
      requirement:
        "Sensitive personal information may be processed only for a specific purpose with sufficient necessity, under strict protective measures, and with the individual's separate consent.",
      severity: "critical",
      confidence: "low",
      legalReference: "PIPL Art. 28, 29, 30",
      remediation:
        "Obtain separate consent for each sensitive category, explain the necessity and the effect on the individual's rights, and apply strict protective measures.",
    }),
  ] as Rule[],
};
