import { describe, expect, it } from "vitest";
import { ccTldOf, parseLanguageTag, type ScopeProbe } from "../src/modules/scope/ScopeDetector.js";
import {
  CANDIDATE_THRESHOLD,
  SELECTION_THRESHOLD,
  resolveScope,
} from "../src/modules/scope/resolveScope.js";
import { CANONICAL_JURISDICTIONS, type ScopeSignal } from "../src/modules/scope/signals.js";
import { PackLoader } from "../src/packs/PackLoader.js";
import { loadConfigFromObject } from "../src/config/loader.js";

function signal(overrides: Partial<ScopeSignal> = {}): ScopeSignal {
  return {
    kind: "hreflang",
    jurisdiction: CANONICAL_JURISDICTIONS.EU,
    weight: 5,
    detail: "an hreflang alternate for \"de-DE\"",
    observedAt: "https://shop.example/",
    ...overrides,
  };
}

function probe(signals: ScopeSignal[], overrides: Partial<ScopeProbe> = {}): ScopeProbe {
  return {
    url: "https://shop.example/",
    signals,
    sectorSignals: [],
    probeFailed: false,
    ...overrides,
  };
}

describe("ccTldOf", () => {
  it("reads a two-letter country suffix", () => {
    expect(ccTldOf("shop.example.de")).toBe("de");
    expect(ccTldOf("www.shop.co.uk")).toBe("uk");
  });

  it("returns the suffix for generic domains too, so the caller decides what is a market", () => {
    expect(ccTldOf("shop.example.com")).toBeNull();
    expect(ccTldOf("shop.example.online")).toBeNull();
  });

  it("handles a bare hostname", () => {
    expect(ccTldOf("localhost")).toBeNull();
  });
});

describe("parseLanguageTag", () => {
  it("splits language and region", () => {
    expect(parseLanguageTag("en-GB")).toEqual({ language: "en", region: "GB" });
    expect(parseLanguageTag("de_AT")).toEqual({ language: "de", region: "AT" });
  });

  it("returns no region for a bare language", () => {
    expect(parseLanguageTag("fr")).toEqual({ language: "fr", region: null });
  });

  it("skips a script subtag rather than mistaking it for a region", () => {
    expect(parseLanguageTag("zh-Hant-TW")).toEqual({ language: "zh", region: "TW" });
  });

  it("treats x-default as no market, since it denotes a fallback page", () => {
    expect(parseLanguageTag("x-default")).toEqual({ language: null, region: null });
  });

  it("ignores empty input", () => {
    expect(parseLanguageTag("")).toEqual({ language: null, region: null });
  });
});

