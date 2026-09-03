import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { symbolsFor, Styler, wrap, type TerminalCapabilities } from "./terminal.js";

/**
 * Prompt primitives built on `node:readline/promises`.
 *
 * No prompt library: this tool's whole point is running unattended in CI,
 * and a dependency tree that exists only to draw a menu is weight every
 * pipeline pays for. Selection is numbered rather than arrow-key driven,
 * which needs no raw-mode handling and works over SSH, in a container, and
 * in every terminal emulator.
 */

/** Thrown when a prompt is reached with no way to answer it. */
export class NonInteractiveError extends Error {
  constructor(question: string) {
    super(
      `Cannot ask "${question}" - stdin is not an interactive terminal. Supply the value as a flag, or run with --yes to accept defaults.`
    );
    this.name = "NonInteractiveError";
  }
}

/** Thrown when the user aborts with Ctrl-D (end of input). */
export class PromptAbortedError extends Error {
  constructor() {
    super("Input ended before the prompt was answered.");
    this.name = "PromptAbortedError";
  }
}

export interface SelectChoice<T> {
  value: T;
  label: string;
  /** Optional second line shown under the label. */
  hint?: string;
}

/**
 * An interactive session. Holds one readline interface for the whole run so
 * prompts do not fight over stdin, and must be closed when finished.
 */
export class PromptSession {
  private readonly rl: Interface;
  private readonly styler: Styler;

  constructor(private readonly capabilities: TerminalCapabilities, private readonly assumeYes = false) {
    this.rl = createInterface({ input: stdin, output: stdout });
    this.styler = new Styler(capabilities);
    // Ctrl-C during a prompt should end the process, not surface as an
    // unhandled rejection from the pending question().
    this.rl.on("SIGINT", () => {
      stdout.write("\n");
      this.close();
      process.exit(130);
    });
  }

  close(): void {
    this.rl.close();
  }

  private get symbols() {
    return symbolsFor(this.capabilities);
  }

  private requireInteractive(question: string): void {
    if (!this.capabilities.interactive) throw new NonInteractiveError(question);
  }

  private async ask(prompt: string): Promise<string> {
    const answer = await this.rl.question(prompt);
    // readline resolves with "" on Ctrl-D as well as on an empty line; the
    // closed flag distinguishes a deliberate blank from end-of-input.
    if (answer === null || answer === undefined) throw new PromptAbortedError();
    return answer;
  }

  private heading(question: string): string {
    return `${this.styler.cyan(this.symbols.pointer)} ${this.styler.bold(question)}`;
  }

  /** Free-text input. Returns `defaultValue` on an empty line. */
  async text(question: string, options: { defaultValue?: string; validate?: (value: string) => string | null } = {}): Promise<string> {
    if (this.assumeYes && options.defaultValue !== undefined) return options.defaultValue;
    this.requireInteractive(question);

    for (;;) {
      const suffix = options.defaultValue ? this.styler.dim(` (${options.defaultValue})`) : "";
      const answer = (await this.ask(`${this.heading(question)}${suffix}\n  `)).trim();
      const value = answer.length > 0 ? answer : options.defaultValue ?? "";
      const problem = options.validate?.(value);
      if (problem) {
        stdout.write(`  ${this.styler.red(this.symbols.cross)} ${problem}\n`);
        continue;
      }
      return value;
    }
  }

  /** Yes/no. Returns `defaultValue` on an empty line, and under --yes. */
  async confirm(question: string, defaultValue = true): Promise<boolean> {
    if (this.assumeYes) return defaultValue;
    this.requireInteractive(question);

    const hint = defaultValue ? "Y/n" : "y/N";
    for (;;) {
      const answer = (await this.ask(`${this.heading(question)} ${this.styler.dim(`[${hint}]`)} `)).trim().toLowerCase();
      if (answer.length === 0) return defaultValue;
      if (/^(y|yes)$/.test(answer)) return true;
      if (/^(n|no)$/.test(answer)) return false;
      stdout.write(`  ${this.styler.red(this.symbols.cross)} Answer y or n.\n`);
    }
  }

