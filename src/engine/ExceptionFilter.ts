import type { IgnoredFinding, UniVerscanConfig } from "../config/schema.js";
import type { Finding, SuppressedFinding } from "./types.js";
import { logger } from "../utils/logger.js";

export interface ExceptionFilterResult {
  findings: Finding[];
  suppressed: SuppressedFinding[];
}

/**
 * An exception is only honoured when it carries a written justification. An
 * entry with no `reason` is a silent rule disable, which AGENTS.md forbids,
 * so it is rejected loudly instead of being applied.
 */
function isUsable(entry: IgnoredFinding, now: Date): { usable: boolean; problem?: string } {
  if (!entry.ruleId) return { usable: false, problem: "entry has no ruleId" };
  if (!entry.reason || entry.reason.trim().length === 0) {
    return { usable: false, problem: `exception for '${entry.ruleId}' has no 'reason'` };
  }
  if (entry.expires) {
    const expiry = new Date(entry.expires);
    if (Number.isNaN(expiry.getTime())) {
      return { usable: false, problem: `exception for '${entry.ruleId}' has an unparsable 'expires' value '${entry.expires}'` };
    }
    if (expiry.getTime() <= now.getTime()) {
      return { usable: false, problem: `exception for '${entry.ruleId}' expired on ${entry.expires}` };
    }
  }
  return { usable: true };
}

/**
 * Applies `config.ignoredFindings` - the sanctioned way to record a risk a
 * human has explicitly accepted.
 *
 * Suppressed findings are moved into their own report section rather than
 * deleted, so an accepted risk stays visible and auditable, and expired or
 * undocumented exceptions stop applying on their own. Statuses that describe
 * a gap in the scan itself (`not-evaluated`) are never suppressible: an
 * exception may accept a known risk, it may not hide the fact that a rule
 * could not run.
 */
export function applyExceptions(
  findings: Finding[],
  config: UniVerscanConfig,
  now: Date = new Date()
): ExceptionFilterResult {
  const entries = config.ignoredFindings ?? [];
  if (entries.length === 0) return { findings, suppressed: [] };

  const usable = new Map<string, IgnoredFinding>();
  for (const entry of entries) {
    const { usable: ok, problem } = isUsable(entry, now);
    if (!ok) {
      logger.warn(`Ignoring config exception: ${problem}. The finding will be reported normally.`);
      continue;
    }
    usable.set(entry.ruleId, entry);
  }

  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  for (const finding of findings) {
    const entry = usable.get(finding.ruleId);
    if (!entry || finding.status === "not-evaluated") {
      kept.push(finding);
      continue;
    }
    suppressed.push({
      finding,
      reason: entry.reason,
      approvedBy: entry.approvedBy,
      expires: entry.expires,
    });
  }

  if (suppressed.length > 0) {
    logger.info(
      `${suppressed.length} finding(s) suppressed by documented exceptions; they are reported under 'suppressedFindings', not removed.`
    );
  }
  return { findings: kept, suppressed };
}
