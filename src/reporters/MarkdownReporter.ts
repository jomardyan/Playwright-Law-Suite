import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, FindingStatus, ScanReport } from "../engine/types.js";

const STATUS_ORDER: FindingStatus[] = [
  "violation",
  "probable-violation",
  "risk",
  "missing-disclosure",
  "inconsistent",
  "manual-review",
  "not-evaluated",
  "informational",
  "pass",
];

const STATUS_LABEL: Record<FindingStatus, string> = {
  violation: "Confirmed technical violations",
  "probable-violation": "Probable violations",
  risk: "Compliance risks",
  "missing-disclosure": "Missing disclosures",
  inconsistent: "Inconsistent behavior",
  "manual-review": "Requires manual legal review",
  "not-evaluated": "Could not be evaluated automatically",
  informational: "Informational",
  pass: "Passed checks",
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function groupByStatus(findings: Finding[]): Map<FindingStatus, Finding[]> {
  const grouped = new Map<FindingStatus, Finding[]>();
  for (const finding of findings) {
    const bucket = grouped.get(finding.status) ?? [];
    bucket.push(finding);
    grouped.set(finding.status, bucket);
  }
  return grouped;
}

/**
 * Renders the report as Markdown suitable for a CI job summary or a PR
 * comment. Finding classes are kept apart on purpose: a single "N issues"
 * number would collapse confirmed violations, items awaiting legal review,
 * and checks that could not run into one misleading figure.
 */
export function renderMarkdownReport(report: ScanReport): string {
  const lines: string[] = [];
  const grouped = groupByStatus(report.findings);

  lines.push("# UniVerscan compliance scan");
  lines.push("");
  lines.push(
    `**Target:** ${report.meta.target.url ?? report.meta.target.repoPath ?? "n/a"} · **Mode:** ${report.meta.mode} · **Generated:** ${report.meta.generatedAt}`
  );
  lines.push("");
  lines.push(
    `**Jurisdictions:** ${report.meta.jurisdictions.join(", ") || "none selected"} · **Packs:** ${
      report.meta.packs.map((p) => `${p.id}@${p.version}`).join(", ") || "none"
    }`
  );
  lines.push("");
  lines.push(
    "> UniVerscan reports evidence of technical non-conformity and items needing human review. It does not certify legal compliance."
  );
  lines.push("");

  const detection = report.meta.scopeDetection;
  if (detection) {
    lines.push("## Scope (inferred by autoscan)");
    lines.push("");
    lines.push(
      "> These jurisdictions were **inferred from the site**, not supplied. A market that was not detected was not scanned, and an unscanned market is an unknown rather than a clean one."
    );
    lines.push("");
    if (detection.selected.length === 0) {
      lines.push("No target market could be determined from this site.");
      lines.push("");
    } else {
      lines.push("| Market | Confidence | Evidence |");
      lines.push("| --- | --- | --- |");
      for (const market of detection.selected) {
        lines.push(
          `| ${escapeCell(market.jurisdiction)} | ${market.confidence} | ${escapeCell(
            market.evidence.map((s) => s.detail).join("; ")
          )} |`
        );
      }
      lines.push("");
    }
    if (detection.considered.length > 0) {
      lines.push("Considered but not scanned (evidence too thin):");
      lines.push("");
      for (const market of detection.considered) {
        lines.push(`- **${escapeCell(market.jurisdiction)}** - ${escapeCell(market.evidence.map((s) => s.detail).join("; "))}`);
      }
      lines.push("");
    }
    for (const note of detection.notes) lines.push(`- ${note}`);
    lines.push("");
  }

  lines.push("## Finding classes");
  lines.push("");
  lines.push("| Class | Count |");
  lines.push("| --- | ---: |");
  for (const status of STATUS_ORDER) {
    const count = grouped.get(status)?.length ?? 0;
    if (count === 0) continue;
    lines.push(`| ${STATUS_LABEL[status]} | ${count} |`);
  }
  if (report.suppressedFindings.length > 0) {
    lines.push(`| Suppressed by documented exception | ${report.suppressedFindings.length} |`);
  }
  lines.push("");

  lines.push("## Coverage");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Pages scanned | ${report.coverage.pagesScanned} |`);
  lines.push(`| Rules evaluated | ${report.coverage.rulesEvaluated} |`);
  lines.push(`| Rules not applicable | ${report.coverage.rulesSkippedNotApplicable} |`);
  lines.push(`| Rules that could not run | ${report.coverage.rulesNotEvaluated} |`);
  lines.push(`| Pages unreachable | ${report.coverage.pagesUnreachable ?? 0} |`);
  lines.push(`| Manual review items | ${report.coverage.manualReviewItems} |`);
  lines.push(`| Automated technical coverage | ${pct(report.riskIndicators.automatedTechnicalCoverage)} |`);
  lines.push(`| Unresolved compliance risk | ${pct(report.riskIndicators.unresolvedComplianceRisk)} |`);
  lines.push(`| Scan completeness | ${pct(report.riskIndicators.scanCompleteness)} |`);
  lines.push("");

  for (const status of STATUS_ORDER) {
    const bucket = grouped.get(status);
    if (!bucket || bucket.length === 0) continue;
    lines.push(`## ${STATUS_LABEL[status]} (${bucket.length})`);
    lines.push("");
    lines.push("| Severity | Confidence | Rule | Regulation | Where | Observed |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const finding of bucket) {
      const where = finding.affectedUrl ?? finding.affectedElement ?? "-";
      lines.push(
        `| ${finding.severity} | ${finding.confidence} | \`${escapeCell(finding.ruleId)}\` | ${escapeCell(
          finding.regulation
        )} | ${escapeCell(truncate(where, 80))} | ${escapeCell(truncate(finding.observedBehavior, 200))} |`
      );
    }
    lines.push("");
  }

  if (report.suppressedFindings.length > 0) {
    lines.push(`## Suppressed by documented exception (${report.suppressedFindings.length})`);
    lines.push("");
    lines.push("These risks were accepted in the scan configuration. They are recorded, not resolved.");
    lines.push("");
    lines.push("| Rule | Severity | Reason | Accepted by | Expires |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.suppressedFindings) {
      lines.push(
        `| \`${escapeCell(entry.finding.ruleId)}\` | ${entry.finding.severity} | ${escapeCell(
          truncate(entry.reason, 200)
        )} | ${escapeCell(entry.approvedBy ?? "-")} | ${escapeCell(entry.expires ?? "-")} |`
      );
    }
    lines.push("");
  }

  if ((report.unreachablePages ?? []).length > 0) {
    lines.push(`## Pages that could not be loaded (${report.unreachablePages.length})`);
    lines.push("");
    lines.push("These pages were not scanned. Nothing has been established about them - they are unknown, not clean.");
    lines.push("");
    lines.push("| URL | Reason |");
    lines.push("| --- | --- |");
    for (const entry of report.unreachablePages) {
      lines.push(`| ${escapeCell(truncate(entry.url, 100))} | ${escapeCell(entry.reason)} |`);
    }
    lines.push("");
  }

  if (report.thirdPartyServices.length > 0) {
    lines.push(`## Third-party services observed (${report.thirdPartyServices.length})`);
    lines.push("");
    lines.push("| Domain | Category | Earliest consent state | First seen on |");
    lines.push("| --- | --- | --- | --- |");
    for (const record of report.thirdPartyServices) {
      lines.push(
        `| ${escapeCell(record.domain)} | ${escapeCell(record.category)} | ${escapeCell(
          record.consentState
        )} | ${escapeCell(truncate(record.firstObservedOnPage, 80))} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function writeMarkdownReport(report: ScanReport, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, "report.md");
  writeFileSync(path, renderMarkdownReport(report), "utf-8");
  return path;
}
