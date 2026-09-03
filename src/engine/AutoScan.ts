import type { UniVerscanConfig } from "../config/schema.js";
import { BrowserManager } from "./BrowserManager.js";
import { ScopeDetector, type ScopeProbe } from "../modules/scope/ScopeDetector.js";
import { resolveScope, type ScopeDetection } from "../modules/scope/resolveScope.js";
import { logger } from "../utils/logger.js";

/**
 * Pages probed for scope, relative to the target's origin. The homepage
 * alone is often a marketing splash; the legal documents are where a site
 * names the regimes it answers to, and a pricing page is where currencies
 * and sector language show up. A path that 404s contributes nothing and is
 * skipped, so this list costs little when it misses.
 */
const SCOPE_PROBE_PATHS = ["/", "/privacy", "/privacy-policy", "/terms", "/pricing"];

export interface ScopeDetectionOutcome {
  detection: ScopeDetection;
  /** Config with the inferred jurisdictions and sector applied. */
  config: UniVerscanConfig;
  probes: ScopeProbe[];
}

/**
 * Probes a target to work out which markets it serves, then returns a config
 * with those jurisdictions filled in.
 *
 * Values the caller supplied always win. Autoscan fills gaps; it never
 * overrides an explicit `--jurisdictions` or `--sector`, because a stated
 * scope is a decision someone made and an inferred one is a guess.
 */
export async function detectScope(config: UniVerscanConfig): Promise<ScopeDetectionOutcome> {
  const targetUrl = config.target.url;
  if (!targetUrl) throw new Error("autoscan requires config.target.url");

  const browserManager = new BrowserManager(config.browser ?? {});
  await browserManager.launch();
  const context = await browserManager.newContext();
  const page = await context.newPage();
  const detector = new ScopeDetector();
  detector.watch(page);

  const probes: ScopeProbe[] = [];
  const attempted = new Set<string>();
  try {
    for (const path of SCOPE_PROBE_PATHS) {
      let probeUrl: string;
      try {
        probeUrl = new URL(path, targetUrl).toString();
      } catch {
        continue;
      }
      if (attempted.has(probeUrl)) continue;
      attempted.add(probeUrl);

      const response = await page
        .goto(probeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => null);
      // A missing legal page is normal and says nothing about scope; only a
      // reachable page is probed.
      if (!response || !response.ok()) continue;
      // networkidle would stall on pages that poll; a short settle is enough
      // for a consent platform to register.
      await page.waitForTimeout(800);
      probes.push(await detector.probe(page));
    }
  } finally {
    await context.close();
    await browserManager.close();
  }

  const detection = resolveScope(probes);

  // An explicitly supplied scope is authoritative and is never overwritten.
  const callerSetJurisdictions = config.jurisdictions.length > 0;
  const callerSetSector = Boolean(config.businessSector);

  const resolved: UniVerscanConfig = {
    ...config,
    jurisdictions: callerSetJurisdictions ? config.jurisdictions : detection.jurisdictions,
    customerMarkets: config.customerMarkets ?? detection.jurisdictions,
    businessSector: callerSetSector ? config.businessSector : detection.sector ?? undefined,
  };

  if (callerSetJurisdictions && detection.jurisdictions.length > 0) {
    detection.notes.push(
      `Jurisdictions were supplied explicitly (${config.jurisdictions.join(", ")}), so the detected scope was recorded but not applied.`
    );
  }
  if (callerSetSector && detection.sector && detection.sector !== config.businessSector) {
    detection.notes.push(
      `Sector was supplied explicitly as '${config.businessSector}'; detection suggested '${detection.sector}'. The supplied value was used.`
    );
  }

  logSummary(detection, resolved);
  return { detection, config: resolved, probes };
}

function logSummary(detection: ScopeDetection, config: UniVerscanConfig): void {
  if (detection.inconclusive) {
    logger.warn(
      "Autoscan could not determine a target market from this site. Only jurisdiction-agnostic rules will run; pass --jurisdictions to scan against a specific regime."
    );
  } else {
    logger.info(
      `Autoscan detected market(s): ${detection.selected
        .map((market) => `${market.jurisdiction} [${market.confidence}]`)
        .join(", ")}`
    );
  }
  if (config.businessSector) logger.info(`Autoscan detected sector: ${config.businessSector}`);
  if (detection.considered.length > 0) {
    logger.warn(
      `Not scanned, evidence too thin: ${detection.considered
        .map((market) => market.jurisdiction)
        .join(", ")}. These markets are unknown, not clean.`
    );
  }
}
