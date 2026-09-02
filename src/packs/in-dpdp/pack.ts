import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "in-dpdp";
const REGULATION = "Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025";
const JURISDICTION = "India";

/**
 * Notice items the Act and the Rules require a Data Fiduciary to give a Data
 * Principal, in itemised and plain language, at or before the point consent
 * is requested.
 */
const NOTICE_KEYWORDS: Record<string, string[]> = {
  "itemised-personal-data": ["personal data we collect", "categories of personal data", "data we collect"],
  "processing-purpose": ["purpose of processing", "why we process", "purpose for which"],
  "goods-or-services": ["goods or services", "service for which"],
  "consent-withdrawal": ["withdraw your consent", "withdraw consent", "withdrawal of consent"],
  "grievance-redressal": ["grievance", "grievance officer", "grievance redressal"],
  "data-protection-board": ["data protection board", "board established under"],
  "rights-of-data-principal": ["right to access", "right to correction", "right to erasure", "right to nominate"],
};

function evaluateNotice(text: string): Array<{ item: string; found: boolean; matched: string[] }> {
  const lower = text.toLowerCase();
  return Object.entries(NOTICE_KEYWORDS).map(([item, keywords]) => {
    const matched = keywords.filter((keyword) => lower.includes(keyword));
    return { item, found: matched.length > 0, matched };
  });
}

const consentNoticePresent = defineRule({
  id: "dpdp-consent-notice-present",
  requirement:
    "A Data Fiduciary must give the Data Principal a notice, independent of any other information, describing the personal data collected and the purpose of processing, at or before the request for consent.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "DPDP Act 2023 s. 5; DPDP Rules 2025 Rule 3",
  remediation:
    "Publish a standalone DPDP notice, reachable from the consent request itself, that itemises the personal data, the purpose, the goods or services it enables, and the routes to withdraw consent and to complain.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const policy = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
      if (policy?.url) continue;
      findings.push(
        buildFinding(consentNoticePresent, PACK_ID, REGULATION, JURISDICTION, {
          status: "missing-disclosure",
          affectedUrl: page.url,
          observedBehavior: "No privacy notice or policy link was found on this page.",
          expectedBehavior: "A DPDP-compliant notice is reachable at or before the point consent is requested.",
        })
      );
    }
    return findings;
  },
});

const noticeContents = defineRule({
  id: "dpdp-notice-required-contents",
  requirement:
    "The notice must state the personal data and purpose in itemised form, and must describe how the Data Principal can withdraw consent, exercise their rights, and complain to the Data Protection Board.",
  severity: "medium",
  confidence: "low",
  automationLevel: "partially-automated",
  legalReference: "DPDP Act 2023 s. 5(1) and s. 5(2); DPDP Rules 2025 Rule 3(1)",
  remediation:
    "Add the missing items to the notice. Keyword presence is not legal sufficiency; have the wording reviewed against Rule 3 by an Indian data protection practitioner.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const policy = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
      if (!policy?.url) continue;
      if (policy.textLength === 0) {
        findings.push(
          buildFinding(noticeContents, PACK_ID, REGULATION, JURISDICTION, {
            status: "not-evaluated",
            affectedUrl: policy.url,
            observedBehavior: "The linked notice could not be fetched or contained no readable text, so its contents were not assessed.",
            expectedBehavior: "The notice is readable and contains every item Rule 3 requires.",
            manualReviewRequired: true,
          })
        );
        continue;
      }
      // The privacy scanner only runs its GDPR keyword pass on the document.
      // Re-derive the DPDP items from the same matched keywords it recorded,
      // falling back to a manual-review item when nothing overlaps.
      const haystack = policy.disclosures.flatMap((d) => d.matchedKeywords).join(" ");
      const items = evaluateNotice(haystack);
      const missing = items.filter((item) => !item.found).map((item) => item.item);
      if (missing.length === 0) continue;
      findings.push(
        buildFinding(noticeContents, PACK_ID, REGULATION, JURISDICTION, {
          status: "manual-review",
          affectedUrl: policy.url,
          observedBehavior: `Keyword matching did not find DPDP notice item(s) in the published notice: ${missing.join(", ")}. Wording differences are common, so this is a review prompt rather than a conclusion.`,
          expectedBehavior: "Every Rule 3 notice item is present in the notice.",
          evidence: [context.evidence.note("DPDP notice item detection", items)],
          manualReviewRequired: true,
        })
      );
    }
    return findings;
  },
});

