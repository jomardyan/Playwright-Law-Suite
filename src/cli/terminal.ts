/**
 * Terminal capability detection and formatting primitives.
 *
 * Everything here degrades: colour becomes plain text, Unicode becomes
 * ASCII, and interactive affordances disappear when there is no TTY. A
 * compliance scan runs far more often in CI than in front of a person, and
 * output that is unreadable in a pipeline log is worse than output that was
 * never decorated.
 */

export interface TerminalCapabilities {
  /** Colour escape sequences are safe to emit. */
  color: boolean;
  /** Non-ASCII box drawing and symbols are safe to emit. */
  unicode: boolean;
  /** stdin and stdout are both a TTY, so a person can answer a prompt. */
  interactive: boolean;
  /** Usable output width in columns. */
  width: number;
}

export interface CapabilityEnvironment {
  isTTY: boolean;
  stdinIsTTY: boolean;
  columns?: number;
  env: Record<string, string | undefined>;
}

const DEFAULT_WIDTH = 100;
const MIN_WIDTH = 40;
const MAX_WIDTH = 160;

/**
 * Resolves what the terminal can do.
 *
 * Honours the conventions users already expect: `NO_COLOR` disables colour
 * whatever else is true, `FORCE_COLOR` re-enables it for a pipe, and
 * `TERM=dumb` means plain text. `CI` suppresses interactivity even where a
 * TTY is somehow present, because nothing there can answer a question.
 */
export function detectCapabilities(environment: CapabilityEnvironment): TerminalCapabilities {
  const { env } = environment;

  // https://no-color.org - any non-empty value disables colour.
  const noColor = typeof env.NO_COLOR === "string" && env.NO_COLOR !== "";
  const forceColor = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "";
  const dumbTerminal = env.TERM === "dumb";
  const inCi = Boolean(env.CI) && env.CI !== "0" && env.CI !== "false";

  const color = forceColor ? !noColor : !noColor && !dumbTerminal && environment.isTTY;

  // A UTF-8 locale is the only portable hint that box-drawing characters
  // will render; Windows consoles without it produce mojibake.
  const locale = `${env.LC_ALL ?? ""}${env.LC_CTYPE ?? ""}${env.LANG ?? ""}`;
  const unicode = !dumbTerminal && (/UTF-?8/i.test(locale) || env.WT_SESSION !== undefined || process.platform === "darwin");

  const width = clampWidth(environment.columns);

  return {
    color,
    unicode,
    interactive: environment.isTTY && environment.stdinIsTTY && !dumbTerminal && !inCi,
    width,
  };
}

export function clampWidth(columns: number | undefined): number {
  if (!columns || Number.isNaN(columns)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, columns));
}

/** Reads capabilities from the real process. */
export function currentCapabilities(): TerminalCapabilities {
  return detectCapabilities({
    isTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    columns: process.stdout.columns,
    env: process.env,
  });
}

const CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  italic: "\u001b[3m",
  underline: "\u001b[4m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
  brightRed: "\u001b[91m",
  brightYellow: "\u001b[93m",
} as const;

export type StyleName = keyof typeof CODES;

/** A palette bound to one set of capabilities. Every method is a no-op without colour. */
export class Styler {
  constructor(private readonly capabilities: TerminalCapabilities) {}

  apply(style: StyleName, text: string): string {
    if (!this.capabilities.color) return text;
    return `${CODES[style]}${text}${CODES.reset}`;
  }

  bold = (text: string): string => this.apply("bold", text);
  dim = (text: string): string => this.apply("dim", text);
  red = (text: string): string => this.apply("red", text);
  green = (text: string): string => this.apply("green", text);
  yellow = (text: string): string => this.apply("yellow", text);
  blue = (text: string): string => this.apply("blue", text);
  magenta = (text: string): string => this.apply("magenta", text);
  cyan = (text: string): string => this.apply("cyan", text);
  gray = (text: string): string => this.apply("gray", text);

  /**
   * Severity colours. `manual-review` is deliberately not red or green: it
   * is neither a failure nor a pass, and colouring it as either would
   * misrepresent what the scanner actually established.
   */
  severity(severity: string, text = severity): string {
    switch (severity) {
      case "critical":
        return this.apply("brightRed", this.capabilities.color ? `${CODES.bold}${text}` : text);
      case "high":
        return this.apply("red", text);
      case "medium":
        return this.apply("yellow", text);
      case "low":
        return this.apply("cyan", text);
      case "manual-review":
        return this.apply("magenta", text);
      default:
        return this.apply("gray", text);
    }
  }

  /**
   * Status colours. `not-evaluated` is styled as a warning rather than a
   * neutral: a check that could not run is a gap in the scan, and it must
   * never read as quietly fine.
   */
  status(status: string, text = status): string {
    switch (status) {
      case "violation":
        return this.apply("red", text);
      case "probable-violation":
      case "inconsistent":
      case "missing-disclosure":
        return this.apply("yellow", text);
      case "risk":
        return this.apply("brightYellow", text);
      case "manual-review":
        return this.apply("magenta", text);
      case "not-evaluated":
        return this.apply("brightYellow", text);
      case "pass":
        return this.apply("green", text);
      default:
        return this.apply("gray", text);
    }
  }
}

