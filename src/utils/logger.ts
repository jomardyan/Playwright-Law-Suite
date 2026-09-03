import { stderr } from "node:process";

type Level = "info" | "warn" | "error" | "debug";

const PREFIX: Record<Level, string> = {
  info: "[universcan]",
  warn: "[universcan:warn]",
  error: "[universcan:error]",
  debug: "[universcan:debug]",
};

const DEBUG_ENABLED = process.env.UNIVERSCAN_DEBUG === "1" || process.env.UNIVERSCAN_DEBUG === "true";

/**
 * Diagnostics go to stderr, always - including info.
 *
 * stdout carries report content and nothing else, so
 * `universcan report --input r.json --format markdown > report.md` produces a
 * clean document rather than one with log lines embedded in it, and a
 * console report piped to `less` is not interleaved with progress chatter.
 */
function log(level: Level, message: string, ...rest: unknown[]): void {
  if (level === "debug" && !DEBUG_ENABLED) return;
  const line = `${PREFIX[level]} ${message}`;
  const extra = rest.length > 0 ? ` ${rest.map((value) => formatExtra(value)).join(" ")}` : "";
  stderr.write(`${line}${extra}\n`);
}

function formatExtra(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  info: (message: string, ...rest: unknown[]) => log("info", message, ...rest),
  warn: (message: string, ...rest: unknown[]) => log("warn", message, ...rest),
  error: (message: string, ...rest: unknown[]) => log("error", message, ...rest),
  debug: (message: string, ...rest: unknown[]) => log("debug", message, ...rest),
};
