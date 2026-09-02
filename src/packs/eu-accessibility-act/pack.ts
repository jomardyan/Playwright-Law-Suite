import type { AxeViolationSummary } from "../../modules/accessibility/AccessibilityScanner.js";
import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "eu-accessibility-act";
const REGULATION = "European Accessibility Act (Directive (EU) 2019/882) / EN 301 549";
const JURISDICTION = "European Union";

/**
 * EN 301 549 clause 9 makes WCAG 2.1 Level AA the presumption-of-conformity
 * baseline for web content. axe-core tags every rule with the WCAG levels it
 * maps to, so the EAA-relevant subset is the A/AA tags at 2.0 and 2.1.
 */
const EN_301_549_TAGS = new Set(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);

function isEn301549Relevant(violation: AxeViolationSummary): boolean {
  return violation.tags.some((tag) => EN_301_549_TAGS.has(tag));
}

/**
 * Services in scope of the EAA under Art. 2(2): e-commerce, consumer banking,
 * e-books, electronic communications, passenger transport services, and
 * access to audiovisual media services. Sector is taken from the scan config
 * because no automated signal can establish it reliably.
 */
const IN_SCOPE_SECTOR = /e-?commerce|retail|banking|financial|insurance|telecom|transport|travel|ticketing|e-?book|publishing|media|streaming/i;

const en301549Conformance = defineRule({
  id: "eaa-en-301-549-wcag-aa-conformance",
  requirement:
    "Web content of a service in scope of the European Accessibility Act must meet the EN 301 549 accessibility requirements, which take WCAG 2.1 Level AA as the presumption-of-conformity baseline.",
  severity: "high",
  confidence: "high",
  automationLevel: "partially-automated",
  legalReference:
    "Directive (EU) 2019/882 Art. 4 and Annex I (applicable since 28 June 2025); EN 301 549 v3.2.1 clause 9",
  remediation:
    "Fix each WCAG 2.1 A/AA failure listed in the evidence. Automated checks cover only part of EN 301 549; complete the remaining clauses with manual and assistive-technology testing.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const relevant = page.accessibilityViolations.filter(isEn301549Relevant);
      if (relevant.length === 0) continue;
      findings.push(
        buildFinding(en301549Conformance, PACK_ID, REGULATION, JURISDICTION, {
          status: "violation",
          affectedUrl: page.url,
          observedBehavior: `${relevant.length} WCAG 2.1 A/AA failure(s) detected on this page: ${relevant
            .map((v) => v.id)
            .join(", ")}.`,
          expectedBehavior:
            "No WCAG 2.1 Level A/AA failures, as the EN 301 549 presumption-of-conformity baseline for web content.",
          evidence: [
            context.evidence.accessibilityResult(
              "EN 301 549 relevant axe-core violations",
              relevant.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodeCount: v.nodes.length }))
            ),
          ],
          manualReviewRequired: false,
        })
      );
    }
    return findings;
  },
});

const accessibilityStatementPresent = defineRule({
  id: "eaa-accessibility-statement-present",
  requirement:
    "A service provider must make information on how the service meets the accessibility requirements publicly available, in an accessible format, together with a way for users to report accessibility problems.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Directive (EU) 2019/882 Art. 13 and Annex V; Annex I Section III/IV",
  remediation:
    "Publish an accessibility statement linked from every page. It should describe how the service meets the accessibility requirements, list known limitations, and give an accessible feedback route (email, phone, or an accessible form) for reporting accessibility problems.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const statement = page.privacyDocuments.find((doc) => doc.label === "accessibility-statement");
      if (statement?.url) continue;
      findings.push(
        buildFinding(accessibilityStatementPresent, PACK_ID, REGULATION, JURISDICTION, {
          status: "missing-disclosure",
          affectedUrl: page.url,
          observedBehavior: "No link matching an accessibility statement was found on this page.",
          expectedBehavior:
            "An accessibility statement is linked from the page and describes conformance, known limitations, and a feedback route.",
          evidence: [
            context.evidence.note("Documents detected on page", page.privacyDocuments.map((d) => ({ label: d.label, url: d.url }))),
          ],
        })
      );
    }
    return findings;
  },
});

