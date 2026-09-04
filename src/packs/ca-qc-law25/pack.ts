import { classifyDomain, isNonEssentialTrackingCategory } from "../../utils/domainClassifier.js";
import type { Finding, RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import {
  consentWithdrawalRule,
  jurisdictionMatcher,
  preCheckedConsentRule,
  privacyNoticePresentRule,
  rejectControlRule,
  type PackIdentity,
} from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "ca-qc-law25",
  regulation: "Quebec Law 25 (Act to modernize legislative provisions as regards the protection of personal information)",
  jurisdiction: "Canada - Quebec",
};

/**
 * Law 25 is the strictest privacy regime in North America and differs from
 * federal PIPEDA in ways that matter to a website: it requires opt-in for
 * tracking technologies, and privacy settings that default to the highest
 * level of confidentiality without the user doing anything. It therefore
 * gets its own pack rather than being folded into `ca-pipeda`.
 */

const confidentialityByDefault = defineRule({
  id: "law25-confidentiality-by-default",
  requirement:
    "A person carrying on an enterprise that collects personal information when offering a technological product or service must ensure that its parameters provide the highest level of confidentiality by default, without any intervention by the person concerned.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Act respecting the protection of personal information in the private sector, s. 9.1 (in force 22 September 2023)",
  remediation:
    "Ship every tracking, profiling and sharing setting off by default. The user must have to switch protection down, never up.",
  run: (context) => {
    const findings: Finding[] = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow) continue;
      const active = flow.requestsBeforeAnyConsentAction.filter((request) =>
        isNonEssentialTrackingCategory(classifyDomain(request.domain).category)
      );
      if (active.length === 0) continue;
      const domains = Array.from(new Set(active.map((request) => request.domain)));
      findings.push(
        buildFinding(confidentialityByDefault, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "violation",
          affectedUrl: page.url,
          affectedElement: domains.join(", "),
          observedBehavior: `Tracking or profiling services were active on arrival, before the visitor did anything: ${domains.join(", ")}. The default state is therefore not the highest level of confidentiality.`,
          expectedBehavior:
            "On arrival, with no intervention by the visitor, no tracking or profiling technology is active.",
          evidence: [context.evidence.requestLog("Services active before any interaction", active)],
          manualReviewRequired: false,
        })
      );
    }
    return findings;
  },
});

const profilingNotice = defineRule({
  id: "law25-profiling-technology-notice",
  requirement:
    "A person who collects personal information using technology that allows the person concerned to be identified, located or profiled must first inform them of the use of that technology and of the means available to deactivate it.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Act respecting the protection of personal information in the private sector, s. 8.1",
  remediation:
    "Before any identifying, locating or profiling technology runs, tell the visitor it is in use and how to switch it off.",
  run: (context) => {
    const findings: Finding[] = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow) continue;
      const profiling = flow.requestsBeforeAnyConsentAction.filter((request) =>
        isNonEssentialTrackingCategory(classifyDomain(request.domain).category)
      );
      if (profiling.length === 0) continue;
      const hasCookieNotice = page.privacyDocuments.some((doc) => doc.label === "cookie-policy" && doc.url);
      if (hasCookieNotice && flow.bannerRejectControlFound) continue;
      findings.push(
        buildFinding(profilingNotice, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "probable-violation",
          affectedUrl: page.url,
          observedBehavior: `Profiling-capable technology ran before the visitor was informed${
            hasCookieNotice ? " and could deactivate it" : " or given a cookie notice describing it"
          }.`,
          expectedBehavior:
            "The visitor is told about the technology and given the means to deactivate it, before it runs.",
          evidence: [context.evidence.requestLog("Profiling technology observed", profiling)],
        })
      );
    }
    return findings;
  },
});

const privacyOfficer = defineRule({
  id: "law25-privacy-officer-published",
  requirement:
    "The person with the highest authority within the enterprise is responsible for protecting personal information; where that function is delegated, the title and contact information of the person in charge must be published on the enterprise's website.",
  severity: "medium",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Act respecting the protection of personal information in the private sector, s. 3.1",
  remediation:
    "Publish the title and contact information of the person in charge of the protection of personal information on the website.",
  run: (context) => {
    const findings: Finding[] = [];
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
        buildFinding(privacyOfficer, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "missing-disclosure",
          affectedUrl: notice.url,
          observedBehavior:
            "No title or contact information for a person in charge of personal information protection was found in the published notice.",
          expectedBehavior: "The title and contact information of the person in charge are published on the website.",
          evidence: [context.evidence.note("Contact disclosure detection", notice.disclosures)],
        })
      );
    }
    return findings;
  },
});

const dataPortability = defineRule({
  id: "law25-data-portability-route",
  requirement:
    "On request, computerized personal information collected from the person concerned must be communicated to them in a structured, commonly used technological format, or to any person or body authorised by law to collect it.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Act respecting the protection of personal information in the private sector, s. 27 (in force 22 September 2024)",
  remediation:
    "Provide a documented route for a portability request, and be able to deliver the data in a structured, commonly used technological format.",
  run: (context) => {
    const page = context.pages[0];
    if (!page) return [];
    return [
      buildFinding(dataPortability, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior:
          "Whether a portability request route exists, and whether it produces a structured, commonly used format, cannot be established by scanning.",
        expectedBehavior: "A documented portability route exists and delivers a structured, commonly used format.",
        manualReviewRequired: true,
      }),
    ];
  },
});

export const caQcLaw25Pack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "CA-QC",
  regulation: IDENTITY.regulation,
  authority: "Commission d'acces a l'information du Quebec (CAI)",
  version: "1.0.0",
  effectiveDate: "2023-09-22",
  applicability: jurisdictionMatcher(/quebec|qu[eé]bec|law ?25|ca-qc/i),
  rules: [
    privacyNoticePresentRule(IDENTITY, {
      id: "law25-privacy-policy-published",
      requirement:
        "An enterprise that collects personal information through technological means must publish a privacy policy in clear and simple language on its website.",
      severity: "high",
      confidence: "high",
      legalReference: "Act respecting the protection of personal information in the private sector, s. 8.2",
      remediation: "Publish a privacy policy in clear and simple language, linked prominently from the site.",
    }),
    confidentialityByDefault,
    profilingNotice,
    rejectControlRule(IDENTITY, {
      id: "law25-refusal-offered-with-consent",
      requirement:
        "Consent must be manifest, free and enlightened, and given for specific purposes; the person concerned must be able to refuse.",
      severity: "high",
      confidence: "medium",
      legalReference: "Act respecting the protection of personal information in the private sector, s. 14",
      remediation: "Offer a refusal control on the same layer, no harder to use than the acceptance control.",
    }),
    preCheckedConsentRule(IDENTITY, {
      id: "law25-consent-not-prechecked",
      requirement:
        "Consent must be manifest, free, enlightened and given for specific purposes, and requested separately from any other information; a pre-ticked box is not consent.",
      severity: "high",
      confidence: "high",
      legalReference: "Act respecting the protection of personal information in the private sector, s. 14",
      remediation: "Ship every consent checkbox unchecked and request consent separately from other terms.",
    }),
    consentWithdrawalRule(IDENTITY, {
      id: "law25-consent-withdrawal-available",
      requirement: "Consent may be withdrawn at any time.",
      severity: "high",
      confidence: "medium",
      legalReference: "Act respecting the protection of personal information in the private sector, s. 14, 28",
      remediation: "Provide a permanently available route to withdraw consent.",
    }),
    privacyOfficer,
    dataPortability,
  ] as Rule[],
};
