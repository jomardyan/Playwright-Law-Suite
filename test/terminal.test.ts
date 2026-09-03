import { describe, expect, it } from "vitest";
import {
  Styler,
  clampWidth,
  detectCapabilities,
  padEnd,
  renderTable,
  stripAnsi,
  symbolsFor,
  truncate,
  visibleLength,
  wrap,
  type CapabilityEnvironment,
  type TerminalCapabilities,
} from "../src/cli/terminal.js";

function environment(overrides: Partial<CapabilityEnvironment> = {}): CapabilityEnvironment {
  return { isTTY: true, stdinIsTTY: true, columns: 100, env: {}, ...overrides };
}

const PLAIN: TerminalCapabilities = { color: false, unicode: false, interactive: false, width: 80 };
const RICH: TerminalCapabilities = { color: true, unicode: true, interactive: true, width: 80 };

describe("detectCapabilities", () => {
  it("enables colour on a TTY with no overriding environment", () => {
    expect(detectCapabilities(environment()).color).toBe(true);
  });

  it("disables colour when stdout is not a TTY", () => {
    expect(detectCapabilities(environment({ isTTY: false })).color).toBe(false);
  });

  it("honours NO_COLOR even on a TTY", () => {
    expect(detectCapabilities(environment({ env: { NO_COLOR: "1" } })).color).toBe(false);
  });

  it("treats an empty NO_COLOR as unset, per the convention", () => {
    expect(detectCapabilities(environment({ env: { NO_COLOR: "" } })).color).toBe(true);
  });

  it("honours FORCE_COLOR when output is piped", () => {
    expect(detectCapabilities(environment({ isTTY: false, env: { FORCE_COLOR: "1" } })).color).toBe(true);
  });

  it("lets NO_COLOR win over FORCE_COLOR", () => {
    expect(detectCapabilities(environment({ env: { FORCE_COLOR: "1", NO_COLOR: "1" } })).color).toBe(false);
  });

  it("treats FORCE_COLOR=0 as not forcing", () => {
    expect(detectCapabilities(environment({ isTTY: false, env: { FORCE_COLOR: "0" } })).color).toBe(false);
  });

  it("disables colour and interactivity for TERM=dumb", () => {
    const capabilities = detectCapabilities(environment({ env: { TERM: "dumb" } }));
    expect(capabilities.color).toBe(false);
    expect(capabilities.interactive).toBe(false);
    expect(capabilities.unicode).toBe(false);
  });

  it("is never interactive in CI, even with a TTY attached", () => {
    expect(detectCapabilities(environment({ env: { CI: "true" } })).interactive).toBe(false);
    expect(detectCapabilities(environment({ env: { CI: "1" } })).interactive).toBe(false);
  });

  it("treats CI=false as not CI", () => {
    expect(detectCapabilities(environment({ env: { CI: "false" } })).interactive).toBe(true);
  });

  it("needs stdin to be a TTY before it will call the session interactive", () => {
    expect(detectCapabilities(environment({ stdinIsTTY: false })).interactive).toBe(false);
  });

  it("enables unicode for a UTF-8 locale", () => {
    expect(detectCapabilities(environment({ env: { LANG: "en_US.UTF-8" } })).unicode).toBe(true);
  });
});

describe("clampWidth", () => {
  it("falls back to a default when the width is unknown", () => {
    expect(clampWidth(undefined)).toBe(100);
    expect(clampWidth(0)).toBe(100);
    expect(clampWidth(Number.NaN)).toBe(100);
  });

  it("clamps a very narrow or very wide terminal into a usable range", () => {
    expect(clampWidth(10)).toBe(40);
    expect(clampWidth(500)).toBe(160);
    expect(clampWidth(120)).toBe(120);
  });
});

describe("Styler", () => {
  it("emits no escape sequences when colour is off", () => {
    const styler = new Styler(PLAIN);
    expect(styler.red("danger")).toBe("danger");
    expect(styler.severity("critical")).toBe("critical");
    expect(stripAnsi(styler.status("violation"))).toBe("violation");
  });

  it("wraps text in escape sequences when colour is on", () => {
    const styler = new Styler(RICH);
    const output = styler.red("danger");
    expect(output).not.toBe("danger");
    expect(stripAnsi(output)).toBe("danger");
  });

  it("colours a not-evaluated status as a warning, not as neutral", () => {
    const styler = new Styler(RICH);
    expect(styler.status("not-evaluated")).not.toBe(styler.status("informational"));
  });

  it("keeps the printable text intact for every severity", () => {
    const styler = new Styler(RICH);
    for (const severity of ["critical", "high", "medium", "low", "manual-review", "informational"]) {
      expect(stripAnsi(styler.severity(severity))).toBe(severity);
    }
  });
});

