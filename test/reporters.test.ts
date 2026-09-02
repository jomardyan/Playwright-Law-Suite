import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSarifReport } from "../src/reporters/SarifReporter.js";
import { renderMarkdownReport } from "../src/reporters/MarkdownReporter.js";
import { renderCsvReport } from "../src/reporters/CsvReporter.js";
import type { Finding, ScanReport } from "../src/engine/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "gdpr-eprivacy-tracking-before-consent",
    packId: "eu-gdpr-eprivacy",
    regulation: "GDPR / ePrivacy Directive",
    jurisdiction: "European Union",
    requirement: "No non-essential trackers before consent.",
    status: "violation",
    severity: "critical",
    confidence: "high",
    automationLevel: "fully-automated",
    affectedUrl: "https://example.com/",
    observedBehavior: 'Request to "google-analytics.com", before consent',
    expectedBehavior: "No such request.",
    evidence: [],
    legalReference: "ePrivacy Directive Art. 5(3)",
    remediation: "Gate the tag behind the CMP.",
    ...overrides,
  };
}

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    meta: {
      tool: "UniVerscan",
      generatedAt: "2026-01-01T00:00:00Z",
      mode: "live",
      target: { url: "https://example.com" },
      jurisdictions: ["European Union"],
      packs: [{ id: "eu-gdpr-eprivacy", regulation: "GDPR", version: "1.0.0" }],
    },
    findings: [finding()],
    suppressedFindings: [],
    thirdPartyServices: [],
    coverage: {
      jurisdictionsSelected: ["European Union"],
      packsLoaded: ["eu-gdpr-eprivacy"],
      rulesEvaluated: 6,
      rulesSkippedNotApplicable: 2,
      rulesNotEvaluated: 1,
      pagesScanned: 3,
      manualReviewItems: 1,
      findingsSuppressedByException: 0,
    },
    riskIndicators: {
      automatedTechnicalCoverage: 0.75,
      detectedTechnicalConformity: 0.5,
      unresolvedComplianceRisk: 0.5,
      manualReviewWorkload: 0.25,
      scanCompleteness: 1,
    },
    ...overrides,
  };
}

describe("SARIF reporter", () => {
  it("emits a valid-shaped SARIF 2.1.0 run with one rule per rule id", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-sarif-"));
    const path = writeSarifReport(report({ findings: [finding(), finding({ affectedUrl: "https://example.com/b" })] }), dir);
    const sarif = JSON.parse(readFileSync(path, "utf-8"));

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe("UniVerscan");
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0].results).toHaveLength(2);
    expect(sarif.runs[0].results[0].level).toBe("error");
    expect(sarif.runs[0].tool.driver.rules[0].properties["security-severity"]).toBe("9.0");
  });

  it("maps a not-evaluated finding to note, never to a passing or absent result", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-sarif-"));
    const path = writeSarifReport(report({ findings: [finding({ status: "not-evaluated" })] }), dir);
    const sarif = JSON.parse(readFileSync(path, "utf-8"));

    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].level).toBe("note");
  });

  it("keeps a suppressed finding in the run, carrying its documented justification", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-sarif-"));
    const path = writeSarifReport(
      report({
        findings: [],
        suppressedFindings: [{ finding: finding(), reason: "Accepted pending CMP migration.", approvedBy: "dpo@example.com" }],
      }),
      dir
    );
    const sarif = JSON.parse(readFileSync(path, "utf-8"));

    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].suppressions[0].justification).toContain("CMP migration");
    expect(sarif.runs[0].results[0].suppressions[0].justification).toContain("dpo@example.com");
  });

  it("anchors a source-mode finding to its real file and line", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-sarif-"));
    const withSource = finding({
      affectedUrl: undefined,
      evidence: [{ type: "source-reference", description: "tag", sourceFile: "/repo/src/app.tsx", sourceLine: 42 }],
    });
    const path = writeSarifReport(report({ findings: [withSource], meta: { ...report().meta, target: { repoPath: "/repo" } } }), dir);
    const sarif = JSON.parse(readFileSync(path, "utf-8"));

    const location = sarif.runs[0].results[0].locations[0].physicalLocation;
    expect(location.artifactLocation.uri).toBe("src/app.tsx");
    expect(location.region.startLine).toBe(42);
  });
});

describe("Markdown reporter", () => {
  it("keeps finding classes separate rather than collapsing them into one count", () => {
    const markdown = renderMarkdownReport(
      report({
        findings: [
          finding({ status: "violation" }),
          finding({ status: "manual-review", ruleId: "manual-rule" }),
          finding({ status: "not-evaluated", ruleId: "unevaluated-rule" }),
        ],
      })
    );

    expect(markdown).toContain("Confirmed technical violations");
    expect(markdown).toContain("Requires manual legal review");
    expect(markdown).toContain("Could not be evaluated automatically");
    expect(markdown).toContain("does not certify legal compliance");
  });

  it("escapes pipe characters so a finding cannot break the table layout", () => {
    const markdown = renderMarkdownReport(report({ findings: [finding({ observedBehavior: "a | b | c" })] }));
    expect(markdown).toContain("a \\| b \\| c");
  });

  it("lists suppressed findings with their reason", () => {
    const markdown = renderMarkdownReport(
      report({ suppressedFindings: [{ finding: finding(), reason: "Risk accepted by the DPO." }] })
    );
    expect(markdown).toContain("Suppressed by documented exception");
    expect(markdown).toContain("Risk accepted by the DPO.");
  });
});

describe("CSV reporter", () => {
  it("quotes every field and doubles embedded quotes", () => {
    const csv = renderCsvReport(report());
    const [header, firstRow] = csv.split("\r\n");

    expect(header.startsWith('"ruleId","packId"')).toBe(true);
    expect(firstRow).toContain('"Request to ""google-analytics.com"", before consent"');
  });

  it("includes suppressed findings flagged as such", () => {
    const csv = renderCsvReport(
      report({ findings: [], suppressedFindings: [{ finding: finding(), reason: "Accepted." }] })
    );
    expect(csv).toContain('"true","Accepted."');
  });
});
