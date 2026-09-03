import type { Finding, ScanReport } from "../engine/types.js";
import { PromptSession } from "./prompts.js";
import { Styler, renderTable, rule, symbolsFor, truncate, wrap, type TerminalCapabilities } from "./terminal.js";

/**
 * Interactive findings browser.
 *
 * A scan of a real site produces more findings than fit on a screen, and the
 * console report is a firehose. This pages through them, filters by status,
 * severity, pack or free text, and opens one finding at a time with its
 * evidence, legal reference and remediation.
 */

export interface ExploreFilters {
  status?: string;
  severity?: string;
  pack?: string;
  search?: string;
}

const PAGE_SIZE = 15;

/** Applies the active filters. Exported so the matching logic can be tested. */
export function filterFindings(findings: Finding[], filters: ExploreFilters): Finding[] {
  const needle = filters.search?.toLowerCase();
  return findings.filter((finding) => {
    if (filters.status && finding.status !== filters.status) return false;
    if (filters.severity && finding.severity !== filters.severity) return false;
    if (filters.pack && finding.packId !== filters.pack) return false;
    if (needle) {
      const haystack = [
        finding.ruleId,
        finding.requirement,
        finding.observedBehavior,
        finding.affectedUrl ?? "",
        finding.affectedElement ?? "",
        finding.regulation,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  "manual-review": 4,
  informational: 5,
};

/** Most severe first, then by rule id so the order is stable between runs. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.ruleId.localeCompare(b.ruleId)
  );
}

function describeFilters(filters: ExploreFilters): string {
  const parts = Object.entries(filters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

function renderFindingDetail(
  finding: Finding,
  capabilities: TerminalCapabilities,
  styler: Styler
): string[] {
  const symbols = symbolsFor(capabilities);
  const lines: string[] = [];
  const field = (label: string, value: string) => {
    for (const [index, line] of wrap(value, capabilities.width - 16).entries()) {
      lines.push(index === 0 ? `  ${styler.dim(label.padEnd(13))}${line}` : `  ${" ".repeat(13)}${line}`);
    }
  };

  lines.push("");
  lines.push(rule(capabilities, styler, finding.ruleId));
  lines.push("");
  lines.push(
    `  ${styler.severity(finding.severity, finding.severity.toUpperCase())}  ${styler.status(finding.status)}  ${styler.dim(
      `confidence: ${finding.confidence} | automation: ${finding.automationLevel}`
    )}`
  );
  lines.push("");
  field("Regulation", `${finding.regulation} (${finding.jurisdiction})`);
  field("Requirement", finding.requirement);
  field("Observed", finding.observedBehavior);
  field("Expected", finding.expectedBehavior);
  if (finding.affectedUrl) field("Where", finding.affectedUrl);
  if (finding.affectedElement) field("Element", finding.affectedElement);
  if (finding.legalReference) field("Legal ref", finding.legalReference);
  if (finding.remediation) field("Remediation", finding.remediation);

  if (finding.manualReviewRequired) {
    lines.push("");
    lines.push(`  ${styler.magenta(symbols.warning)} ${styler.magenta("This item needs a person to decide; the scan only collected the evidence.")}`);
  }
  if (finding.status === "not-evaluated") {
    lines.push("");
    lines.push(`  ${styler.yellow(symbols.warning)} ${styler.yellow("This check could not run. That is a gap in coverage, not a pass.")}`);
  }

  if (finding.evidence.length > 0) {
    lines.push("");
    lines.push(`  ${styler.dim(`Evidence (${finding.evidence.length})`)}`);
    for (const evidence of finding.evidence) {
      lines.push(`    ${symbols.bullet} ${styler.dim(`[${evidence.type}]`)} ${truncate(evidence.description, capabilities.width - 20)}`);
      if (evidence.sourceFile) {
        lines.push(`      ${styler.dim(`${evidence.sourceFile}:${evidence.sourceLine ?? 1}`)}`);
      }
      if (evidence.data !== undefined) {
        const rendered = typeof evidence.data === "string" ? evidence.data : JSON.stringify(evidence.data);
        for (const line of wrap(truncate(rendered, 400), capabilities.width, "      ")) {
          lines.push(styler.dim(line));
        }
      }
    }
  }
  lines.push("");
  return lines;
}

/**
 * Runs the browser loop. Returns when the user quits.
 *
 * Every command is a single keystroke plus Enter, which keeps it usable over
 * a slow SSH session and needs no raw-mode terminal handling.
 */
export async function exploreReport(
  report: ScanReport,
  capabilities: TerminalCapabilities
): Promise<void> {
  const styler = new Styler(capabilities);
  const symbols = symbolsFor(capabilities);
  const session = new PromptSession(capabilities);
  const filters: ExploreFilters = {};
  let offset = 0;

  const statuses = Array.from(new Set(report.findings.map((f) => f.status))).sort();
  const severities = Array.from(new Set(report.findings.map((f) => f.severity))).sort(
    (a, b) => (SEVERITY_RANK[a] ?? 9) - (SEVERITY_RANK[b] ?? 9)
  );
  const packs = Array.from(new Set(report.findings.map((f) => f.packId))).sort();

  try {
    for (;;) {
      const matching = sortFindings(filterFindings(report.findings, filters));
      offset = Math.min(offset, Math.max(0, matching.length - 1));
      const page = matching.slice(offset, offset + PAGE_SIZE);

      session.write("");
      session.write(rule(capabilities, styler, `${matching.length} of ${report.findings.length} finding(s)`));
      session.write(styler.dim(`  filters: ${describeFilters(filters)}`));
      session.write("");

      if (page.length === 0) {
        session.write(`  ${styler.dim("Nothing matches the current filters.")}`);
      } else {
        const rows = page.map((finding, index) => [
          String(offset + index + 1),
          styler.severity(finding.severity),
          styler.status(finding.status),
          finding.ruleId,
          finding.affectedUrl ?? finding.affectedElement ?? "-",
        ]);
        const table = renderTable(
          [
            { header: "#", align: "right" },
            { header: "SEVERITY" },
            { header: "STATUS" },
            { header: "RULE", maxShare: 0.35 },
            { header: "WHERE", maxShare: 0.4 },
          ],
          rows,
          capabilities,
          styler
        );
        for (const line of table) session.write(`  ${line}`);
      }

      const shown = page.length === 0 ? "0" : `${offset + 1}-${offset + page.length}`;
      session.write("");
      session.write(
        styler.dim(
          `  showing ${shown} of ${matching.length}   ${symbols.bullet} [n]ext [p]rev [number] open  ${symbols.bullet} [s]tatus [v]severity [k]pack [/]search [c]lear  ${symbols.bullet} [q]uit`
        )
      );

      const answer = (await session.text("", { defaultValue: "q" })).trim().toLowerCase();

      if (answer === "q" || answer === "quit") return;

      if (answer === "n" || answer === "next") {
        if (offset + PAGE_SIZE < matching.length) offset += PAGE_SIZE;
        continue;
      }
      if (answer === "p" || answer === "prev") {
        offset = Math.max(0, offset - PAGE_SIZE);
        continue;
      }
      if (answer === "c" || answer === "clear") {
        delete filters.status;
        delete filters.severity;
        delete filters.pack;
        delete filters.search;
        offset = 0;
        continue;
      }
      if (answer === "s") {
        filters.status = await session.select(
          "Filter by status",
          [{ value: "", label: "(any)" }, ...statuses.map((value) => ({ value, label: value }))],
          0
        );
        if (!filters.status) delete filters.status;
        offset = 0;
        continue;
      }
      if (answer === "v") {
        filters.severity = await session.select(
          "Filter by severity",
          [{ value: "", label: "(any)" }, ...severities.map((value) => ({ value, label: value }))],
          0
        );
        if (!filters.severity) delete filters.severity;
        offset = 0;
        continue;
      }
      if (answer === "k") {
        filters.pack = await session.select(
          "Filter by pack",
          [{ value: "", label: "(any)" }, ...packs.map((value) => ({ value, label: value }))],
          0
        );
        if (!filters.pack) delete filters.pack;
        offset = 0;
        continue;
      }
      if (answer === "/" || answer === "search") {
        const term = await session.text("Search text (blank clears)", { defaultValue: "" });
        if (term.trim().length === 0) delete filters.search;
        else filters.search = term.trim();
        offset = 0;
        continue;
      }

      const index = Number.parseInt(answer, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < matching.length) {
        for (const line of renderFindingDetail(matching[index], capabilities, styler)) session.write(line);
        await session.text(styler.dim("  press Enter to go back"), { defaultValue: "" });
        continue;
      }

      session.write(`  ${styler.red(symbols.cross)} Unrecognised command.`);
    }
  } finally {
    session.close();
  }
}
