import type { Finding, ScanReport } from "./types.js";

export interface FindingDelta {
  finding: Finding;
  /** The identity key both reports were matched on. */
  key: string;
}

export interface StatusChange {
  key: string;
  ruleId: string;
  before: Finding;
  after: Finding;
  statusChanged: boolean;
  severityChanged: boolean;
}

export interface ReportDiff {
  baseline: { generatedAt: string; target: string; findingCount: number };
  current: { generatedAt: string; target: string; findingCount: number };
  /** Present in the current report only. */
  newFindings: FindingDelta[];
  /** Present in the baseline only - fixed, suppressed, or no longer reachable. */
  resolvedFindings: FindingDelta[];
  /** Present in both, with a different status or severity. */
  changedFindings: StatusChange[];
  unchangedCount: number;
  /**
   * Rules the baseline evaluated that the current run could not, and vice
   * versa. A rule that stopped running is not a fix, so it is called out
   * separately rather than counted as a resolved finding.
   */
  evaluationRegressions: string[];
}

/**
 * Findings are matched on rule + location, not on their prose. Two runs
 * against the same page produce identical keys even when wording or
 * evidence differs, which is what makes a remediation diff meaningful.
 */
export function findingKey(finding: Finding): string {
  return [finding.packId, finding.ruleId, finding.affectedUrl ?? "", finding.affectedElement ?? ""].join("|");
}

function targetLabel(report: ScanReport): string {
  return report.meta.target.url ?? report.meta.target.repoPath ?? "unknown";
}

function indexByKey(findings: Finding[]): Map<string, Finding> {
  const index = new Map<string, Finding>();
  for (const finding of findings) {
    // First occurrence wins: repeated identical keys within one report are
    // the same issue reported by multiple pages of evidence.
    if (!index.has(findingKey(finding))) index.set(findingKey(finding), finding);
  }
  return index;
}

/**
 * Compares two scan reports so a remediation round can be verified: what was
 * fixed, what is new, what changed class, and which rules stopped being
 * evaluated at all.
 */
export function diffReports(baseline: ScanReport, current: ScanReport): ReportDiff {
  const baselineIndex = indexByKey(baseline.findings);
  const currentIndex = indexByKey(current.findings);

  const newFindings: FindingDelta[] = [];
  const resolvedFindings: FindingDelta[] = [];
  const changedFindings: StatusChange[] = [];
  let unchangedCount = 0;

  for (const [key, finding] of currentIndex) {
    const before = baselineIndex.get(key);
    if (!before) {
      newFindings.push({ finding, key });
      continue;
    }
    const statusChanged = before.status !== finding.status;
    const severityChanged = before.severity !== finding.severity;
    if (statusChanged || severityChanged) {
      changedFindings.push({ key, ruleId: finding.ruleId, before, after: finding, statusChanged, severityChanged });
    } else {
      unchangedCount += 1;
    }
  }

  for (const [key, finding] of baselineIndex) {
    if (!currentIndex.has(key)) resolvedFindings.push({ finding, key });
  }

  const baselineEvaluated = new Set(
    baseline.findings.filter((f) => f.status !== "not-evaluated").map((f) => f.ruleId)
  );
  const currentNotEvaluated = new Set(
    current.findings.filter((f) => f.status === "not-evaluated").map((f) => f.ruleId)
  );
  const evaluationRegressions = Array.from(currentNotEvaluated).filter((ruleId) => baselineEvaluated.has(ruleId)).sort();

  return {
    baseline: {
      generatedAt: baseline.meta.generatedAt,
      target: targetLabel(baseline),
      findingCount: baseline.findings.length,
    },
    current: {
      generatedAt: current.meta.generatedAt,
      target: targetLabel(current),
      findingCount: current.findings.length,
    },
    newFindings,
    resolvedFindings,
    changedFindings,
    unchangedCount,
    evaluationRegressions,
  };
}

/** Renders a diff for a terminal or a CI job summary. */
export function renderDiffMarkdown(diff: ReportDiff): string {
  const lines: string[] = [];
  lines.push("# UniVerscan scan comparison");
  lines.push("");
  lines.push(`**Baseline:** ${diff.baseline.target} at ${diff.baseline.generatedAt} (${diff.baseline.findingCount} findings)`);
  lines.push(`**Current:** ${diff.current.target} at ${diff.current.generatedAt} (${diff.current.findingCount} findings)`);
  if (diff.baseline.target !== diff.current.target) {
    lines.push("");
    lines.push("> The two reports target different subjects; the comparison below may not be meaningful.");
  }
  lines.push("");
  lines.push(
    `New: **${diff.newFindings.length}** · Resolved: **${diff.resolvedFindings.length}** · Changed: **${diff.changedFindings.length}** · Unchanged: **${diff.unchangedCount}**`
  );
  lines.push("");

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    lines.push(`## ${title}`);
    lines.push("");
    lines.push(...rows);
    lines.push("");
  };

  section(
    `New findings (${diff.newFindings.length})`,
    diff.newFindings.map(
      (d) => `- \`${d.finding.ruleId}\` [${d.finding.severity}/${d.finding.status}] ${d.finding.affectedUrl ?? d.finding.affectedElement ?? ""} - ${d.finding.observedBehavior}`
    )
  );
  section(
    `Resolved findings (${diff.resolvedFindings.length})`,
    [
      "A finding disappears when it is fixed, when it is suppressed by a config exception, or when the page it was found on was not reached this time. Confirm which before reporting it as fixed.",
      "",
      ...diff.resolvedFindings.map(
        (d) => `- \`${d.finding.ruleId}\` [${d.finding.severity}/${d.finding.status}] ${d.finding.affectedUrl ?? d.finding.affectedElement ?? ""}`
      ),
    ]
  );
  section(
    `Changed findings (${diff.changedFindings.length})`,
    diff.changedFindings.map(
      (c) =>
        `- \`${c.ruleId}\` ${c.before.status}/${c.before.severity} → ${c.after.status}/${c.after.severity} ${
          c.after.affectedUrl ?? c.after.affectedElement ?? ""
        }`
    )
  );
  section(
    `Rules that stopped being evaluated (${diff.evaluationRegressions.length})`,
    [
      "These rules produced a result in the baseline but reported `not-evaluated` in the current run. That is a loss of coverage, not a fix.",
      "",
      ...diff.evaluationRegressions.map((ruleId) => `- \`${ruleId}\``),
    ]
  );

  return lines.join("\n");
}