describe("symbolsFor", () => {
  it("falls back to ASCII without unicode support", () => {
    const symbols = symbolsFor(PLAIN);
    expect(symbols.check).toBe("+");
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(Object.values(symbols).flat().join(""))).toBe(true);
  });

  it("uses unicode glyphs when supported", () => {
    expect(symbolsFor(RICH).check).toBe("✓");
  });
});

describe("truncate / padEnd / visibleLength", () => {
  it("leaves short text untouched", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("adds an ellipsis when it cuts", () => {
    expect(truncate("abcdefghij", 8)).toBe("abcde...");
    expect(truncate("abcdefghij", 8)).toHaveLength(8);
  });

  it("degrades sanely when the budget is smaller than the ellipsis", () => {
    expect(truncate("abcdefghij", 2)).toBe("ab");
  });

  it("measures and pads by printable length, ignoring escape sequences", () => {
    const styled = new Styler(RICH).red("abc");
    expect(visibleLength(styled)).toBe(3);
    expect(visibleLength(padEnd(styled, 10))).toBe(10);
  });

  it("strips styling when truncating, so a cut never severs an escape sequence", () => {
    const styled = new Styler(RICH).red("abcdefghij");
    expect(truncate(styled, 5)).toBe("ab...");
  });
});

describe("wrap", () => {
  it("breaks on spaces within the width", () => {
    expect(wrap("one two three four five", 10)).toEqual(["one two", "three four", "five"]);
  });

  it("applies the indent to every line and counts it against the width", () => {
    const lines = wrap("one two three four", 12, "  ");
    expect(lines.every((line) => line.startsWith("  "))).toBe(true);
    expect(lines.every((line) => line.length <= 12)).toBe(true);
  });

  it("preserves existing newlines as paragraph breaks", () => {
    expect(wrap("first\nsecond", 40)).toEqual(["first", "second"]);
  });

  it("does not drop a word longer than the width", () => {
    expect(wrap("supercalifragilistic", 8)).toEqual(["supercalifragilistic"]);
  });
});

describe("renderTable", () => {
  const styler = new Styler(PLAIN);

  it("returns nothing for an empty row set", () => {
    expect(renderTable([{ header: "A" }], [], PLAIN, styler)).toEqual([]);
  });

  it("sizes columns to content when everything fits", () => {
    const lines = renderTable(
      [{ header: "PACK" }, { header: "RULES" }],
      [["eu-gdpr-eprivacy", "6"]],
      PLAIN,
      styler
    );
    // The cap must not truncate a table that already fits.
    expect(lines[2]).toContain("eu-gdpr-eprivacy");
  });

  it("never exceeds the terminal width, even with a very long cell", () => {
    const narrow: TerminalCapabilities = { ...PLAIN, width: 50 };
    const lines = renderTable(
      [{ header: "RULE", maxShare: 0.4 }, { header: "WHERE", maxShare: 0.4 }],
      [["a".repeat(200), "https://example.com/".repeat(20)]],
      narrow,
      new Styler(narrow)
    );
    for (const line of lines) {
      expect(visibleLength(line)).toBeLessThanOrEqual(narrow.width);
    }
  });

  it("truncates the widest column rather than dropping a narrow one", () => {
    const narrow: TerminalCapabilities = { ...PLAIN, width: 44 };
    const lines = renderTable(
      [{ header: "SEV" }, { header: "OBSERVED", maxShare: 0.6 }],
      [["critical", "x".repeat(300)]],
      narrow,
      new Styler(narrow)
    );
    // The short severity column survives intact.
    expect(lines[2]).toContain("critical");
  });

  it("right-aligns a column when asked", () => {
    const lines = renderTable(
      [{ header: "NAME" }, { header: "N", align: "right" }],
      [["a", "7"], ["bbbb", "12"]],
      PLAIN,
      styler
    );
    expect(lines[2].endsWith(" 7")).toBe(true);
  });
});