describe("resolveScope", () => {
  it("selects a market on a single declaration-grade signal", () => {
    const detection = resolveScope([probe([signal({ kind: "hreflang", weight: 5 })])]);

    expect(detection.jurisdictions).toEqual(["European Union"]);
    expect(detection.selected[0].confidence).toBe("medium");
    expect(detection.inconclusive).toBe(false);
  });

  it("raises confidence to high when independent signals agree", () => {
    const detection = resolveScope([
      probe([
        signal({ kind: "hreflang", weight: 5 }),
        signal({ kind: "cctld", weight: 4, detail: "the .de country domain" }),
        signal({ kind: "currency", weight: 2, detail: "euro prices" }),
      ]),
    ]);

    expect(detection.selected[0].confidence).toBe("high");
    expect(detection.selected[0].score).toBe(11);
  });

  it("counts a repeated signal kind once, so three currency matches are one observation", () => {
    const detection = resolveScope([
      probe([
        signal({ kind: "currency", weight: 2, detail: "euro prices" }),
        signal({ kind: "currency", weight: 2, detail: "euro prices" }),
        signal({ kind: "currency", weight: 2, detail: "euro prices" }),
      ]),
    ]);

    expect(detection.selected).toHaveLength(0);
    expect(detection.considered[0].score).toBe(2);
  });

  it("reports a thin-evidence market as considered rather than scanning or dropping it", () => {
    const detection = resolveScope([
      probe([
        signal({ kind: "hreflang", weight: 5 }),
        signal({ jurisdiction: CANONICAL_JURISDICTIONS.JP, kind: "currency", weight: 2, detail: "yen prices" }),
      ]),
    ]);

    expect(detection.jurisdictions).toEqual(["European Union"]);
    expect(detection.considered.map((m) => m.jurisdiction)).toEqual(["Japan"]);
    expect(detection.notes.join(" ")).toContain("not enough to scan against");
  });

  it("drops evidence below the candidate threshold entirely", () => {
    const detection = resolveScope([
      probe([signal({ jurisdiction: CANONICAL_JURISDICTIONS.JP, kind: "html-lang", weight: 1, detail: "lang=ja" })]),
    ]);

    expect(detection.selected).toHaveLength(0);
    expect(detection.considered).toHaveLength(0);
    expect(detection.inconclusive).toBe(true);
  });

  it("adds the broader US jurisdiction when California is detected", () => {
    const detection = resolveScope([
      probe([
        signal({
          jurisdiction: CANONICAL_JURISDICTIONS.US_CA,
          kind: "legal-document",
          weight: 4,
          detail: "a 'Do Not Sell or Share' link",
        }),
      ]),
    ]);

    expect(detection.jurisdictions).toEqual(["United States - California", "United States"]);
    expect(detection.notes.join(" ")).toContain("multi-state universal opt-out");
  });

  it("aggregates signals across every probed page", () => {
    const detection = resolveScope([
      probe([signal({ kind: "cctld", weight: 4, detail: "the .de country domain" })], { url: "https://shop.example/" }),
      probe([signal({ kind: "regulation-mention", weight: 3, detail: "GDPR named on the page" })], {
        url: "https://shop.example/privacy",
      }),
    ]);

    expect(detection.selected[0].score).toBe(7);
    expect(detection.selected[0].evidence).toHaveLength(2);
  });

  it("is inconclusive, never silently empty, when nothing was detected", () => {
    const detection = resolveScope([probe([])]);

    expect(detection.inconclusive).toBe(true);
    expect(detection.jurisdictions).toEqual([]);
    expect(detection.notes.join(" ")).toContain("Confirm it before relying on the result");
  });

  it("reports a total probe failure distinctly from a page with no signals", () => {
    const detection = resolveScope([probe([], { probeFailed: true })]);

    expect(detection.inconclusive).toBe(true);
    expect(detection.notes.join(" ")).toContain("No page could be read");
  });

  it("always carries the caveat that an undetected market is unknown, not clean", () => {
    const detection = resolveScope([probe([signal()])]);
    expect(detection.notes.join(" ")).toContain("unscanned market is an unknown");
  });

  it("picks the sector with the most supporting evidence and records it", () => {
    const detection = resolveScope([
      probe([signal()], {
        sectorSignals: [
          { sector: "e-commerce", weight: 1, detail: "cart and checkout controls" },
          { sector: "e-commerce", weight: 1, detail: "more cart language" },
          { sector: "saas", weight: 1, detail: "software subscription language" },
        ],
      }),
    ]);

    expect(detection.sector).toBe("e-commerce");
    expect(detection.sectorEvidence).toHaveLength(2);
    expect(detection.notes.join(" ")).toContain("correct it with --sector");
  });

  it("says so plainly when no sector could be determined", () => {
    const detection = resolveScope([probe([signal()])]);
    expect(detection.sector).toBeNull();
    expect(detection.notes.join(" ")).toContain("No distinctive sector language was found");
  });

  it("keeps the documented thresholds in the expected order", () => {
    expect(CANDIDATE_THRESHOLD).toBeLessThan(SELECTION_THRESHOLD);
  });
});

