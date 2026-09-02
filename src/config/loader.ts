import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { load as parseYaml } from "js-yaml";
import { DEFAULT_CONFIG, type UniVerscanConfig } from "./schema.js";

function parseConfigFile(path: string): Partial<UniVerscanConfig> {
  const raw = readFileSync(path, "utf-8");
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    return parseYaml(raw) as Partial<UniVerscanConfig>;
  }
  return JSON.parse(raw) as Partial<UniVerscanConfig>;
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override as unknown as T) ?? base;
  }
  if (typeof base !== "object" || base === null || typeof override !== "object" || override === null) {
    return (override as T) ?? base;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] =
      typeof value === "object" && value !== null && !Array.isArray(value) && typeof baseValue === "object" && baseValue !== null
        ? deepMerge(baseValue, value as Partial<unknown>)
        : value;
  }
  return result as T;
}

/**
 * Rewrites relative `customRulesPaths` entries so they resolve against the
 * file that declared them. Without this a relative path reaches `import()`
 * unchanged and Node resolves it against the PackLoader module inside
 * `dist/`, which is never what the config author meant. Bare specifiers
 * (a package name such as `@acme/universcan-pack`) are left alone so a pack
 * can still be installed from a registry.
 */
function resolveCustomRulesPaths(config: Partial<UniVerscanConfig>, baseDir: string): void {
  if (!config.customRulesPaths) return;
  config.customRulesPaths = config.customRulesPaths.map((path) =>
    path.startsWith(".") ? resolve(baseDir, path) : path
  );
}

/**
 * Loads a UniVerscan config file, resolving `extends` chains so an
 * organization-wide baseline can be layered with jurisdiction/project
 * specifics. `extends` may point to another file path (relative to the
 * current file) or to a bundled profile name under config/profiles/.
 */
export function loadConfig(path: string): UniVerscanConfig {
  const visited = new Set<string>();

  function resolveExtendsPath(fromFile: string, ref: string): string {
    if (isAbsolute(ref) || ref.startsWith(".")) {
      return resolve(dirname(fromFile), ref);
    }
    const bundled = resolve(process.cwd(), "config", "profiles", `${ref}.json`);
    if (existsSync(bundled)) return bundled;
    return resolve(dirname(fromFile), ref);
  }

  function load(filePath: string): Partial<UniVerscanConfig> {
    const absolute = resolve(filePath);
    if (visited.has(absolute)) {
      throw new Error(`Circular config extends chain detected at: ${absolute}`);
    }
    visited.add(absolute);

    const parsed = parseConfigFile(absolute);
    resolveCustomRulesPaths(parsed, dirname(absolute));
    if (parsed.extends) {
      const parentPath = resolveExtendsPath(absolute, parsed.extends);
      const parent = load(parentPath);
      const { extends: _drop, ...own } = parsed;
      return deepMerge(parent, own);
    }
    return parsed;
  }

  const merged = load(path);
  return deepMerge(DEFAULT_CONFIG, merged);
}

/**
 * Builds a config from an in-memory object. Relative `customRulesPaths`
 * resolve against `baseDir`, which defaults to the current working
 * directory - the only sensible anchor when there is no config file.
 */
export function loadConfigFromObject(
  partial: Partial<UniVerscanConfig>,
  baseDir: string = process.cwd()
): UniVerscanConfig {
  const copy: Partial<UniVerscanConfig> = { ...partial };
  resolveCustomRulesPaths(copy, baseDir);
  return deepMerge(DEFAULT_CONFIG, copy);
}