export interface Symbols {
  bullet: string;
  arrow: string;
  check: string;
  cross: string;
  warning: string;
  info: string;
  pointer: string;
  radioOn: string;
  radioOff: string;
  checkboxOn: string;
  checkboxOff: string;
  spinner: string[];
  lineH: string;
}

const UNICODE_SYMBOLS: Symbols = {
  bullet: "•",
  arrow: "→",
  check: "✓",
  cross: "✗",
  warning: "⚠",
  info: "ℹ",
  pointer: "❯",
  radioOn: "◉",
  radioOff: "◯",
  checkboxOn: "◼",
  checkboxOff: "◻",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  lineH: "─",
};

const ASCII_SYMBOLS: Symbols = {
  bullet: "-",
  arrow: "->",
  check: "+",
  cross: "x",
  warning: "!",
  info: "i",
  pointer: ">",
  radioOn: "(*)",
  radioOff: "( )",
  checkboxOn: "[x]",
  checkboxOff: "[ ]",
  spinner: ["|", "/", "-", "\\"],
  lineH: "-",
};

export function symbolsFor(capabilities: TerminalCapabilities): Symbols {
  return capabilities.unicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
}

/** Strips ANSI sequences, so width maths counts printable characters only. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Printable length of a possibly-styled string. */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/** Truncates to `max` printable characters, adding an ellipsis when it cuts. */
export function truncate(text: string, max: number, ellipsis = "..."): string {
  const plain = stripAnsi(text);
  if (plain.length <= max) return plain;
  if (max <= ellipsis.length) return plain.slice(0, Math.max(0, max));
  return `${plain.slice(0, max - ellipsis.length)}${ellipsis}`;
}

/** Pads to `width` printable characters, ignoring any styling already applied. */
export function padEnd(text: string, width: number): string {
  const deficit = width - visibleLength(text);
  return deficit > 0 ? `${text}${" ".repeat(deficit)}` : text;
}

/** Wraps text to `width`, breaking on spaces and preserving existing newlines. */
export function wrap(text: string, width: number, indent = ""): string[] {
  const usable = Math.max(1, width - indent.length);
  const output: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim().length === 0) {
      output.push(indent.trimEnd());
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= usable) {
        line += ` ${word}`;
      } else {
        output.push(`${indent}${line}`);
        line = word;
      }
    }
    if (line.length > 0) output.push(`${indent}${line}`);
  }
  return output;
}

export interface TableColumn {
  header: string;
  /** Maximum share of the available width, 0-1. Columns shrink proportionally. */
  maxShare?: number;
  align?: "left" | "right";
}

/**
 * Renders a fixed-width table that fits the terminal. Columns are sized to
 * their content, then shrunk proportionally when the total exceeds the
 * available width, so a long URL never pushes the severity column off screen.
 */
export function renderTable(
  columns: TableColumn[],
  rows: string[][],
  capabilities: TerminalCapabilities,
  styler: Styler
): string[] {
  if (rows.length === 0) return [];
  const gap = 2;
  const totalGap = gap * (columns.length - 1);
  const available = Math.max(MIN_WIDTH, capabilities.width - totalGap);

  const natural = columns.map((column, index) =>
    Math.max(visibleLength(column.header), ...rows.map((row) => visibleLength(row[index] ?? "")))
  );

  const widths = [...natural];
  let total = widths.reduce((sum, width) => sum + width, 0);

  // Caps only matter when the row does not fit. Applying `maxShare` to a
  // table that already fits would truncate content for no reason.
  if (total > available) {
    for (const [index, column] of columns.entries()) {
      if (column.maxShare === undefined) continue;
      const cap = Math.max(6, Math.floor(available * column.maxShare));
      if (widths[index] > cap) {
        total -= widths[index] - cap;
        widths[index] = cap;
      }
    }
    // Still too wide: shave the widest column one column at a time. Nothing
    // drops below 6 characters, which stays identifiable after truncation.
    for (let guard = 0; total > available && guard < 2000; guard += 1) {
      let widest = 0;
      for (let i = 1; i < widths.length; i += 1) {
        if (widths[i] > widths[widest]) widest = i;
      }
      if (widths[widest] <= 6) break;
      widths[widest] -= 1;
      total -= 1;
    }
  }

  const renderRow = (cells: string[], style?: (value: string) => string): string =>
    cells
      .map((cell, index) => {
        const clipped = truncate(cell ?? "", widths[index]);
        const padded =
          columns[index].align === "right"
            ? clipped.padStart(widths[index])
            : padEnd(clipped, widths[index]);
        return style ? style(padded) : padded;
      })
      .join(" ".repeat(gap))
      .trimEnd();

  const lines = [renderRow(columns.map((column) => column.header), styler.bold)];
  lines.push(styler.dim(symbolsFor(capabilities).lineH.repeat(Math.min(capabilities.width, total + totalGap))));
  for (const row of rows) lines.push(renderRow(row));
  return lines;
}

/** A horizontal rule sized to the terminal. */
export function rule(capabilities: TerminalCapabilities, styler: Styler, label?: string): string {
  const symbols = symbolsFor(capabilities);
  if (!label) return styler.dim(symbols.lineH.repeat(capabilities.width));
  const prefix = `${symbols.lineH.repeat(3)} ${label} `;
  const remaining = Math.max(0, capabilities.width - visibleLength(prefix));
  return styler.dim(`${prefix}${symbols.lineH.repeat(remaining)}`);
}
