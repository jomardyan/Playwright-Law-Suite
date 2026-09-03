import { describe, expect, it } from "vitest";
import { diffReports, findingKey, renderDiffMarkdown } from "../src/engine/ReportDiff.js";
import type { Finding, ScanReport } from "../src/engine/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "rule-a",
    packId: "pack-x",
    regulation: "Reg",
    jurisdiction: "European Union",
    requirement: "Requirement text.",
    status: "violation",
    severity: "high",
    confidence: "high",
    automationLevel: "fully-automated",
    affectedUrl: "https://example.com/",
    observedBehavior: "Observed.",
    expectedBehavior: "Expected.",
    evidence: [],
    ...overrides,
  };
}

function report(findings: Finding[], generatedAt = "2026-01-01T00:00:00Z"): ScanReport {
  return {
    meta: {
      tool: "UniVerscan",
      generatedAt,
      mode: "live",
      target: { url: "https://example.com" },
      jurisdictions: ["European Union"],
      packs: [],
    },
    findings,
    suppressedFindings: [],
    unreachablePages: [],
    thirdPartyServices: [],
    coverage: {
      jurisdictionsSelected: ["European Union"],
      packsLoaded: [],
      rulesEvaluated: findings.length,
      rulesSkippedNotApplicable: 0,
      rulesNotEvaluated: 0,
      pagesScanned: 1,
      pagesUnreachable: 0,
      manualReviewItems: 0,
      findingsSuppressedByException: 0,
    },
    riskIndicators: {
      automatedTechnicalCoverage: 1,
      detectedTechnicalConformity: 1,
      unresolvedComplianceRisk: 0,
      manualReviewWorkload: 0,
      scanCompleteness: 1,
    },
  };
}

describe("findingKey", () => {
  it("matches the same rule on the same location regardless of wording", () => {
    const a = finding({ observedBehavior: "one phrasing" });
    const b = finding({ observedBehavior: "another phrasing" });
    expect(findingKey(a)).toBe(findingKey(b));
  });

  it("distinguishes the same rule on different pages", () => {
    const a = finding({ affectedUrl: "https://example.com/a" });
    const b = finding({ affectedUrl: "https://example.com/b" });
    expect(findingKey(a)).not.toBe(findingKey(b));
  });
});

describe("diffReports", () => {
  it("classifies new, resolved, changed, and unchanged findings", () => {
    const baseline = report([
      finding({ ruleId: "fixed-rule" }),
      finding({ ruleId: "stable-rule" }),
      finding({ ruleId: "downgraded-rule", severity: "critical", status: "violation" }),
    ]);
    const current = report(
      [
        finding({ ruleId: "stable-rule" }),
        finding({ ruleId: "downgraded-rule", severity: "medium", status: "risk" }),
        finding({ ruleId: "new-rule" }),
      ],
      "2026-02-01T00:00:00Z"
    );

    const diff = diffReports(baseline, current);

    expect(diff.newFindings.map((d) => d.finding.ruleId)).toEqual(["new-rule"]);
    expect(diff.resolvedFindings.map((d) => d.finding.ruleId)).toEqual(["fixed-rule"]);
    expect(diff.changedFindings).toHaveLength(1);
    expect(diff.changedFindings[0].ruleId).toBe("downgraded-rule");
    expect(diff.changedFindings[0].severityChanged).toBe(true);
    expect(diff.changedFindings[0].statusChanged).toBe(true);
    expect(diff.unchangedCount).toBe(1);
  });

  it("flags a rule that stopped being evaluated instead of counting it as fixed", () => {
    const baseline = report([finding({ ruleId: "consent-rule", status: "violation" })]);
    const current = report([finding({ ruleId: "consent-rule", status: "not-evaluated" })]);

    const diff = diffReports(baseline, current);

    expect(diff.evaluationRegressions).toEqual(["consent-rule"]);
    expect(diff.resolvedFindings).toHaveLength(0);
  });

  it("reports no change when both reports are identical", () => {
    const findings = [finding({ ruleId: "a" }), finding({ ruleId: "b" })];
    const diff = diffReports(report(findings), report(findings));

    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
    expect(diff.changedFindings).toHaveLength(0);
    expect(diff.unchangedCount).toBe(2);
  });
});

describe("renderDiffMarkdown", () => {
  it("warns rather than asserting a fix when a finding merely disappeared", () => {
    const diff = diffReports(report([finding({ ruleId: "gone" })]), report([]));
    const markdown = renderDiffMarkdown(diff);

    expect(markdown).toContain("Resolved findings (1)");
    expect(markdown).toContain("suppressed by a config exception");
    expect(markdown).toContain("`gone`");
  });

  it("flags a comparison between two different targets", () => {
    const baseline = report([]);
    const current = report([]);
    current.meta.target = { url: "https://other.example" };

    expect(renderDiffMarkdown(diffReports(baseline, current))).toContain("target different subjects");
  });
});
