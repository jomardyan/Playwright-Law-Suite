import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "universcan-report",
  ".turbo",
  ".cache",
]);

export interface WalkOptions {
  ignoredDirs?: Set<string>;
  maxFiles?: number;
  extensions?: string[];
}

/**
 * Recursively lists files under root, skipping common build/dependency
 * directories. Used instead of Node's experimental fs.promises.glob so this
 * runs on any Node 18+ runtime.
 */
export function walkFiles(root: string, options: WalkOptions = {}): string[] {
  const ignored = options.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
  const maxFiles = options.maxFiles ?? 5000;
  const results: string[] = [];

  function visit(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.startsWith(".") && entry !== ".env") continue;
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (ignored.has(entry)) continue;
        visit(fullPath);
      } else if (stat.isFile()) {
        if (!options.extensions || options.extensions.some((ext) => entry.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  }

  visit(root);
  return results;
}

export function existsAnyFile(root: string, predicate: (relativePath: string) => boolean): boolean {
  const files = walkFiles(root, { maxFiles: 2000 });
  return files.some((file) => predicate(file.slice(root.length + 1)));
}
