import type { AxeViolationSummary } from "../../modules/accessibility/AccessibilityScanner.js";
import type { Finding, RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";
import { jurisdictionMatcher, type PackIdentity } from "../commonRules.js";

const IDENTITY: PackIdentity = {
  packId: "us-ada-title-ii",
  regulation: "ADA Title II web and mobile accessibility rule (28 CFR Part 35, Subpart H)",
  jurisdiction: "United States - public entities",
};

/**
 * The DOJ's 2024 rule is the first time a specific technical standard has
 * been codified into ADA regulations: WCAG 2.1 Level AA, for the web content
 * and mobile apps of state and local government entities.
 *
 * WCAG 2.1 AA, not 2.2 - so the 2.2-only success criteria are deliberately
 * excluded here. Reporting a 2.2 failure as an ADA Title II violation would
 * assert an obligation the rule does not impose.
 */
const WCAG_21_AA_TAGS = new Set(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);

function isTitleTwoRelevant(violation: AxeViolationSummary): boolean {
  return violation.tags.some((tag) => WCAG_21_AA_TAGS.has(tag));
}

const wcag21Conformance = defineRule({
  id: "ada-title-ii-wcag-21-aa-conformance",
  requirement:
    "Web content that a public entity provides or makes available must conform to WCAG 2.1 Level AA, unless an exception applies.",
  severity: "high",
  confidence: "high",
  automationLevel: "partially-automated",
  legalReference:
    "28 CFR 35.200 (compliance date 26 April 2027 for public entities serving 50,000 or more; 26 April 2028 for smaller entities and special district governments, as extended by DOJ on 20 April 2026)",
  remediation:
    "Fix each WCAG 2.1 A/AA failure listed in the evidence. Automated checks cover only part of the standard; complete the remainder with manual and assistive-technology testing.",
  run: (context) => {
    const findings: Finding[] = [];
    for (const page of context.pages) {
      const relevant = page.accessibilityViolations.filter(isTitleTwoRelevant);
      if (relevant.length === 0) continue;
      findings.push(
        buildFinding(wcag21Conformance, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
          status: "violation",
          affectedUrl: page.url,
          observedBehavior: `${relevant.length} WCAG 2.1 A/AA failure(s) detected on this page: ${relevant
            .map((violation) => violation.id)
            .join(", ")}.`,
          expectedBehavior: "No WCAG 2.1 Level A/AA failures, the technical standard the rule adopts.",
          evidence: [
            context.evidence.accessibilityResult(
              "WCAG 2.1 A/AA violations relevant to ADA Title II",
              relevant.map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                help: violation.help,
                nodeCount: violation.nodes.length,
              }))
            ),
          ],
          manualReviewRequired: false,
        })
      );
    }
    return findings;
  },
});

const conformingAlternate = defineRule({
  id: "ada-title-ii-exception-documented",
  requirement:
    "A public entity relying on one of the rule's exceptions - archived web content, pre-existing conventional electronic documents, third-party content, individualised password-protected documents, or pre-existing social media posts - must be able to establish that the exception genuinely applies.",
  severity: "manual-review",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "28 CFR 35.201 (exceptions); 35.202 (conforming alternate versions)",
  remediation:
    "Document which exception covers each non-conforming item. A conforming alternate version is permitted only where technical or legal limitations make direct accessibility impossible.",
  requiresLivePages: false,
  run: (context) => [
    buildFinding(conformingAlternate, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
      status: "manual-review",
      affectedUrl: context.pages[0]?.url ?? context.config.target.url,
      observedBehavior:
        "Whether any non-conforming content falls within one of the rule's exceptions cannot be determined by scanning; the exceptions turn on the content's origin, age and function.",
      expectedBehavior: "Every non-conforming item is covered by a documented, genuinely applicable exception.",
      manualReviewRequired: true,
    }),
  ],
});

const fundamentalAlteration = defineRule({
  id: "ada-title-ii-undue-burden-assessment",
  requirement:
    "A public entity that does not fully comply on the basis of fundamental alteration or undue financial and administrative burden must document that determination, made by the head of the entity or their designee, with a written statement of the reasons.",
  severity: "manual-review",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "28 CFR 35.204",
  remediation:
    "Where full compliance is not achieved, record the written determination and reasons, and still take any other action that would not result in such an alteration or burden.",
  requiresLivePages: false,
  run: (context) => [
    buildFinding(fundamentalAlteration, IDENTITY.packId, IDENTITY.regulation, IDENTITY.jurisdiction, {
      status: "manual-review",
      affectedUrl: context.pages[0]?.url ?? context.config.target.url,
      observedBehavior:
        "Whether a fundamental-alteration or undue-burden determination is being relied on, and whether it is documented as the rule requires, cannot be established from the service.",
      expectedBehavior:
        "Any reliance on 35.204 is backed by a written, reasoned determination by the head of the entity or their designee.",
      manualReviewRequired: true,
    }),
  ],
});

export const usAdaTitleIiPack: RegulatoryPack = {
  id: IDENTITY.packId,
  jurisdiction: IDENTITY.jurisdiction,
  country: "US",
  regulation: IDENTITY.regulation,
  authority: "U.S. Department of Justice, Civil Rights Division",
  version: "1.0.0",
  effectiveDate: "2027-04-26",
  sectorRestrictions: ["government", "public-sector", "education", "healthcare-public"],
  /**
   * Title II binds state and local government entities, not private
   * businesses, so this pack is deliberately narrower than the jurisdiction
   * alone: it also needs a public-sector signal. A private US retailer would
   * otherwise be told it must meet a rule that does not apply to it.
   * (Private businesses fall under Title III, which has no codified
   * technical standard, and are covered by the `wcag-accessibility` pack.)
   */
  applicability: (config) => {
    const usTargeted = jurisdictionMatcher(/united states|^us$|u\.s\.|usa|ada title ii/i)(config);
    if (!usTargeted) return false;
    const sector = config.businessSector ?? "";
    if (sector.length === 0) return false;
    return /government|public[- ]sector|municipal|state|county|city|public[- ]school|university|public[- ]transit|library/i.test(
      sector
    );
  },
  rules: [wcag21Conformance, conformingAlternate, fundamentalAlteration] as Rule[],
};
