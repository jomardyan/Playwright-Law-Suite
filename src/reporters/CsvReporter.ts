import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanReport } from "../engine/types.js";

const COLUMNS = [
  "ruleId",
  "packId",
  "regulation",
  "jurisdiction",
  "status",
  "severity",
  "confidence",
  "automationLevel",
  "manualReviewRequired",
  "affectedUrl",
  "affectedElement",
  "requirement",
  "observedBehavior",
  "expectedBehavior",
  "legalReference",
  "remediation",
  "suppressed",
  "suppressionReason",
  "suppressionApprovedBy",
] as const;

/**
 * RFC 4180 quoting. Every field is quoted unconditionally: finding text
 * routinely contains commas, quotes, and newlines, and a spreadsheet import
 * that silently splits a legal reference across columns is worse than a
 * slightly larger file.
 */
function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Emits one row per finding for spreadsheet triage. Suppressed findings are
 * included with `suppressed=true` and the recorded justification, so the CSV
 * a reviewer opens is the full picture rather than the unsuppressed subset.
 */
export function renderCsvReport(report: ScanReport): string {
  const rows: string[] = [COLUMNS.map(csvCell).join(",")];

  const emit = (
    finding: ScanReport["findings"][number],
    suppression?: { reason: string; approvedBy?: string }
  ) => {
    rows.push(
      [
        finding.ruleId,
        finding.packId,
        finding.regulation,
        finding.jurisdiction,
        finding.status,
        finding.severity,
        finding.confidence,
        finding.automationLevel,
        finding.manualReviewRequired === true,
        finding.affectedUrl ?? "",
        finding.affectedElement ?? "",
        finding.requirement,
        finding.observedBehavior,
        finding.expectedBehavior,
        finding.legalReference ?? "",
        finding.remediation ?? "",
        suppression !== undefined,
        suppression?.reason ?? "",
        suppression?.approvedBy ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  };

  for (const finding of report.findings) emit(finding);
  for (const entry of report.suppressedFindings) {
    emit(entry.finding, { reason: entry.reason, approvedBy: entry.approvedBy });
  }

  return `${rows.join("\r\n")}\r\n`;
}

export function writeCsvReport(report: ScanReport, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, "findings.csv");
  writeFileSync(path, renderCsvReport(report), "utf-8");
  return path;
}
