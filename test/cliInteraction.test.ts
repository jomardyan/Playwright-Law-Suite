import { describe, expect, it } from "vitest";
import { parseSelection } from "../src/cli/prompts.js";
import { filterFindings, sortFindings } from "../src/cli/explore.js";
import { renderConsoleReport } from "../src/reporters/ConsoleReporter.js";
import { createProgressReporter, silentProgress } from "../src/cli/progress.js";
import { stripAnsi, visibleLength, type TerminalCapabilities } from "../src/cli/terminal.js";
import type { Finding, ScanReport } from "../src/engine/types.js";

const PLAIN: TerminalCapabilities = { color: false, unicode: false, interactive: false, width: 90 };

describe("parseSelection", () => {
  it("reads a list of numbers as zero-based indices", () => {
    expect(parseSelection("1,3", 5)).toEqual([0, 2]);
  });

  it("reads a range", () => {
    expect(parseSelection("2-4", 5)).toEqual([1, 2, 3]);
  });

  it("mixes numbers and ranges, de-duplicating and sorting", () => {
    expect(parseSelection("4, 1-2, 1", 5)).toEqual([0, 1, 3]);
  });

  it("understands all and none", () => {
    expect(parseSelection("all", 3)).toEqual([0, 1, 2]);
    expect(parseSelection("none", 3)).toEqual([]);
    expect(parseSelection("  ALL ", 2)).toEqual([0, 1]);
  });

  it("rejects out-of-range values rather than clamping them", () => {
    expect(parseSelection("0", 3)).toBeNull();
    expect(parseSelection("4", 3)).toBeNull();
    expect(parseSelection("1-9", 3)).toBeNull();
  });

  it("rejects a reversed range", () => {
    expect(parseSelection("3-1", 5)).toBeNull();
  });

  it("rejects anything non-numeric", () => {
    expect(parseSelection("first", 3)).toBeNull();
    expect(parseSelection("1;2", 3)).toBeNull();
  });

  it("tolerates stray commas and whitespace", () => {
    expect(parseSelection(" 1 , , 2 ", 3)).toEqual([0, 1]);
  });
});

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "rule-a",
    packId: "pack-x",
    regulation: "GDPR",
    jurisdiction: "European Union",
    requirement: "A requirement.",
    status: "violation",
    severity: "high",
    confidence: "high",
    automationLevel: "fully-automated",
    affectedUrl: "https://example.com/",
    observedBehavior: "Something was observed.",
    expectedBehavior: "Something else was expected.",
    evidence: [],
    ...overrides,
  };
}

describe("explore filtering", () => {
  const findings = [
    finding({ ruleId: "a", severity: "critical", status: "violation", packId: "eu-gdpr-eprivacy" }),
    finding({ ruleId: "b", severity: "medium", status: "risk", packId: "global-data-security" }),
    finding({ ruleId: "c", severity: "high", status: "manual-review", packId: "eu-gdpr-eprivacy" }),
  ];

  it("returns everything when no filter is set", () => {
    expect(filterFindings(findings, {})).toHaveLength(3);
  });

  it("filters by status, severity and pack independently", () => {
    expect(filterFindings(findings, { status: "risk" }).map((f) => f.ruleId)).toEqual(["b"]);
    expect(filterFindings(findings, { severity: "critical" }).map((f) => f.ruleId)).toEqual(["a"]);
    expect(filterFindings(findings, { pack: "eu-gdpr-eprivacy" }).map((f) => f.ruleId)).toEqual(["a", "c"]);
  });

  it("combines filters with AND", () => {
    expect(filterFindings(findings, { pack: "eu-gdpr-eprivacy", severity: "high" }).map((f) => f.ruleId)).toEqual(["c"]);
  });

  it("searches case-insensitively across the fields a reader would look in", () => {
    const withUrl = [finding({ ruleId: "z", affectedUrl: "https://shop.example/CHECKOUT" })];
    expect(filterFindings(withUrl, { search: "checkout" })).toHaveLength(1);
    expect(filterFindings(withUrl, { search: "nothing-here" })).toHaveLength(0);
  });

  it("sorts most severe first, with a stable tiebreak on rule id", () => {
    const sorted = sortFindings([
      finding({ ruleId: "z", severity: "low" }),
      finding({ ruleId: "b", severity: "critical" }),
      finding({ ruleId: "a", severity: "critical" }),
      finding({ ruleId: "m", severity: "manual-review" }),
    ]);
    expect(sorted.map((f) => f.ruleId)).toEqual(["a", "b", "z", "m"]);
  });
});

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    meta: {
      tool: "UniVerscan",
      generatedAt: "2026-01-01T00:00:00Z",
      mode: "live",
      target: { url: "https://example.com" },
      jurisdictions: ["European Union"],
      packs: [{ id: "eu-gdpr-eprivacy", regulation: "GDPR", version: "1.0.0" }],
    },
    findings: [finding()],
    suppressedFindings: [],
    unreachablePages: [],
    thirdPartyServices: [],
    coverage: {
      jurisdictionsSelected: ["European Union"],
      packsLoaded: ["eu-gdpr-eprivacy"],
      rulesEvaluated: 6,
      rulesSkippedNotApplicable: 1,
      rulesNotEvaluated: 2,
      pagesScanned: 3,
      pagesUnreachable: 0,
      manualReviewItems: 1,
      findingsSuppressedByException: 0,
    },
    riskIndicators: {
      automatedTechnicalCoverage: 0.75,
      detectedTechnicalConformity: 0.5,
      unresolvedComplianceRisk: 0.5,
      manualReviewWorkload: 0.25,
      scanCompleteness: 1,
    },
    ...overrides,
  };
}