describe("detected jurisdictions load the packs they name", () => {
  // A near-miss spelling ("EU-27", "UK/GB") silently loads no pack, which
  // would read as a clean scan of a site nobody actually checked. Every
  // canonical string is therefore asserted against the real loader.
  const expectations: Array<{ jurisdiction: string; expectPack: string }> = [
    { jurisdiction: CANONICAL_JURISDICTIONS.EU, expectPack: "eu-gdpr-eprivacy" },
    { jurisdiction: CANONICAL_JURISDICTIONS.UK, expectPack: "uk-gdpr-pecr" },
    { jurisdiction: CANONICAL_JURISDICTIONS.US_CA, expectPack: "us-ca-ccpa-cpra" },
    { jurisdiction: CANONICAL_JURISDICTIONS.US, expectPack: "us-state-privacy" },
    { jurisdiction: CANONICAL_JURISDICTIONS.AU, expectPack: "au-privacy-dda" },
    { jurisdiction: CANONICAL_JURISDICTIONS.BR, expectPack: "br-lgpd" },
    { jurisdiction: CANONICAL_JURISDICTIONS.CA, expectPack: "ca-pipeda" },
    { jurisdiction: CANONICAL_JURISDICTIONS.JP, expectPack: "jp-appi" },
    { jurisdiction: CANONICAL_JURISDICTIONS.IN, expectPack: "in-dpdp" },
    { jurisdiction: CANONICAL_JURISDICTIONS.CN, expectPack: "cn-pipl" },
    { jurisdiction: CANONICAL_JURISDICTIONS.KR, expectPack: "kr-pipa" },
    { jurisdiction: CANONICAL_JURISDICTIONS.CH, expectPack: "ch-fadp" },
    { jurisdiction: CANONICAL_JURISDICTIONS.CA_QC, expectPack: "ca-qc-law25" },
    { jurisdiction: CANONICAL_JURISDICTIONS.TH, expectPack: "th-pdpa" },
    { jurisdiction: CANONICAL_JURISDICTIONS.SG, expectPack: "sg-pdpa" },
    { jurisdiction: CANONICAL_JURISDICTIONS.ZA, expectPack: "za-popia" },
    { jurisdiction: CANONICAL_JURISDICTIONS.SA, expectPack: "sa-pdpl" },
    { jurisdiction: CANONICAL_JURISDICTIONS.NG, expectPack: "ng-ndpa" },
  ];

  for (const { jurisdiction, expectPack } of expectations) {
    it(`"${jurisdiction}" loads ${expectPack}`, async () => {
      const packs = await new PackLoader().load(
        loadConfigFromObject({ target: { url: "https://example.com" }, jurisdictions: [jurisdiction] })
      );
      expect(packs.map((p) => p.id)).toContain(expectPack);
    });
  }

  it("keeps regimes with similar names apart", async () => {
    // "South Africa"/"South Korea" and the PIPA/PIPL/POPIA/PDPA/PDPL family
    // of acronyms are easy to cross-match with a careless regex.
    const cases: Array<[string, string, string[]]> = [
      [CANONICAL_JURISDICTIONS.ZA, "za-popia", ["kr-pipa", "th-pdpa", "sa-pdpl"]],
      [CANONICAL_JURISDICTIONS.KR, "kr-pipa", ["za-popia", "cn-pipl", "th-pdpa"]],
      [CANONICAL_JURISDICTIONS.CN, "cn-pipl", ["kr-pipa", "sa-pdpl"]],
      [CANONICAL_JURISDICTIONS.SA, "sa-pdpl", ["za-popia", "th-pdpa", "sg-pdpa"]],
      [CANONICAL_JURISDICTIONS.TH, "th-pdpa", ["sg-pdpa", "sa-pdpl"]],
      [CANONICAL_JURISDICTIONS.SG, "sg-pdpa", ["th-pdpa", "za-popia"]],
    ];
    for (const [jurisdiction, expected, forbidden] of cases) {
      const ids = (
        await new PackLoader().load(loadConfigFromObject({ jurisdictions: [jurisdiction] }))
      ).map((p) => p.id);
      expect(ids, jurisdiction).toContain(expected);
      for (const other of forbidden) {
        expect(ids, `${jurisdiction} must not load ${other}`).not.toContain(other);
      }
    }
  });

  it("loads both the federal and provincial pack for Quebec, and only the federal one for Canada", async () => {
    const quebec = (
      await new PackLoader().load(loadConfigFromObject({ jurisdictions: [CANONICAL_JURISDICTIONS.CA_QC] }))
    ).map((p) => p.id);
    expect(quebec).toContain("ca-qc-law25");
    expect(quebec).toContain("ca-pipeda");

    const canada = (
      await new PackLoader().load(loadConfigFromObject({ jurisdictions: [CANONICAL_JURISDICTIONS.CA] }))
    ).map((p) => p.id);
    expect(canada).toContain("ca-pipeda");
    expect(canada).not.toContain("ca-qc-law25");
  });

  it("does not confuse Canada with California", async () => {
    const canada = await new PackLoader().load(
      loadConfigFromObject({ jurisdictions: [CANONICAL_JURISDICTIONS.CA] })
    );
    expect(canada.map((p) => p.id)).not.toContain("us-ca-ccpa-cpra");

    const california = await new PackLoader().load(
      loadConfigFromObject({ jurisdictions: [CANONICAL_JURISDICTIONS.US_CA] })
    );
    expect(california.map((p) => p.id)).not.toContain("ca-pipeda");
  });
});
