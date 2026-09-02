import type { ScopeProbe } from "./ScopeDetector.js";
import { CANONICAL_JURISDICTIONS, type CanonicalJurisdiction, type ScopeSignal } from "./signals.js";

export type ScopeConfidence = "high" | "medium" | "low";

export interface DetectedMarket {
  jurisdiction: CanonicalJurisdiction;
  score: number;
  confidence: ScopeConfidence;
  /** Every signal that contributed, so a reviewer can audit the inference. */
  evidence: ScopeSignal[];
}

export interface ScopeDetection {
  /** Markets scored highly enough to scan against. */
  selected: DetectedMarket[];
  /**
   * Markets with some evidence but below the selection threshold. These are
   * reported, never silently dropped: an unscanned market is an unknown, not
   * a market the site is compliant in.
   */
  considered: DetectedMarket[];
  /** Jurisdiction strings to put in the config, in the packs' own spelling. */
  jurisdictions: string[];
  /** Best-guess sector, or null when nothing distinctive was found. */
  sector: string | null;
  sectorEvidence: string[];
  /** True when no market cleared the threshold. */
  inconclusive: boolean;
  /** Plain-language notes for the report, including every caveat that applies. */
  notes: string[];
}

/**
 * A market needs this much accumulated evidence before autoscan will scan
 * against it. One declaration-grade signal (hreflang, a ccTLD, a
 * jurisdiction-specific legal document) clears it on its own; two weak
 * content signals do not.
 */
export const SELECTION_THRESHOLD = 4;

/** Below this, evidence is too thin to be worth reporting even as a candidate. */
export const CANDIDATE_THRESHOLD = 2;

/** Scores at or above this are reported as high confidence. */
export const HIGH_CONFIDENCE_THRESHOLD = 7;

function confidenceFor(score: number): ScopeConfidence {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (score >= SELECTION_THRESHOLD) return "medium";
  return "low";
}

/**
 * Distinct signal kinds matter more than repeated ones: three currency
 * matches for the same market are one observation, not three. Weight is
 * therefore taken once per (market, kind) pair, at the highest weight seen
 * for that pair.
 */
function scoreMarket(signals: ScopeSignal[]): number {
  const bestPerKind = new Map<string, number>();
  for (const signal of signals) {
    bestPerKind.set(signal.kind, Math.max(bestPerKind.get(signal.kind) ?? 0, signal.weight));
  }
  return Array.from(bestPerKind.values()).reduce((sum, weight) => sum + weight, 0);
}

function resolveSector(probe: ScopeProbe): { sector: string | null; evidence: string[] } {
  if (probe.sectorSignals.length === 0) return { sector: null, evidence: [] };
  const totals = new Map<string, { score: number; details: string[] }>();
  for (const signal of probe.sectorSignals) {
    const entry = totals.get(signal.sector) ?? { score: 0, details: [] };
    entry.score += signal.weight;
    entry.details.push(signal.detail);
    totals.set(signal.sector, entry);
  }
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1].score - a[1].score);
  const [sector, entry] = ranked[0];
  return { sector, evidence: entry.details };
}

/**
 * Turns raw probe signals into a scope decision.
 *
 * This is deliberately a pure function of the signals: the same evidence
 * always yields the same scope, and the reasoning can be unit-tested without
 * a browser. It decides what to *scan*, never what the operator is legally
 * obliged to do - that determination belongs to a person, which is why every
 * selection carries its evidence and every near-miss is reported too.
 */
export function resolveScope(probes: ScopeProbe[]): ScopeDetection {
  const notes: string[] = [];
  const usable = probes.filter((probe) => !probe.probeFailed);

  if (usable.length === 0) {
    return {
      selected: [],
      considered: [],
      jurisdictions: [],
      sector: null,
      sectorEvidence: [],
      inconclusive: true,
      notes: [
        "No page could be read, so no market signals were collected. Scope was not determined; supply --jurisdictions explicitly.",
      ],
    };
  }

  const byMarket = new Map<CanonicalJurisdiction, ScopeSignal[]>();
  for (const probe of usable) {
    for (const signal of probe.signals) {
      const bucket = byMarket.get(signal.jurisdiction) ?? [];
      bucket.push(signal);
      byMarket.set(signal.jurisdiction, bucket);
    }
  }

  const scored: DetectedMarket[] = Array.from(byMarket.entries())
    .map(([jurisdiction, evidence]) => {
      const score = scoreMarket(evidence);
      return { jurisdiction, score, confidence: confidenceFor(score), evidence };
    })
    .sort((a, b) => b.score - a.score || a.jurisdiction.localeCompare(b.jurisdiction));

  const selected = scored.filter((market) => market.score >= SELECTION_THRESHOLD);
  const considered = scored.filter(
    (market) => market.score < SELECTION_THRESHOLD && market.score >= CANDIDATE_THRESHOLD
  );

  // California has its own pack and is also covered by the multi-state one.
  // Detecting California implies the site serves US consumers, so the
  // broader US jurisdiction comes along with it rather than being missed.
  const jurisdictions = selected.map((market) => market.jurisdiction as string);
  if (
    jurisdictions.includes(CANONICAL_JURISDICTIONS.US_CA) &&
    !jurisdictions.includes(CANONICAL_JURISDICTIONS.US)
  ) {
    jurisdictions.push(CANONICAL_JURISDICTIONS.US);
    notes.push(
      "California-specific signals imply a US consumer audience, so 'United States' was added to pick up the multi-state universal opt-out rules."
    );
  }

  const { sector, evidence: sectorEvidence } = resolveSector(usable[0]);

  notes.push(
    "Scope was inferred from what the site exposes, not from any record of where the operator does business. Confirm it before relying on the result: a market that was not detected was not scanned, and an unscanned market is an unknown rather than a clean one."
  );
  if (considered.length > 0) {
    notes.push(
      `${considered.length} further market(s) showed some evidence but not enough to scan against: ${considered
        .map((market) => `${market.jurisdiction} (score ${market.score})`)
        .join(", ")}. Add them with --jurisdictions if they apply.`
    );
  }
  if (selected.some((market) => market.confidence === "medium")) {
    notes.push(
      "Some markets were selected on medium confidence. Review their evidence below before treating the pack selection as settled."
    );
  }
  if (sector) {
    notes.push(
      `Sector was inferred as '${sector}'. Sector changes which rules run for the European Accessibility Act and the Consumer Rights Directive, so correct it with --sector if it is wrong.`
    );
  } else {
    notes.push(
      "No distinctive sector language was found. Sector-gated packs will apply their default behavior; pass --sector if you know it."
    );
  }

  return {
    selected,
    considered,
    jurisdictions,
    sector,
    sectorEvidence,
    inconclusive: selected.length === 0,
    notes,
  };
}
