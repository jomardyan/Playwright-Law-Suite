import type { Page } from "playwright";
import {
  CCTLD_MARKETS,
  CMP_DOMAINS,
  CURRENCY_MARKETS,
  LANGUAGE_MARKETS,
  LEGAL_DOCUMENT_MARKETS,
  REGION_MARKETS,
  REGULATION_MENTIONS,
  SECTOR_PATTERNS,
  type CanonicalJurisdiction,
  type ScopeSignal,
  type SectorSignal,
} from "./signals.js";

/**
 * Weight assigned to each class of signal. The ordering is the point: what a
 * site *declares* about the markets it serves (an hreflang alternate, a
 * country domain, a jurisdiction-specific legal document) is worth more than
 * what can be inferred from its content (a currency symbol, a language tag).
 */
const WEIGHTS = {
  hreflang: 5,
  legalDocument: 4,
  cctld: 4,
  regulationMention: 3,
  htmlLangWithRegion: 3,
  currency: 2,
  cmp: 2,
  htmlLangOnly: 1,
} as const;

export interface ScopeProbe {
  /** The URL the signals were collected from. */
  url: string;
  signals: ScopeSignal[];
  sectorSignals: SectorSignal[];
  /** True when the page could not be read at all, so nothing was inferred. */
  probeFailed: boolean;
}

/** Extracts the registrable ccTLD from a hostname, ignoring generic suffixes. */
export function ccTldOf(hostname: string): string | null {
  const labels = hostname.toLowerCase().split(".");
  const last = labels[labels.length - 1];
  if (!last || last.length !== 2) return null;
  return last;
}

/**
 * Splits a BCP 47 tag into its language and region halves. `en-GB` yields
 * both; `de` yields a language only; `x-default` yields neither, since it
 * denotes a fallback page rather than a market.
 */
export function parseLanguageTag(tag: string): { language: string | null; region: string | null } {
  const normalized = tag.trim();
  if (!normalized || /^x-default$/i.test(normalized)) return { language: null, region: null };
  const parts = normalized.split(/[-_]/);
  const language = parts[0]?.toLowerCase() || null;
  // The region is the first two-letter subtag after the language; a 4-letter
  // subtag is a script (zh-Hant-TW), which is skipped rather than misread.
  const region = parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase() ?? null;
  return { language, region };
}

function push(
  signals: ScopeSignal[],
  kind: ScopeSignal["kind"],
  jurisdiction: CanonicalJurisdiction,
  weight: number,
  detail: string,
  observedAt: string
): void {
  signals.push({ kind, jurisdiction, weight, detail, observedAt });
}

/**
 * Probes a rendered page for evidence of which markets it serves and what
 * kind of service it is.
 *
 * This reads only what the page already exposes - no geolocation lookups, no
 * third-party enrichment, no requests beyond the page itself. Every signal
 * it returns carries the text that produced it, so a reviewer can check the
 * inference rather than take it on trust.
 */
export class ScopeDetector {
  private readonly cmpHits = new Map<string, Set<string>>();

  /** Records consent-platform requests. Attach before navigating. */
  watch(page: Page): void {
    page.on("request", (request) => {
      let host: string;
      try {
        host = new URL(request.url()).hostname;
      } catch {
        return;
      }
      const match = CMP_DOMAINS.find((entry) => entry.pattern.test(host));
      if (!match) return;
      const bucket = this.cmpHits.get(page.url()) ?? new Set<string>();
      bucket.add(match.vendor);
      this.cmpHits.set(page.url(), bucket);
    });
  }

  async probe(page: Page): Promise<ScopeProbe> {
    const url = page.url();
    const signals: ScopeSignal[] = [];
    const sectorSignals: SectorSignal[] = [];

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { url, signals, sectorSignals, probeFailed: true };
    }

    // --- Country-code top-level domain ---
    const tld = ccTldOf(hostname);
    if (tld && CCTLD_MARKETS[tld]) {
      push(signals, "cctld", CCTLD_MARKETS[tld], WEIGHTS.cctld, `the .${tld} country domain`, hostname);
    }

    const documentInfo = await page
      .evaluate(() => ({
        lang: document.documentElement.getAttribute("lang") ?? "",
        hreflangs: Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map((el) =>
          el.getAttribute("hreflang") ?? ""
        ),
        linkText: Array.from(document.querySelectorAll("a[href]"))
          .map((el) => `${el.textContent ?? ""} ${el.getAttribute("href") ?? ""}`)
          .join(" \n ")
          .slice(0, 20000),
        bodyText: (document.body?.innerText ?? "").slice(0, 40000),
      }))
      .catch(() => null);

    if (!documentInfo) {
      return { url, signals, sectorSignals, probeFailed: true };
    }

    // --- hreflang alternates: the site naming its own target markets ---
    const seenRegions = new Set<string>();
    for (const tag of documentInfo.hreflangs) {
      const { region } = parseLanguageTag(tag);
      if (!region || seenRegions.has(region)) continue;
      seenRegions.add(region);
      const market = REGION_MARKETS[region];
      if (!market) continue;
      push(signals, "hreflang", market, WEIGHTS.hreflang, `an hreflang alternate for "${tag}"`, url);
    }

    // --- html lang ---
    const { language, region } = parseLanguageTag(documentInfo.lang);
    if (region && REGION_MARKETS[region]) {
      push(
        signals,
        "html-lang",
        REGION_MARKETS[region],
        WEIGHTS.htmlLangWithRegion,
        `<html lang="${documentInfo.lang}">`,
        url
      );
    } else if (language && LANGUAGE_MARKETS[language]) {
      push(
        signals,
        "html-lang",
        LANGUAGE_MARKETS[language],
        WEIGHTS.htmlLangOnly,
        `<html lang="${documentInfo.lang}"> (language only, no region - a weak market signal)`,
        url
      );
    }

    // --- Currencies in visible text ---
    for (const entry of CURRENCY_MARKETS) {
      const match = documentInfo.bodyText.match(entry.pattern);
      if (!match) continue;
      push(signals, "currency", entry.jurisdiction, WEIGHTS.currency, entry.label, url);
    }

    // --- Jurisdiction-specific legal documents ---
    const legalHaystack = `${documentInfo.linkText}\n${documentInfo.bodyText}`;
    for (const entry of LEGAL_DOCUMENT_MARKETS) {
      if (!entry.pattern.test(legalHaystack)) continue;
      push(signals, "legal-document", entry.jurisdiction, WEIGHTS.legalDocument, entry.label, url);
    }

    // --- Regulations named outright ---
    for (const entry of REGULATION_MENTIONS) {
      if (!entry.pattern.test(legalHaystack)) continue;
      push(
        signals,
        "regulation-mention",
        entry.jurisdiction,
        WEIGHTS.regulationMention,
        `${entry.label} named on the page`,
        url
      );
    }

    // --- Consent management platform ---
    for (const vendor of this.cmpHits.get(url) ?? []) {
      push(
        signals,
        "consent-management-platform",
        "European Union",
        WEIGHTS.cmp,
        `${vendor} consent platform loaded (deployed predominantly for EU/UK consent regimes)`,
        url
      );
    }
    this.cmpHits.delete(url);

    // --- Sector ---
    for (const entry of SECTOR_PATTERNS) {
      if (!entry.pattern.test(documentInfo.bodyText)) continue;
      sectorSignals.push({ sector: entry.sector, weight: 1, detail: entry.label });
    }

    return { url, signals, sectorSignals, probeFailed: false };
  }
}
