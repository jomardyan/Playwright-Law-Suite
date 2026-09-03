import type { RegulatoryPack, Rule, Severity } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "wcag-accessibility";
const REGULATION = "WCAG (Web Content Accessibility Guidelines)";
const JURISDICTION = "Global";

function impactToSeverity(impact: string | null): Severity {
  switch (impact) {
    case "critical":
      return "critical";
    case "serious":
      return "high";
    case "moderate":
      return "medium";
    case "minor":
      return "low";
    default:
      return "medium";
  }
}

const axeViolations = defineRule({
  id: "wcag-axe-core-violations",
  requirement: "Pages must not contain automatically detectable WCAG violations for the configured conformance level.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "WCAG 2.2 (W3C Recommendation); EN 301 549; ADA Title II/III technical alignment",
  remediation: "Fix each violation per the axe-core rule's help URL; see the evidence for affected selectors.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const violation of page.accessibilityViolations) {
        const finding = buildFinding(axeViolations, PACK_ID, REGULATION, JURISDICTION, {
          status: "violation",
          affectedUrl: page.url,
          affectedElement: violation.nodes[0]?.target.join(" ") ?? violation.id,
          observedBehavior: `${violation.help} (rule: ${violation.id}, impact: ${violation.impact ?? "unknown"}), affecting ${violation.nodes.length} element(s).`,
          expectedBehavior: "No axe-core violations for the configured WCAG tag set.",
          evidence: [context.evidence.accessibilityResult(`axe-core violation: ${violation.id}`, violation)],
          manualReviewRequired: false,
        });
        // axe reports its own per-violation impact; use that instead of the rule's static default severity.
        findings.push({ ...finding, severity: impactToSeverity(violation.impact) });
      }
    }
    return findings;
  },
});

const interactionChecks = defineRule({
  id: "wcag-interaction-checks",
  requirement: "Keyboard and assistive-technology interaction patterns (skip links, focus visibility, focus trapping, accessible authentication) must meet WCAG 2.2 success criteria.",
  severity: "medium",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "WCAG 2.2 SC 2.4.1, 2.4.7, 2.4.11, 3.3.8",
  remediation: "Address each failed or unresolved interaction check; several require manual assistive-technology testing.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const check of page.interactionChecks) {
        if (check.passed === false) {
          findings.push(
            buildFinding(interactionChecks, PACK_ID, REGULATION, JURISDICTION, {
              status: "violation",
              affectedUrl: page.url,
              affectedElement: check.id,
              observedBehavior: check.detail,
              expectedBehavior: check.description,
            })
          );
        } else if (check.passed === null) {
          findings.push(
            buildFinding(interactionChecks, PACK_ID, REGULATION, JURISDICTION, {
              status: "manual-review",
              affectedUrl: page.url,
              affectedElement: check.id,
              observedBehavior: check.detail,
              expectedBehavior: check.description,
              manualReviewRequired: true,
            })
          );
        }
      }
    }
    return findings;
  },
});

/**
 * axe reports three outcomes, not two: passes, violations, and checks it
 * started but could not decide - contrast against a background image, an
 * accessible name it cannot resolve, an element it cannot see into.
 *
 * These were being discarded, which meant a report listed a page as having
 * no violations when part of the page had not actually been assessed. They
 * are surfaced here as review items, never as violations: axe did not
 * conclude, so neither does this.
 */
const axeIncomplete = defineRule({
  id: "wcag-axe-core-incomplete",
  requirement: "Automated accessibility checks that could not be decided must be reviewed by a person, not treated as passes.",
  severity: "medium",
  confidence: "medium",
  automationLevel: "manual-review-required",
  legalReference: "WCAG 2.2 (W3C Recommendation); EN 301 549",
  remediation: "Review each listed element against the axe rule's help URL and decide the outcome by hand.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const item of page.accessibilityIncomplete ?? []) {
        findings.push(
          buildFinding(axeIncomplete, PACK_ID, REGULATION, JURISDICTION, {
            status: "manual-review",
            affectedUrl: page.url,
            affectedElement: item.nodes[0]?.target.join(" ") ?? item.id,
            observedBehavior: `${item.help} (rule: ${item.id}) could not be decided automatically on ${item.nodes.length} element(s); axe returned it as incomplete.`,
            expectedBehavior: "Every applicable success criterion is assessed, by automation or by a person.",
            evidence: [context.evidence.accessibilityResult(`axe-core incomplete: ${item.id}`, item)],
            manualReviewRequired: true,
          })
        );
      }
    }
    return findings;
  },
});

export const wcagAccessibilityPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "Global",
  regulation: REGULATION,
  authority: "W3C Web Accessibility Initiative",
  version: "2.2.0",
  effectiveDate: "2023-10-05",
  applicability: () => true,
  rules: [axeViolations, axeIncomplete, interactionChecks] as Rule[],
};
