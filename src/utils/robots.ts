import { logger } from "./logger.js";

/** User-agent token UniVerscan matches against in robots.txt group headers. */
export const USER_AGENT_TOKEN = "universcan";

export interface RobotsRules {
  /** Path prefixes (robots.txt syntax, `*` and `$` supported) the crawler must not fetch. */
  disallow: string[];
  /** Allow rules, which win over a Disallow of equal or shorter match length. */
  allow: string[];
  /** Sitemap URLs advertised by robots.txt, used to widen route discovery. */
  sitemaps: string[];
  /** False when robots.txt was absent, unreachable, or unparsable. */
  loaded: boolean;
}

export const EMPTY_ROBOTS: RobotsRules = { disallow: [], allow: [], sitemaps: [], loaded: false };

/**
 * Parses the groups of a robots.txt body, keeping the rules that apply to
 * UniVerscan: the most specific matching group wins, i.e. a group naming
 * `universcan` takes precedence over the wildcard `*` group.
 */
export function parseRobotsTxt(body: string): RobotsRules {
  const specific = { disallow: [] as string[], allow: [] as string[] };
  const wildcard = { disallow: [] as string[], allow: [] as string[] };
  const sitemaps: string[] = [];

  // A blank line ends a group; consecutive User-agent lines share one rule block.
  let activeAgents: string[] = [];
  let expectingAgents = true;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) {
      activeAgents = [];
      expectingAgents = true;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!expectingAgents) activeAgents = [];
      expectingAgents = true;
      if (value) activeAgents.push(value.toLowerCase());
      continue;
    }
    if (field !== "disallow" && field !== "allow") continue;

    expectingAgents = false;
    for (const agent of activeAgents) {
      const bucket = agent === USER_AGENT_TOKEN ? specific : agent === "*" ? wildcard : null;
      if (!bucket) continue;
      // "Disallow:" with an empty value means "nothing is disallowed" - it is
      // not a rule blocking the empty path, so it is dropped rather than kept.
      if (field === "disallow" && value.length === 0) continue;
      bucket[field].push(value);
    }
  }

  const chosen = specific.disallow.length > 0 || specific.allow.length > 0 ? specific : wildcard;
  return { disallow: chosen.disallow, allow: chosen.allow, sitemaps, loaded: true };
}

export async function fetchRobotsTxt(baseUrl: string): Promise<RobotsRules> {
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).toString();
    const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(8000) });
    // A 4xx means "no restrictions published"; a 5xx is an unknown state, but
    // treating it as blanket-disallow would silently produce an empty scan,
    // which reads as a pass. Both are reported as `loaded: false` instead.
    if (!response.ok) return EMPTY_ROBOTS;
    return parseRobotsTxt(await response.text());
  } catch (error) {
    logger.debug("robots.txt not available or unreadable", error);
    return EMPTY_ROBOTS;
  }
}

/**
 * robots.txt treats only `*` (any sequence) and a trailing `$` (end of path)
 * as special; every other character is literal. The trailing `$` is taken off
 * before escaping so it is not turned into a literal dollar sign, and every
 * remaining metacharacter - `?` and `+` included, both common in real paths -
 * is escaped.
 */
function patternToRegExp(pattern: string): RegExp {
  const endAnchored = pattern.endsWith("$");
  const body = endAnchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  const withWildcards = escaped.split("*").join(".*");
  return new RegExp(`^${withWildcards}${endAnchored ? "$" : ""}`);
}

function longestMatch(pathname: string, patterns: string[]): number {
  let best = -1;
  for (const pattern of patterns) {
    if (pattern.length === 0) continue;
    if (patternToRegExp(pattern).test(pathname)) {
      best = Math.max(best, pattern.length);
    }
  }
  return best;
}

/**
 * Standard robots.txt precedence: the longest matching rule wins, and Allow
 * beats Disallow on a tie.
 */
export function isAllowedByRobots(pathname: string, rules: RobotsRules): boolean {
  if (!rules.loaded) return true;
  const disallowMatch = longestMatch(pathname, rules.disallow);
  if (disallowMatch === -1) return true;
  return longestMatch(pathname, rules.allow) >= disallowMatch;
}