const consentWithdrawalEase = defineRule({
  id: "dpdp-consent-withdrawal-ease",
  requirement:
    "The Data Principal must be able to withdraw consent at any time, and the ease of doing so must be comparable to the ease with which consent was given.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "DPDP Act 2023 s. 6(4) and s. 6(6)",
  remediation:
    "Provide a withdrawal control on the same surface as the consent request, requiring no more steps than granting consent did.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow) continue;
      if (!flow.bannerAcceptControlFound) continue;
      if (flow.withdrawalControlFound) continue;
      findings.push(
        buildFinding(consentWithdrawalEase, PACK_ID, REGULATION, JURISDICTION, {
          status: "probable-violation",
          affectedUrl: page.url,
          observedBehavior:
            "Consent could be given in one click, but no equivalent withdrawal control was reachable in the same way afterwards.",
          expectedBehavior: "Withdrawing consent is as easy as giving it.",
          evidence: [
            context.evidence.consentSequence("Consent states captured", flow.states.map((s) => s.consentState)),
          ],
        })
      );
    }
    return findings;
  },
});

const grievanceOfficer = defineRule({
  id: "dpdp-grievance-contact-published",
  requirement:
    "A Data Fiduciary must publish the business contact details of a Data Protection Officer, or of a person able to answer questions about the processing, and provide a grievance redressal mechanism.",
  severity: "medium",
  confidence: "low",
  automationLevel: "partially-automated",
  legalReference: "DPDP Act 2023 s. 8(9) and s. 13; DPDP Rules 2025 Rule 13",
  remediation:
    "Publish a named contact and a working grievance route on the website, and state the period within which grievances are answered.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const policy = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
      if (!policy?.url || policy.textLength === 0) continue;
      const hasContact = policy.disclosures.some(
        (d) => (d.category === "controller-contact" || d.category === "dpo-information") && d.status === "detected"
      );
      if (hasContact) continue;
      findings.push(
        buildFinding(grievanceOfficer, PACK_ID, REGULATION, JURISDICTION, {
          status: "missing-disclosure",
          affectedUrl: policy.url,
          observedBehavior: "The published notice does not appear to name a contact or a grievance redressal route.",
          expectedBehavior: "A named contact and a grievance mechanism are published and reachable.",
          evidence: [context.evidence.note("Contact-related disclosure detection", policy.disclosures)],
        })
      );
    }
    return findings;
  },
});

const childrenProcessing = defineRule({
  id: "dpdp-children-verifiable-consent",
  requirement:
    "Processing the personal data of a child (under 18) requires verifiable consent from a parent or lawful guardian, and tracking, behavioural monitoring, and targeted advertising directed at children are prohibited.",
  severity: "critical",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "DPDP Act 2023 s. 9; DPDP Rules 2025 Rule 10",
  remediation:
    "If any part of the service is directed at or likely to be accessed by users under 18, implement verifiable parental consent and disable behavioural tracking and targeted advertising for those users.",
  run: (context) => {
    const page = context.pages[0];
    if (!page) return [];
    return [
      buildFinding(childrenProcessing, PACK_ID, REGULATION, JURISDICTION, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "Whether the service processes children's data, and whether verifiable parental consent is obtained, cannot be determined by scanning. India's threshold is 18, higher than most other regimes.",
        expectedBehavior:
          "Verifiable parental consent is obtained for users under 18, and no behavioural tracking or targeted advertising is directed at them.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const inDpdpPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "IN",
  regulation: REGULATION,
  authority: "Data Protection Board of India; Ministry of Electronics and Information Technology",
  version: "1.0.0",
  /**
   * The Rules were notified on 14 November 2025 with a phased runway; the
   * substantive obligations below become enforceable on 13 May 2027, which
   * is the date recorded here so a report never implies they already bite.
   */
  effectiveDate: "2027-05-13",
  applicability: (config) =>
    config.jurisdictions.some((j) => /india|dpdp|bharat/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /india/i.test(m)),
  rules: [consentNoticePresent, noticeContents, consentWithdrawalEase, grievanceOfficer, childrenProcessing] as Rule[],
};
