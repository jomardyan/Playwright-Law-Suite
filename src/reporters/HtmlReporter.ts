import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, ScanReport } from "../engine/types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#8a1c1c",
  high: "#a3491a",
  medium: "#8a6d1c",
  low: "#3a6b3a",
  informational: "#3a5a8a",
  "manual-review": "#5a3a8a",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function findingRow(finding: Finding): string {
  const color = SEVERITY_COLOR[finding.severity] ?? "#444";
  return `<tr>
    <td><span class="badge" style="background:${color}">${escapeHtml(finding.severity)}</span></td>
    <td>${escapeHtml(finding.status)}</td>
    <td>${escapeHtml(finding.regulation)}<br/><small>${escapeHtml(finding.jurisdiction)}</small></td>
    <td>${escapeHtml(finding.ruleId)}</td>
    <td>${escapeHtml(finding.observedBehavior)}</td>
    <td>${finding.affectedUrl ? escapeHtml(finding.affectedUrl) : finding.affectedElement ? escapeHtml(finding.affectedElement) : "-"}</td>
    <td>${escapeHtml(finding.confidence)}</td>
    <td>${escapeHtml(finding.automationLevel)}</td>
  </tr>`;
}

function statTile(label: string, value: string): string {
  return `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

/**
 * Renders the executive compliance dashboard as a single self-contained
 * HTML file (no external assets), safe to open offline or attach to a CI
 * artifact.
 */
export function writeHtmlReport(report: ScanReport, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, "report.html");

  const findingsSorted = [...report.findings].sort((a, b) => {
    const order = ["critical", "high", "medium", "low", "manual-review", "informational"];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });

  const suppressedRows = report.suppressedFindings
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.finding.ruleId)}</td><td><span class="badge" style="background:${
          SEVERITY_COLOR[entry.finding.severity] ?? "#444"
        }">${escapeHtml(entry.finding.severity)}</span></td><td>${escapeHtml(entry.reason)}</td><td>${escapeHtml(
          entry.approvedBy ?? "-"
        )}</td><td>${escapeHtml(entry.expires ?? "-")}</td></tr>`
    )
    .join("\n");

  const suppressedSection =
    report.suppressedFindings.length === 0
      ? ""
      : `<section>
    <h2>Accepted risks, suppressed by configuration (${report.suppressedFindings.length})</h2>
    <p class="note">These findings matched a documented exception in the scan configuration. They are recorded here, not resolved.</p>
    <table>
      <thead><tr><th>Rule</th><th>Severity</th><th>Reason</th><th>Accepted by</th><th>Expires</th></tr></thead>
      <tbody>${suppressedRows}</tbody>
    </table>
  </section>`;

  const detection = report.meta.scopeDetection;
  const scopeSection = !detection
    ? ""
    : `<section>
    <h2>Scope (inferred by autoscan)</h2>
    <div class="disclaimer">
      These jurisdictions were <strong>inferred from the site</strong>, not supplied by a person. A market that was
      not detected was not scanned, and an unscanned market is an unknown rather than a clean one. Confirm the scope
      below before relying on this report.
    </div>
    <table>
      <thead><tr><th>Market</th><th>Status</th><th>Confidence</th><th>Evidence</th></tr></thead>
      <tbody>
        ${
          [
            ...detection.selected.map(
              (market) =>
                `<tr><td>${escapeHtml(market.jurisdiction)}</td><td>scanned</td><td>${escapeHtml(
                  market.confidence
                )}</td><td>${escapeHtml(market.evidence.map((s) => s.detail).join("; "))}</td></tr>`
            ),
            ...detection.considered.map(
              (market) =>
                `<tr><td>${escapeHtml(market.jurisdiction)}</td><td><strong>not scanned</strong></td><td>${escapeHtml(
                  market.confidence
                )}</td><td>${escapeHtml(market.evidence.map((s) => s.detail).join("; "))}</td></tr>`
            ),
          ].join("\n") || '<tr><td colspan="4">No target market could be determined from this site.</td></tr>'
        }
      </tbody>
    </table>
    <ul class="note">${detection.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
  </section>`;

  const thirdPartyRows = report.thirdPartyServices
    .map(
      (record) =>
        `<tr><td>${escapeHtml(record.domain)}</td><td>${escapeHtml(record.category)}</td><td>${escapeHtml(record.consentState)}</td><td>${escapeHtml(record.requestType)}</td></tr>`
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>UniVerscan Compliance Report</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #f5f6f8; color: #1a1d23; }
  header { background: #14181f; color: #fff; padding: 24px 32px; }
  header h1 { margin: 0 0 4px 0; font-size: 22px; }
  header p { margin: 2px 0; color: #b7bfcc; font-size: 13px; }
  main { padding: 24px 32px; }
  .disclaimer { background: #fff8e1; border: 1px solid #e0c56a; padding: 12px 16px; border-radius: 6px; font-size: 13px; margin-bottom: 24px; }
  .tiles { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 28px; }
  .tile { background: #fff; border: 1px solid #e2e5ea; border-radius: 8px; padding: 14px 18px; min-width: 160px; }
  .tile-value { font-size: 22px; font-weight: 600; }
  .tile-label { font-size: 12px; color: #5a6273; margin-top: 4px; }
  section { margin-bottom: 32px; }
  h2 { font-size: 16px; border-bottom: 1px solid #dfe2e7; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eceef1; vertical-align: top; }
  th { background: #eef0f3; font-weight: 600; }
  .badge { color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; }
  footer { padding: 16px 32px; font-size: 12px; color: #6b7280; }
  .note { font-size: 13px; color: #5a6273; margin: 4px 0 12px 0; }
</style>
</head>
<body>
<header>
  <h1>UniVerscan Compliance Report</h1>
  <p>Target: ${escapeHtml(report.meta.target.url ?? report.meta.target.repoPath ?? "unknown")}</p>
  <p>Mode: ${escapeHtml(report.meta.mode)} &middot; Generated: ${escapeHtml(report.meta.generatedAt)}</p>
  <p>Jurisdictions: ${escapeHtml(report.meta.jurisdictions.join(", ") || "(none configured)")}</p>
  <p>Regulatory packs: ${escapeHtml(report.meta.packs.map((p) => `${p.id}@${p.version}`).join(", ") || "(none)")}</p>
</header>
<main>
  <div class="disclaimer">
    This report presents automated technical findings, evidence, and manual-review items produced by UniVerscan.
    Passing automated tests does not, by itself, establish legal compliance with any regulation. Items marked
    "manual review" require assessment by qualified legal, privacy, or accessibility professionals.
  </div>

  ${scopeSection}

  <section>
    <h2>Coverage &amp; Risk Indicators</h2>
    <div class="tiles">
      ${statTile("Pages scanned", String(report.coverage.pagesScanned))}
      ${statTile("Rules evaluated", String(report.coverage.rulesEvaluated))}
      ${statTile("Rules not evaluated", String(report.coverage.rulesNotEvaluated))}
      ${statTile("Manual review items", String(report.coverage.manualReviewItems))}
      ${statTile("Suppressed by exception", String(report.coverage.findingsSuppressedByException ?? 0))}
      ${statTile("Automated technical coverage", pct(report.riskIndicators.automatedTechnicalCoverage))}
      ${statTile("Detected technical conformity", pct(report.riskIndicators.detectedTechnicalConformity))}
      ${statTile("Unresolved compliance risk", pct(report.riskIndicators.unresolvedComplianceRisk))}
      ${statTile("Manual review workload", pct(report.riskIndicators.manualReviewWorkload))}
      ${statTile("Scan completeness", pct(report.riskIndicators.scanCompleteness))}
    </div>
  </section>

  <section>
    <h2>Findings (${report.findings.length})</h2>
    <table>
      <thead><tr><th>Severity</th><th>Status</th><th>Regulation</th><th>Rule</th><th>Observed</th><th>Location</th><th>Confidence</th><th>Automation</th></tr></thead>
      <tbody>
        ${findingsSorted.map(findingRow).join("\n")}
      </tbody>
    </table>
  </section>

  ${suppressedSection}

  <section>
    <h2>Third-Party Service Inventory (${report.thirdPartyServices.length})</h2>
    <table>
      <thead><tr><th>Domain</th><th>Category</th><th>Consent state observed</th><th>Request type</th></tr></thead>
      <tbody>
        ${thirdPartyRows || '<tr><td colspan="4">No third-party requests recorded.</td></tr>'}
      </tbody>
    </table>
  </section>
</main>
<footer>Generated by UniVerscan &middot; ${escapeHtml(report.meta.generatedAt)}</footer>
</body>
</html>
`;

  writeFileSync(path, html, "utf-8");
  return path;
}
