import { stderr } from "node:process";
import { Styler, symbolsFor, truncate, type TerminalCapabilities } from "./terminal.js";
import type { ScanProgress } from "../engine/types.js";

/**
 * Live scan progress.
 *
 * Progress is written to **stderr**, never stdout: a report piped to a file
 * or another process must not have a spinner interleaved through it. On a
 * non-TTY the spinner is replaced by one plain line per step, which is what
 * a CI log actually wants.
 */
export type ProgressReporter = ScanProgress;

/** A reporter that emits nothing. Used when output is suppressed. */
export const silentProgress: ProgressReporter = {
  start: () => undefined,
  step: () => undefined,
  finish: () => undefined,
  warn: () => undefined,
  stop: () => undefined,
};

class PlainProgress implements ProgressReporter {
  private phase = "";
  private completed = 0;
  private total: number | undefined;

  constructor(private readonly styler: Styler, private readonly capabilities: TerminalCapabilities) {}

  start(phase: string, total?: number): void {
    this.phase = phase;
    this.completed = 0;
    this.total = total;
    stderr.write(`${this.styler.dim("[universcan]")} ${phase}${total ? ` (${total} step(s))` : ""}\n`);
  }

  step(label: string): void {
    this.completed += 1;
    const counter = this.total ? `[${this.completed}/${this.total}] ` : "";
    stderr.write(
      `${this.styler.dim("[universcan]")} ${counter}${truncate(label, Math.max(20, this.capabilities.width - 20))}\n`
    );
  }

  finish(summary?: string): void {
    if (summary) stderr.write(`${this.styler.dim("[universcan]")} ${this.phase}: ${summary}\n`);
  }

  warn(message: string): void {
    stderr.write(`${this.styler.dim("[universcan:warn]")} ${message}\n`);
  }

  stop(): void {
    // Nothing to tear down.
  }
}

class SpinnerProgress implements ProgressReporter {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private phase = "";
  private detail = "";
  private completed = 0;
  private total: number | undefined;
  private lineOpen = false;

  constructor(private readonly styler: Styler, private readonly capabilities: TerminalCapabilities) {}

  private get symbols() {
    return symbolsFor(this.capabilities);
  }

  private clearLine(): void {
    if (!this.lineOpen) return;
    stderr.write("\r\u001b[2K");
    this.lineOpen = false;
  }

  private render(): void {
    const spinner = this.symbols.spinner[this.frame % this.symbols.spinner.length];
    const counter = this.total ? this.styler.dim(`[${this.completed}/${this.total}] `) : "";
    const prefix = `${this.styler.cyan(spinner)} ${this.phase} ${counter}`;
    // Keep one column spare so a full-width line does not wrap and leave a
    // stray row behind when it is cleared.
    const room = Math.max(10, this.capabilities.width - 1 - this.phase.length - 12);
    const line = `${prefix}${this.styler.dim(truncate(this.detail, room))}`;
    stderr.write(`\r\u001b[2K${line}`);
    this.lineOpen = true;
  }

  start(phase: string, total?: number): void {
    this.stop();
    this.phase = phase;
    this.detail = "";
    this.completed = 0;
    this.total = total;
    this.frame = 0;
    this.render();
    this.timer = setInterval(() => {
      this.frame += 1;
      this.render();
    }, 90);
    // A spinner must never hold the event loop open on its own.
    this.timer.unref?.();
  }

  step(label: string): void {
    this.completed += 1;
    this.detail = label;
    this.render();
  }

  finish(summary?: string): void {
    this.stop();
    if (summary) {
      stderr.write(`${this.styler.green(this.symbols.check)} ${this.phase}: ${summary}\n`);
    }
  }

  warn(message: string): void {
    this.clearLine();
    stderr.write(`${this.styler.yellow(this.symbols.warning)} ${message}\n`);
    if (this.timer) this.render();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearLine();
  }
}

/**
 * Builds the right reporter for the terminal: an animated spinner on a TTY,
 * one line per step everywhere else.
 */
export function createProgressReporter(
  capabilities: TerminalCapabilities,
  options: { quiet?: boolean } = {}
): ProgressReporter {
  if (options.quiet) return silentProgress;
  const styler = new Styler(capabilities);
  // The spinner needs a TTY on stderr specifically - stdout being a terminal
  // says nothing about where progress is going.
  const animated = capabilities.color && Boolean(stderr.isTTY);
  return animated ? new SpinnerProgress(styler, capabilities) : new PlainProgress(styler, capabilities);
}
