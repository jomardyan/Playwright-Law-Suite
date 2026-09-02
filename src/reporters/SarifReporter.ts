import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import type { Finding, ScanReport, Severity } from "../engine/types.js";

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

/**
 * SARIF has three reportable levels plus "none". Statuses that describe a
 * gap in the scan rather than a defect in the site (`not-evaluated`,
 * `manual-review`, `informational`) map to "note" so they stay visible in a
 * code-scanning view without being presented as confirmed defects.
 */
function sarifLevel(finding: Finding): "error" | "warning" | "note" | "none" {
  if (finding.status === "not-evaluated" || finding.status === "manual-review") return "note";
  if (finding.status === "informational" || finding.status === "pass") return "none";
  switch (finding.severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "note";
  }
}

/** GitHub ranks alerts by `security-severity`, a CVSS-like 0-10 string. */
const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: "9.0",
  high: "7.0",
  medium: "5.0",
  low: "3.0",
  informational: "1.0",
  "manual-review": "1.0",
};

function firstSourceReference(finding: Finding): { file: string; line: number } | null {
  for (const evidence of finding.evidence) {
    if (evidence.sourceFile) {
      return { file: evidence.sourceFile, line: evidence.sourceLine ?? 1 };
    }
  }
  return null;
}

function toArtifactUri(file: string, repoPath?: string): string {
  if (repoPath && isAbsolute(file)) {
    const rel = relative(repoPath, file);
    if (!rel.startsWith("..")) return rel.split("\\").join("/");
  }
  return file.split("\\").join("/");
}

/**
 * Builds the location for a result. Source-mode findings anchor to the real
 * file and line. Live-mode findings have no file, so they anchor to a stable
 * synthetic path derived from the pack id, which keeps GitHub's alert
 * de-duplication working across runs while making clear the finding came
 * from a scanned URL rather than a line of code.
 */
function buildLocations(finding: Finding, repoPath?: string): unknown[] {
  const source = firstSourceReference(finding);
  if (source) {
    return [
      {
        physicalLocation: {
          artifactLocation: { uri: toArtifactUri(source.file, repoPath) },
          region: { startLine: Math.max(1, source.line) },
        },
        message: { text: finding.observedBehavior },
      },
    ];
  }
  return [
    {
      physicalLocation: {
        artifactLocation: { uri: `universcan/${finding.packId}.scan`, uriBaseId: "%SRCROOT%" },
        region: { startLine: 1 },
      },
      message: {
        text: finding.affectedUrl ? `Observed at ${finding.affectedUrl}` : finding.observedBehavior,
      },
    },
  ];
}

function buildRules(findings: Finding[]): unknown[] {
  const byId = new Map<string, Finding>();
  for (const finding of findings) {
    if (!byId.has(finding.ruleId)) byId.set(finding.ruleId, finding);
  }
  return Array.from(byId.values()).map((finding) => ({
    id: finding.ruleId,
    name: finding.ruleId.replace(/[^A-Za-z0-9]+/g, ""),
    shortDescription: { text: finding.requirement.slice(0, 200) },
    fullDescription: { text: finding.requirement },
    help: {
      text: [
        finding.requirement,
        finding.legalReference ? `Legal reference: ${finding.legalReference}` : null,
        finding.remediation ? `Remediation: ${finding.remediation}` : null,
        `Automation level: ${finding.automationLevel}. UniVerscan findings are evidence, not a legal compliance verdict.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    defaultConfiguration: { level: sarifLevel(finding) },
    properties: {
      tags: [
        "compliance",
        finding.packId,
        finding.jurisdiction.toLowerCase().replace(/\s+/g, "-"),
        finding.automationLevel,
      ],
      "security-severity": SECURITY_SEVERITY[finding.severity],
      regulation: finding.regulation,
      jurisdiction: finding.jurisdiction,
    },
  }));
}

/**
 * Emits SARIF 2.1.0 so findings can be uploaded to GitHub code scanning (or
 * any SARIF-consuming tool). Suppressed findings are emitted with a SARIF
 * `suppressions` entry carrying the documented reason, so an accepted risk
 * remains in the artifact rather than vanishing from it.
 */
export function writeSarifReport(report: ScanReport, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, "report.sarif");
  const repoPath = report.meta.target.repoPath;

  const suppressedResults = report.suppressedFindings.map((entry) => ({
    ruleId: entry.finding.ruleId,
    level: sarifLevel(entry.finding),
    message: { text: entry.finding.observedBehavior },
    locations: buildLocations(entry.finding, repoPath),
    suppressions: [
      {
        kind: "external",
        justification: entry.approvedBy ? `${entry.reason} (accepted by ${entry.approvedBy})` : entry.reason,
      },
    ],
  }));

  const results = report.findings.map((finding) => ({
    ruleId: finding.ruleId,
    level: sarifLevel(finding),
    message: {
      text: [
        finding.observedBehavior,
        `Expected: ${finding.expectedBehavior}`,
        `Status: ${finding.status}; confidence: ${finding.confidence}; automation: ${finding.automationLevel}.`,
      ].join(" "),
    },
    locations: buildLocations(finding, repoPath),
    partialFingerprints: {
      universcanFinding: `${finding.packId}:${finding.ruleId}:${finding.affectedUrl ?? finding.affectedElement ?? ""}`,
    },
    properties: {
      status: finding.status,
      confidence: finding.confidence,
      automationLevel: finding.automationLevel,
      manualReviewRequired: finding.manualReviewRequired === true,
    },
  }));

  const allFindings = [...report.findings, ...report.suppressedFindings.map((s) => s.finding)];

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "UniVerscan",
            informationUri: "https://github.com/jomardyan/Playwright-Law-Suite",
            semanticVersion: "0.2.0",
            rules: buildRules(allFindings),
          },
        },
        automationDetails: { id: `universcan/${report.meta.mode}/` },
        invocations: [{ executionSuccessful: true, endTimeUtc: report.meta.generatedAt }],
        results: [...results, ...suppressedResults],
      },
    ],
  };

  writeFileSync(path, JSON.stringify(sarif, null, 2), "utf-8");
  return path;
}
