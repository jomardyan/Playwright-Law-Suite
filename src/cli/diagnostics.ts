import type { UniVerscanConfig } from "../config/schema.js";
import type { RegulatoryPack } from "../engine/types.js";
import { JURISDICTION_ALIASES } from "../modules/scope/signals.js";

/**
 * Turning silent no-ops into actionable messages.
 *
 * The dangerous failures in a compliance scanner are the quiet ones: a
 * mistyped pack id that loads no rules, a jurisdiction spelling no pack
 * matches, a target nothing could reach. Each produces a clean-looking
 * report about nothing. Everything here exists to make those loud.
 */

/** Levenshtein distance, bounded early once it exceeds `limit`. */
export function editDistance(a: string, b: string, limit = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      rowBest = Math.min(rowBest, current[j]);
    }
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * Finds the candidates closest to `input`. A substring match counts as a
 * strong hit, which catches the common case of an abbreviated id
 * (`eu-gdpr` for `eu-gdpr-eprivacy`) that edit distance alone would rank low.
 */
export function suggest(input: string, candidates: readonly string[], max = 3): string[] {
  const needle = input.trim().toLowerCase();
  if (needle.length === 0) return [];

  const scored = candidates
    .map((candidate) => {
      const haystack = candidate.toLowerCase();
      if (haystack === needle) return { candidate, score: -1 };
      if (haystack.startsWith(needle) || needle.startsWith(haystack)) return { candidate, score: 0 };
      if (haystack.includes(needle) || needle.includes(haystack)) return { candidate, score: 1 };
      return { candidate, score: 2 + editDistance(needle, haystack) };
    })
    .filter((entry) => entry.score <= 5)
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));

  return scored.slice(0, max).map((entry) => entry.candidate);
}

/** A pack's applicability() is third-party code; a throw must not break validation. */
function safeApplicability(pack: RegulatoryPack, config: UniVerscanConfig): boolean {
  try {
    return pack.applicability(config);
  } catch {
    return false;
  }
}

export interface ScopeProblem {
  severity: "error" | "warning";
  message: string;
  /** Concrete next step, printed under the message. */
  hint?: string;
}

/**
 * Checks a resolved config against the pack catalogue before a scan starts,
 * so a selection that would scan nothing fails immediately instead of after
 * a browser launch and a crawl.
 */
export function validateScope(
  config: UniVerscanConfig,
  allPacks: readonly RegulatoryPack[],
  applicablePacks: readonly RegulatoryPack[]
): ScopeProblem[] {
  const problems: ScopeProblem[] = [];
  const knownPackIds = allPacks.map((pack) => pack.id);

  // --- Pack ids that do not exist ---
  for (const requested of config.regulatoryPacks ?? []) {
    if (knownPackIds.includes(requested)) continue;
    const suggestions = suggest(requested, knownPackIds);
    problems.push({
      severity: "error",
      message: `No regulatory pack is called '${requested}'.`,
      hint:
        suggestions.length > 0
          ? `Did you mean ${suggestions.map((id) => `'${id}'`).join(", ")}? Run 'universcan packs' for the full list.`
          : "Run 'universcan packs' for the full list.",
    });
  }

  // --- Jurisdictions that match no pack ---
  // Asked against every pack, not just the selected ones: the question is
  // whether the spelling is recognised at all, which an explicit --packs
  // allowlist must not mask.
  //
  // Jurisdiction-agnostic packs (accessibility, security-of-processing)
  // accept anything, so they are identified with a sentinel and excluded.
  // Counting them would make every misspelling look recognised - the exact
  // silent failure this check exists to catch.
  const SENTINEL = "__universcan_no_such_jurisdiction__";
  const jurisdictionSpecific = allPacks.filter(
    (pack) => !safeApplicability(pack, { ...config, jurisdictions: [SENTINEL], regulatoryPacks: [] })
  );

  for (const jurisdiction of config.jurisdictions) {
    const matched = jurisdictionSpecific.some((pack) =>
      safeApplicability(pack, { ...config, jurisdictions: [jurisdiction], regulatoryPacks: [] })
    );
    if (matched) continue;
    // A country name usually means the regional pack that covers it, which
    // no amount of string similarity would find: "Germany" is nowhere near
    // "European Union".
    const alias = JURISDICTION_ALIASES[jurisdiction.trim().toLowerCase()];
    const suggestions = alias
      ? [alias]
      : suggest(jurisdiction, Array.from(new Set(jurisdictionSpecific.map((pack) => pack.jurisdiction))));
    problems.push({
      severity: "warning",
      message: `'${jurisdiction}' matched no jurisdiction-specific pack, so no rules for that market will run.`,
      hint: alias
        ? `Use '${alias}' instead - that is the pack covering ${jurisdiction}.`
        : suggestions.length > 0
          ? `Did you mean ${suggestions.map((name) => `'${name}'`).join(", ")}? Run 'universcan packs' for the full list.`
          : "Run 'universcan packs' to see the jurisdictions that have packs.",
    });
  }

  // --- Nothing at all would run ---
  if (applicablePacks.length === 0) {
    problems.push({
      severity: "error",
      message: "This configuration loads no regulatory packs, so the scan would check nothing.",
      hint:
        (config.regulatoryPacks ?? []).length > 0
          ? "Remove or correct --packs, or widen --jurisdictions."
          : "Set --jurisdictions (for example \"European Union\"), or run 'universcan autoscan' to detect them.",
    });
  }

  return problems;
}

