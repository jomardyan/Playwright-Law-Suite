import type { Finding, ScanReport, Severity } from "../engine/types.js";
import {
  Styler,
  currentCapabilities,
  renderTable,
  rule,
  symbolsFor,
  truncate,
  wrap,
  type TerminalCapabilities,
} from "../cli/terminal.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "informational", "manual-review"];

const MAX_PER_SEVERITY = 15;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Renders the console report as lines.
 *
 * Split from printing so the formatting can be tested against fixed
 * capabilities rather than whatever terminal the test happens to run in.
 */
export function renderConsoleReport(report: ScanReport, capabilities: TerminalCapabilities): string[] {
  const styler = new Styler(capabilities);
  // Tables are printed under a four-space indent, so they must be laid out
  // against the remaining width or every row overflows by exactly that much.
  const indented: TerminalCapabilities = { ...capabilities, width: Math.max(20, capabilities.width - 4) };
  const symbols = symbolsFor(capabilities);
  const lines: string[] = [];

  lines.push("");
  lines.push(rule(capabilities, styler, "UniVerscan compliance scan"));
  lines.push("");
  lines.push(`  ${styler.dim("Target".padEnd(14))}${report.meta.target.url ?? report.meta.target.repoPath ?? "unknown"}`);
  lines.push(`  ${styler.dim("Mode".padEnd(14))}${report.meta.mode}    ${styler.dim("Generated")} ${report.meta.generatedAt}`);
  lines.push(`  ${styler.dim("Jurisdictions".padEnd(14))}${report.meta.jurisdictions.join(", ") || styler.dim("(none configured)")}`);
  lines.push(
    `  ${styler.dim("Packs".padEnd(14))}${report.meta.packs.map((p) => `${p.id}@${p.version}`).join(", ") || styler.dim("(none)")}`
  );

  const detection = report.meta.scopeDetection;
  if (detection) {
    const summary =
      detection.selected.map((m) => `${m.jurisdiction} [${m.confidence}]`).join(", ") || "nothing detected";
    lines.push(`  ${styler.dim("Scope".padEnd(14))}${styler.yellow(`INFERRED by autoscan`)} - ${summary}`);
    for (const line of wrap("Confirm the scope before relying on this report.", capabilities.width, " ".repeat(16))) {
      lines.push(styler.dim(line));
    }
    if (detection.considered.length > 0) {
      for (const line of wrap(
        `Not scanned, evidence too thin: ${detection.considered.map((m) => m.jurisdiction).join(", ")} (unknown, not clean).`,
        capabilities.width,
        " ".repeat(16)
      )) {
        lines.push(styler.yellow(line));
      }
    }
  }

  // --- Coverage ---
  lines.push("");
  lines.push(styler.bold("  Coverage"));
  const coverageRows: string[][] = [
    ["Pages scanned", String(report.coverage.pagesScanned)],
    ["Rules evaluated", String(report.coverage.rulesEvaluated)],
    ["Rules not applicable", String(report.coverage.rulesSkippedNotApplicable)],
    [
      "Rules that could not run",
      report.coverage.rulesNotEvaluated > 0
        ? styler.yellow(`${report.coverage.rulesNotEvaluated}  ${symbols.warning} not passes`)
        : "0",
    ],
    ["Manual review items", String(report.coverage.manualReviewItems)],
    ["Suppressed by exception", String(report.coverage.findingsSuppressedByException ?? 0)],
  ];
  for (const [label, value] of coverageRows) {
    lines.push(`    ${styler.dim(label.padEnd(26))}${value}`);
  }

  // --- Risk indicators ---
  lines.push("");
  lines.push(`${styler.bold("  Risk indicators")} ${styler.dim("(not a legal compliance score)")}`);
  const indicators: Array<[string, number]> = [
    ["Automated technical coverage", report.riskIndicators.automatedTechnicalCoverage],
    ["Detected technical conformity", report.riskIndicators.detectedTechnicalConformity],
    ["Unresolved compliance risk", report.riskIndicators.unresolvedComplianceRisk],
    ["Manual review workload", report.riskIndicators.manualReviewWorkload],
    ["Scan completeness", report.riskIndicators.scanCompleteness],
  ];
  const barWidth = Math.max(10, Math.min(30, capabilities.width - 46));
  for (const [label, value] of indicators) {
    const filled = Math.round(value * barWidth);
    const bar = capabilities.unicode
      ? `${"█".repeat(filled)}${"░".repeat(barWidth - filled)}`
      : `${"#".repeat(filled)}${".".repeat(barWidth - filled)}`;
    lines.push(`    ${styler.dim(label.padEnd(30))}${styler.dim(bar)} ${pct(value).padStart(4)}`);
  }

  // --- Findings, grouped by severity ---
  const byStatus = new Map<string, number>();
  for (const finding of report.findings) byStatus.set(finding.status, (byStatus.get(finding.status) ?? 0) + 1);
  if (byStatus.size > 0) {
    lines.push("");
    lines.push(styler.bold("  Finding classes"));
    for (const [status, count] of Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${styler.status(status, status.padEnd(22))}${String(count).padStart(4)}`);
    }
  }

  for (const severity of SEVERITY_ORDER) {
    const items = report.findings.filter((f) => f.severity === severity);
    if (items.length === 0) continue;
    lines.push("");
    lines.push(`${styler.severity(severity, `  ${severity.toUpperCase()}`)} ${styler.dim(`(${items.length})`)}`);
    const rows = items.slice(0, MAX_PER_SEVERITY).map((finding: Finding) => [
      styler.status(finding.status),
      finding.ruleId,
      finding.observedBehavior,
      finding.affectedUrl ?? finding.affectedElement ?? "-",
    ]);
    const table = renderTable(
      [
        { header: "STATUS" },
        { header: "RULE", maxShare: 0.28 },
        { header: "OBSERVED", maxShare: 0.45 },
        { header: "WHERE", maxShare: 0.28 },
      ],
      rows,
      indented,
      styler
    );
    for (const line of table) lines.push(`    ${line}`);
    if (items.length > MAX_PER_SEVERITY) {
      lines.push(styler.dim(`    ... and ${items.length - MAX_PER_SEVERITY} more (see the JSON report, or 'universcan explore')`));
    }
  }

  // --- Suppressed ---
  if (report.suppressedFindings.length > 0) {
    lines.push("");
    lines.push(`${styler.bold("  Accepted risks, suppressed by configuration")} ${styler.dim(`(${report.suppressedFindings.length})`)}`);
    for (const entry of report.suppressedFindings) {
      lines.push(
        `    ${styler.dim(symbols.bullet)} ${entry.finding.ruleId} ${styler.dim(`- ${truncate(entry.reason, Math.max(20, capabilities.width - 40))}`)}${
          entry.approvedBy ? styler.dim(` (accepted by ${entry.approvedBy})`) : ""
        }`
      );
    }
    lines.push(styler.dim("    These are recorded accepted risks, not resolved findings."));
  }

  // --- Third parties ---
  if (report.thirdPartyServices.length > 0) {
    const byDomain = new Map<string, number>();
    for (const record of report.thirdPartyServices) byDomain.set(record.domain, (byDomain.get(record.domain) ?? 0) + 1);
    lines.push("");
    lines.push(`${styler.bold("  Third-party services observed")} ${styler.dim(`(${byDomain.size})`)}`);
    for (const [domain, count] of Array.from(byDomain.entries()).slice(0, 20)) {
      lines.push(`    ${styler.dim(symbols.bullet)} ${domain} ${styler.dim(`(${count} observation(s))`)}`);
    }
    if (byDomain.size > 20) lines.push(styler.dim(`    ... and ${byDomain.size - 20} more`));
  }

  lines.push("");
  for (const line of wrap(
    "UniVerscan reports automated technical findings, evidence, and manual-review items. It does not, on its own, certify legal compliance with any regulation.",
    capabilities.width,
    "  "
  )) {
    lines.push(styler.dim(line));
  }
  lines.push("");

  return lines;
}

/**
 * Prints a summary to the console. This intentionally reports risk
 * indicators, not a pass/fail compliance verdict - see the disclaimer
 * printed at the bottom.
 */
export function printConsoleReport(report: ScanReport): void {
  console.log(renderConsoleReport(report, currentCapabilities()).join("\n"));
}
