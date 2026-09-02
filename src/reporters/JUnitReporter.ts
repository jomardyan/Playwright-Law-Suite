import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Severity, ScanReport } from "../engine/types.js";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const VIOLATION_STATUSES = new Set(["violation", "probable-violation", "risk", "missing-disclosure", "inconsistent"]);

/**
 * Produces a JUnit-style XML report so CI systems can render findings as
 * test results. A finding "fails" the corresponding testcase when its
 * status represents a violation-class result AND its severity is in
 * config.ci.failOn; otherwise it is recorded as a passing testcase with the
 * finding text in system-out, or skipped for not-evaluated findings.
 */
export function writeJUnitReport(report: ScanReport, outputDir: string, failOn: Severity[]): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, "report.junit.xml");

  const failCount = report.findings.filter((f) => VIOLATION_STATUSES.has(f.status) && failOn.includes(f.severity)).length;
  const skippedCount = report.findings.filter((f) => f.status === "not-evaluated").length;

  const testcases = report.findings
    .map((finding) => {
      const name = escapeXml(`${finding.packId}/${finding.ruleId}${finding.affectedUrl ? ` @ ${finding.affectedUrl}` : ""}`);
      const classname = escapeXml(finding.regulation);
      if (finding.status === "not-evaluated") {
        return `    <testcase name="${name}" classname="${classname}"><skipped message="${escapeXml(finding.observedBehavior)}" /></testcase>`;
      }
      if (VIOLATION_STATUSES.has(finding.status) && failOn.includes(finding.severity)) {
        return `    <testcase name="${name}" classname="${classname}"><failure message="${escapeXml(finding.observedBehavior)}" type="${escapeXml(finding.severity)}">${escapeXml(
          finding.expectedBehavior
        )}</failure></testcase>`;
      }
      return `    <testcase name="${name}" classname="${classname}"><system-out>${escapeXml(finding.observedBehavior)}</system-out></testcase>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="UniVerscan" tests="${report.findings.length}" failures="${failCount}" skipped="${skippedCount}">
  <testsuite name="UniVerscan Compliance Scan" tests="${report.findings.length}" failures="${failCount}" skipped="${skippedCount}">
${testcases}
  </testsuite>
</testsuites>
`;

  writeFileSync(path, xml, "utf-8");
  return path;
}