/**
 * Rewrites a thrown error as something a user can act on.
 *
 * Returns null when the error is not one of the recognised shapes, so the
 * caller can fall back to showing the original rather than hiding it behind
 * a vague message.
 */
export function explainError(error: unknown): { message: string; hint?: string } | null {
  const raw = error instanceof Error ? error.message : String(error);

  if (error instanceof SyntaxError && /JSON/i.test(raw)) {
    return {
      message: `The config file is not valid JSON: ${raw}`,
      hint: "Check for a trailing comma or an unclosed bracket. YAML configs are also supported (.yaml / .yml).",
    };
  }
  if (/ENOENT/.test(raw)) {
    const path = raw.match(/'([^']+)'/)?.[1];
    return {
      message: path ? `File not found: ${path}` : raw,
      hint: "Check the path. Paths in a config file resolve relative to that file.",
    };
  }
  if (/EACCES|EPERM/.test(raw)) {
    return { message: raw, hint: "Check the file permissions, and that the output directory is writable." };
  }
  if (/Executable doesn't exist|Failed to launch|browserType\.launch/i.test(raw)) {
    return {
      message: "Chromium could not be launched.",
      hint: "Run 'npx playwright install --with-deps chromium', or point UNIVERSCAN_CHROMIUM_PATH at an existing build.",
    };
  }
  if (/net::ERR_NAME_NOT_RESOLVED|getaddrinfo|ENOTFOUND/i.test(raw)) {
    return {
      message: "The target host could not be resolved.",
      hint: "Check the URL's spelling, and that this machine can reach it (proxy, VPN, or firewall).",
    };
  }
  if (/net::ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(raw)) {
    return {
      message: "The target refused the connection.",
      hint: "Check that the server is running and listening on that port.",
    };
  }
  if (/net::ERR_CERT|SSL|certificate/i.test(raw)) {
    return {
      message: `The target's TLS certificate was rejected: ${raw}`,
      hint: "Scan the hostname the certificate is issued for, or fix the certificate. UniVerscan does not disable TLS verification.",
    };
  }
  if (/Timeout .* exceeded|net::ERR_TIMED_OUT/i.test(raw)) {
    return {
      message: "The target did not respond in time.",
      hint: "The site may be slow or blocking automated traffic. Try a smaller --page-limit, or scan a staging host.",
    };
  }
  if (/Circular config extends/i.test(raw)) {
    return { message: raw, hint: "Break the loop: a profile must not extend one that extends it back." };
  }
  if (/extends '.*' which could not be found|extends '.*', which could not be found/i.test(raw)) {
    return { message: raw, hint: "Use a bundled profile name, or a path starting with './'." };
  }
  return null;
}
