type Level = "info" | "warn" | "error" | "debug";

const PREFIX: Record<Level, string> = {
  info: "[universcan]",
  warn: "[universcan:warn]",
  error: "[universcan:error]",
  debug: "[universcan:debug]",
};

const DEBUG_ENABLED = process.env.UNIVERSCAN_DEBUG === "1" || process.env.UNIVERSCAN_DEBUG === "true";

function log(level: Level, message: string, ...rest: unknown[]): void {
  if (level === "debug" && !DEBUG_ENABLED) return;
  const line = `${PREFIX[level]} ${message}`;
  if (level === "error") {
    console.error(line, ...rest);
  } else if (level === "warn") {
    console.warn(line, ...rest);
  } else {
    console.log(line, ...rest);
  }
}

export const logger = {
  info: (message: string, ...rest: unknown[]) => log("info", message, ...rest),
  warn: (message: string, ...rest: unknown[]) => log("warn", message, ...rest),
  error: (message: string, ...rest: unknown[]) => log("error", message, ...rest),
  debug: (message: string, ...rest: unknown[]) => log("debug", message, ...rest),
};
