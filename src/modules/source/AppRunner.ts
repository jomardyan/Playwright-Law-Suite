import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { SourceModeConfig } from "../../config/schema.js";
import type { FrameworkDetectionResult } from "./FrameworkDetector.js";
import { logger } from "../../utils/logger.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export interface StartedApplication {
  url: string;
  stop: () => Promise<void>;
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return true;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/** Serves repoPath as static files - no external dependency required for the static-html case. */
export function serveStaticDirectory(repoPath: string, port: number): StartedApplication {
  const server = createServer(async (req, res) => {
    try {
      const requestedPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const normalizedRoot = await realpath(repoPath);
      const resolved = normalize(join(normalizedRoot, requestedPath));
      // Boundary-aware containment check: a plain startsWith on the string would
      // treat a sibling directory like "<root>-internal" as being inside "<root>".
      const isContained = resolved === normalizedRoot || resolved.startsWith(normalizedRoot + sep);
      if (!isContained) throw new Error("Path outside source directory");
      let filePath = resolved;
      const info = await stat(filePath).catch(() => null);
      if (!info || info.isDirectory()) {
        filePath = join(filePath, "index.html");
      }
      // Resolve symlinks and junctions after selecting a directory index too.
      // Lexical containment alone allows a link in the repo to expose outside files.
      filePath = await realpath(filePath);
      if (filePath !== normalizedRoot && !filePath.startsWith(normalizedRoot + sep)) {
        throw new Error("Linked path outside source directory");
      }
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  // This temporary source server is for the local browser scanner only.
  server.listen(port, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function spawnCommand(command: string, cwd: string): ChildProcess {
  const [cmd, ...args] = command.split(" ");
  return spawn(cmd, args, { cwd, stdio: "pipe", shell: process.platform === "win32" });
}

/**
 * Starts the application locally so Playwright has something to point at.
 * Node-based frameworks are installed/started via their own scripts (never
 * hand-rolled); static HTML uses a minimal built-in static file server.
 * Returns null when the framework cannot be started automatically - callers
 * fall back to static-analysis-only in that case.
 */
export async function startApplication(
  repoPath: string,
  framework: FrameworkDetectionResult,
  sourceConfig: SourceModeConfig | undefined
): Promise<StartedApplication | null> {
  const port = sourceConfig?.portOverride ?? framework.defaultPort ?? 3000;
  const timeoutMs = sourceConfig?.startupTimeoutMs ?? 60_000;

  if (framework.name === "static-html") {
    const app = serveStaticDirectory(repoPath, port);
    const ready = await waitForServer(app.url, 10_000);
    if (!ready) {
      await app.stop();
      return null;
    }
    return app;
  }

  if (!framework.suggestedStartCommand) {
    logger.warn(`No known start command for framework '${framework.name}'; cannot start it automatically.`);
    return null;
  }

  if (sourceConfig?.allowInstall && framework.packageManager) {
    logger.info(`Installing dependencies with ${framework.packageManager} install ...`);
    await new Promise<void>((resolve, reject) => {
      const install = spawnCommand(`${framework.packageManager} install`, repoPath);
      install.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`install exited with code ${code}`))));
      install.on("error", reject);
    }).catch((error) => logger.warn("Dependency install failed", error));
  }

  const startCommand = sourceConfig?.startCommandOverride ?? framework.suggestedStartCommand;
  logger.info(`Starting application with: ${startCommand}`);
  const child = spawnCommand(startCommand, repoPath);
  child.stdout?.on("data", (chunk) => logger.debug(`[app stdout] ${chunk}`));
  child.stderr?.on("data", (chunk) => logger.debug(`[app stderr] ${chunk}`));

  const url = `http://localhost:${port}/`;
  const ready = await waitForServer(url, timeoutMs);
  if (!ready) {
    child.kill();
    return null;
  }

  return {
    url,
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
        setTimeout(resolve, 3000);
      }),
  };
}
