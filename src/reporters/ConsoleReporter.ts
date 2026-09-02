import type { ScanReport } from "../engine/types.js";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "informational", "manual-review"] as const;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Prints a plain-text summary to the console. This intentionally reports
 * risk indicators, not a pass/fail compliance verdict - see the disclaimer
 * printed at the bottom.
 */
export function printConsoleReport(report: ScanReport): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("UniVerscan Compliance Scan Report");
  lines.push("==================================");
  lines.push(`Target: ${report.meta.target.url ?? report.meta.target.repoPath ?? "unknown"}`);
  lines.push(`Mode: ${report.meta.mode}`);
  lines.push(`Generated: ${report.meta.generatedAt}`);
  lines.push(`Jurisdictions: ${report.meta.jurisdictions.join(", ") || "(none configured)"}`);
  lines.push(`Regulatory packs: ${report.meta.packs.map((p) => `${p.id}@${p.version}`).join(", ") || "(none)"}`);
  if (report.meta.scopeDetection) {
    const detection = report.meta.scopeDetection;
    lines.push(
      `Scope: INFERRED by autoscan (${detection.selected
        .map((m) => `${m.jurisdiction} [${m.confidence}]`)
        .join(", ") || "nothing detected"}) - confirm before relying on it.`
    );
    if (detection.considered.length > 0) {
      lines.push(
        `  Not scanned, evidence too thin: ${detection.considered.map((m) => m.jurisdiction).join(", ")} (unknown, not clean).`
      );
    }
  }
  lines.push("");
  lines.push("Coverage");
  lines.push(`  Pages scanned: ${report.coverage.pagesScanned}`);
  lines.push(`  Rules evaluated: ${report.coverage.rulesEvaluated}`);
  lines.push(`  Rules skipped (not applicable): ${report.coverage.rulesSkippedNotApplicable}`);
  lines.push(`  Rules not evaluated: ${report.coverage.rulesNotEvaluated}`);
  lines.push(`  Manual review items: ${report.coverage.manualReviewItems}`);
  lines.push(`  Suppressed by documented exception: ${report.coverage.findingsSuppressedByException ?? 0}`);
  lines.push("");
  lines.push("Risk indicators (not a legal compliance score)");
  lines.push(`  Automated technical coverage: ${pct(report.riskIndicators.automatedTechnicalCoverage)}`);
  lines.push(`  Detected technical conformity: ${pct(report.riskIndicators.detectedTechnicalConformity)}`);
  lines.push(`  Unresolved compliance risk: ${pct(report.riskIndicators.unresolvedComplianceRisk)}`);
  lines.push(`  Manual review workload: ${pct(report.riskIndicators.manualReviewWorkload)}`);
  lines.push(`  Scan completeness: ${pct(report.riskIndicators.scanCompleteness)}`);
  lines.push("");

  for (const severity of SEVERITY_ORDER) {
    const items = report.findings.filter((f) => f.severity === severity);
    if (items.length === 0) continue;
    lines.push(`${severity.toUpperCase()} (${items.length})`);
    for (const finding of items.slice(0, 50)) {
      lines.push(`  [${finding.packId}/${finding.ruleId}] ${finding.status}: ${finding.observedBehavior}`);
      if (finding.affectedUrl) lines.push(`    at: ${finding.affectedUrl}`);
    }
    if (items.length > 50) lines.push(`  ... and ${items.length - 50} more`);
    lines.push("");
  }

  if (report.suppressedFindings.length > 0) {
    lines.push(`Accepted risks, suppressed by configuration (${report.suppressedFindings.length})`);
    for (const entry of report.suppressedFindings) {
      lines.push(`  [${entry.finding.ruleId}] ${entry.reason}${entry.approvedBy ? ` (accepted by ${entry.approvedBy})` : ""}`);
    }
    lines.push("  These are recorded accepted risks, not resolved findings.");
    lines.push("");
  }

  const thirdParty = report.thirdPartyServices;
  if (thirdParty.length > 0) {
    lines.push(`Third-party services observed (${thirdParty.length})`);
    const byDomain = new Map<string, number>();
    for (const record of thirdParty) byDomain.set(record.domain, (byDomain.get(record.domain) ?? 0) + 1);
    for (const [domain, count] of byDomain) {
      lines.push(`  ${domain} (${count} observation(s))`);
    }
    lines.push("");
  }

  lines.push(
    "Disclaimer: UniVerscan reports automated technical findings, evidence, and manual-review items. It does not, on its own, certify legal compliance with any regulation."
  );

  console.log(lines.join("\n"));
}