describe("console report rendering", () => {
  it("emits no escape sequences when colour is off", () => {
    const output = renderConsoleReport(report(), PLAIN).join("\n");
    expect(output).toBe(stripAnsi(output));
  });

  it("never exceeds the terminal width", () => {
    const narrow: TerminalCapabilities = { ...PLAIN, width: 60 };
    const wordy = report({
      findings: [
        finding({
          observedBehavior: "x".repeat(400),
          affectedUrl: `https://example.com/${"segment/".repeat(30)}`,
          ruleId: "a-very-long-rule-identifier-that-keeps-going",
        }),
      ],
    });
    for (const line of renderConsoleReport(wordy, narrow)) {
      expect(visibleLength(line)).toBeLessThanOrEqual(narrow.width);
    }
  });

  it("calls out rules that could not run rather than leaving them as a bare count", () => {
    const output = renderConsoleReport(report(), PLAIN).join("\n");
    expect(output).toContain("Rules that could not run");
    expect(output).toContain("not passes");
  });

  it("keeps the disclaimer that this is not a compliance verdict", () => {
    expect(renderConsoleReport(report(), PLAIN).join("\n")).toContain("does not, on its own, certify legal compliance");
  });

  it("marks an autoscan-inferred scope as inferred", () => {
    const inferred = report();
    inferred.meta.scopeDetection = {
      selected: [{ jurisdiction: "European Union", score: 9, confidence: "high", evidence: [] }],
      considered: [{ jurisdiction: "Japan", score: 2, confidence: "low", evidence: [] }],
      jurisdictions: ["European Union"],
      sector: "e-commerce",
      sectorEvidence: [],
      inconclusive: false,
      notes: [],
    };
    const output = renderConsoleReport(inferred, PLAIN).join("\n");
    expect(output).toContain("INFERRED by autoscan");
    expect(output).toContain("Japan");
    expect(output).toContain("unknown, not clean");
  });

  it("lists suppressed findings as recorded, not resolved", () => {
    const output = renderConsoleReport(
      report({ suppressedFindings: [{ finding: finding(), reason: "Accepted by the DPO." }] }),
      PLAIN
    ).join("\n");
    expect(output).toContain("Accepted risks, suppressed by configuration");
    expect(output).toContain("not resolved findings");
  });

  it("caps a very long severity group and says how many were withheld", () => {
    const many = report({
      findings: Array.from({ length: 40 }, (_, index) => finding({ ruleId: `rule-${index}`, severity: "high" })),
    });
    const output = renderConsoleReport(many, PLAIN).join("\n");
    expect(output).toContain("and 25 more");
  });
});

describe("progress reporter", () => {
  it("returns a silent reporter when quiet", () => {
    expect(createProgressReporter(PLAIN, { quiet: true })).toBe(silentProgress);
  });

  it("produces a usable reporter for a non-colour terminal without throwing", () => {
    const progress = createProgressReporter(PLAIN);
    expect(() => {
      progress.start("Scanning", 2);
      progress.step("https://example.com/");
      progress.warn("something odd");
      progress.finish("done");
      progress.stop();
      progress.stop(); // idempotent
    }).not.toThrow();
  });
});