const feedbackMechanism = defineRule({
  id: "eaa-accessibility-feedback-mechanism",
  requirement:
    "Users must have an accessible way to report accessibility barriers or request information in an accessible format, and that route must itself be usable by people with disabilities.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Directive (EU) 2019/882 Annex I Section IV; Annex V",
  remediation:
    "Offer at least one accessible contact route dedicated to accessibility feedback (a monitored mailbox, phone number, or accessible form) and state its expected response time in the accessibility statement.",
  run: (context) => {
    const statementPages = context.pages.filter((page) =>
      page.privacyDocuments.some((doc) => doc.label === "accessibility-statement" && doc.url)
    );
    // Only raised once per scan: whether a feedback route works, and whether it
    // is itself accessible, cannot be established by loading a page.
    const page = statementPages[0] ?? context.pages[0];
    if (!page) return [];
    return [
      buildFinding(feedbackMechanism, PACK_ID, REGULATION, JURISDICTION, {
        status: "manual-review",
        affectedUrl: page.url,
        observedBehavior: statementPages.length
          ? "An accessibility statement was found; whether its feedback route is monitored and itself accessible cannot be determined automatically."
          : "No accessibility statement was found, so no feedback route could be checked.",
        expectedBehavior:
          "An accessible, monitored feedback route for accessibility problems exists and is documented.",
        manualReviewRequired: true,
      }),
    ];
  },
});

const disproportionateBurdenClaim = defineRule({
  id: "eaa-disproportionate-burden-assessment",
  requirement:
    "A provider relying on the fundamental-alteration or disproportionate-burden exemption must have documented and retained that assessment, and must reassess it periodically.",
  severity: "manual-review",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Directive (EU) 2019/882 Art. 14 and Annex VI",
  remediation:
    "If any accessibility requirement is not met on the basis of disproportionate burden, document the Annex VI assessment, retain it for five years, and be ready to provide it to the market surveillance authority on request.",
  requiresLivePages: false,
  run: (context) => [
    buildFinding(disproportionateBurdenClaim, PACK_ID, REGULATION, JURISDICTION, {
      status: "manual-review",
      affectedUrl: context.pages[0]?.url ?? context.config.target.url,
      observedBehavior:
        "Whether any exemption is being relied on, and whether the required Annex VI assessment exists, cannot be determined from the service itself.",
      expectedBehavior:
        "Every unmet accessibility requirement is backed by a documented, retained, and current Annex VI assessment.",
      manualReviewRequired: true,
    }),
  ],
});

export const euAccessibilityActPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "EU",
  regulation: REGULATION,
  authority: "National market surveillance authorities of the EU Member States",
  version: "1.0.0",
  effectiveDate: "2025-06-28",
  sectorRestrictions: [
    "e-commerce",
    "banking",
    "telecommunications",
    "transport",
    "e-books",
    "audiovisual-media",
  ],
  /**
   * The EAA covers consumer-facing services in the Art. 2(2) list, including
   * providers established outside the EU that offer them to EU consumers. It
   * is therefore keyed to the EU market rather than to company location, and
   * a scan that names no sector still loads the pack so the requirement is
   * surfaced rather than silently skipped.
   */
  applicability: (config) => {
    const euTargeted =
      config.jurisdictions.some((j) => /european union|eu\b|eea|accessibility act|eaa/i.test(j)) ||
      (config.customerMarkets ?? []).some((m) => /european union|eu\b|eea/i.test(m));
    if (!euTargeted) return false;
    if (!config.businessSector) return true;
    return IN_SCOPE_SECTOR.test(config.businessSector);
  },
  rules: [en301549Conformance, accessibilityStatementPresent, feedbackMechanism, disproportionateBurdenClaim] as Rule[],
};