  /** Single choice from a numbered list. */
  async select<T>(question: string, choices: SelectChoice<T>[], defaultIndex = 0): Promise<T> {
    if (choices.length === 0) throw new Error(`select("${question}") needs at least one choice`);
    if (this.assumeYes) return choices[defaultIndex].value;
    this.requireInteractive(question);

    stdout.write(`${this.heading(question)}\n`);
    for (const [index, choice] of choices.entries()) {
      const marker = index === defaultIndex ? this.symbols.radioOn : this.symbols.radioOff;
      stdout.write(`  ${this.styler.dim(String(index + 1).padStart(2))}. ${marker} ${choice.label}\n`);
      if (choice.hint) {
        for (const line of wrap(choice.hint, this.capabilities.width, "        ")) {
          stdout.write(`${this.styler.dim(line)}\n`);
        }
      }
    }

    for (;;) {
      const answer = (await this.ask(`  ${this.styler.dim(`1-${choices.length}`)} ${this.styler.dim(`(${defaultIndex + 1})`)}: `)).trim();
      if (answer.length === 0) return choices[defaultIndex].value;
      const index = Number.parseInt(answer, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < choices.length) return choices[index].value;
      stdout.write(`  ${this.styler.red(this.symbols.cross)} Enter a number between 1 and ${choices.length}.\n`);
    }
  }

  /**
   * Multiple choice from a numbered list. Accepts comma-separated numbers
   * and ranges ("1,3-5"), "all", or "none".
   */
  async multiSelect<T>(
    question: string,
    choices: SelectChoice<T>[],
    preselected: number[] = []
  ): Promise<T[]> {
    if (this.assumeYes) return preselected.map((index) => choices[index].value);
    this.requireInteractive(question);

    stdout.write(`${this.heading(question)}\n`);
    const preselectedSet = new Set(preselected);
    for (const [index, choice] of choices.entries()) {
      const marker = preselectedSet.has(index) ? this.symbols.checkboxOn : this.symbols.checkboxOff;
      stdout.write(`  ${this.styler.dim(String(index + 1).padStart(2))}. ${marker} ${choice.label}\n`);
      if (choice.hint) {
        for (const line of wrap(choice.hint, this.capabilities.width, "        ")) {
          stdout.write(`${this.styler.dim(line)}\n`);
        }
      }
    }
    stdout.write(
      `  ${this.styler.dim('numbers, ranges ("1,3-5"), "all", "none"; blank keeps the pre-selected set')}\n`
    );

    for (;;) {
      const answer = (await this.ask("  > ")).trim();
      if (answer.length === 0) return preselected.map((index) => choices[index].value);
      const parsed = parseSelection(answer, choices.length);
      if (parsed === null) {
        stdout.write(`  ${this.styler.red(this.symbols.cross)} Could not read that. Use numbers 1-${choices.length}, ranges, "all" or "none".\n`);
        continue;
      }
      return parsed.map((index) => choices[index].value);
    }
  }

  /** Prints a line through the same stream the prompts use. */
  write(line: string): void {
    stdout.write(`${line}\n`);
  }
}

/**
 * Parses a multi-select answer into zero-based indices. Returns null when
 * the input cannot be read, so the caller can re-ask rather than silently
 * acting on a misunderstanding.
 */
export function parseSelection(input: string, count: number): number[] | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "none") return [];
  if (normalized === "all") return Array.from({ length: count }, (_, index) => index);

  const selected = new Set<number>();
  for (const part of normalized.split(",")) {
    const token = part.trim();
    if (token.length === 0) continue;

    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number.parseInt(range[1], 10);
      const to = Number.parseInt(range[2], 10);
      if (from < 1 || to > count || from > to) return null;
      for (let value = from; value <= to; value += 1) selected.add(value - 1);
      continue;
    }

    if (!/^\d+$/.test(token)) return null;
    const value = Number.parseInt(token, 10);
    if (value < 1 || value > count) return null;
    selected.add(value - 1);
  }
  return Array.from(selected).sort((a, b) => a - b);
}
