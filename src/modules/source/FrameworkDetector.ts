import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { existsAnyFile } from "../../utils/walkFiles.js";

export type FrameworkName =
  | "next"
  | "react"
  | "vue"
  | "nuxt"
  | "angular"
  | "svelte"
  | "gatsby"
  | "wordpress"
  | "woocommerce"
  | "php"
  | "aspnet"
  | "static-html"
  | "unknown";

export interface FrameworkDetectionResult {
  name: FrameworkName;
  confidence: "high" | "medium" | "low";
  packageManager?: "npm" | "yarn" | "pnpm";
  suggestedStartCommand?: string;
  suggestedInstallCommand?: string;
  defaultPort?: number;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(repoPath: string): PackageJson | null {
  const path = join(repoPath, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
  } catch {
    return null;
  }
}

function detectPackageManager(repoPath: string): "npm" | "yarn" | "pnpm" {
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  return "npm";
}

function hasFileMatching(repoPath: string, suffixOrPredicate: string | ((relativePath: string) => boolean)): boolean {
  const predicate =
    typeof suffixOrPredicate === "string" ? (relativePath: string) => relativePath.endsWith(suffixOrPredicate) : suffixOrPredicate;
  return existsAnyFile(repoPath, predicate);
}

/**
 * Detects the application's technology so the AppRunner knows how to
 * install/build/start it, and so static analysis can apply
 * framework-appropriate file patterns. Node-based frameworks are detected
 * from package.json dependencies; non-Node stacks are detected from
 * characteristic files. Detection is heuristic - "unknown" with low
 * confidence is a valid, honest result.
 */
export async function detectFramework(repoPath: string): Promise<FrameworkDetectionResult> {
  const pkg = readPackageJson(repoPath);
  const packageManager = detectPackageManager(repoPath);

  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const has = (name: string) => Boolean(deps?.[name]);

    if (has("next")) {
      return { name: "next", confidence: "high", packageManager, suggestedStartCommand: pkg.scripts?.dev ? `${packageManager} run dev` : "npx next dev", defaultPort: 3000 };
    }
    if (has("nuxt") || has("nuxt3")) {
      return { name: "nuxt", confidence: "high", packageManager, suggestedStartCommand: `${packageManager} run dev`, defaultPort: 3000 };
    }
    if (has("gatsby")) {
      return { name: "gatsby", confidence: "high", packageManager, suggestedStartCommand: `${packageManager} run develop`, defaultPort: 8000 };
    }
    if (has("@angular/core")) {
      return { name: "angular", confidence: "high", packageManager, suggestedStartCommand: `${packageManager} run start`, defaultPort: 4200 };
    }
    if (has("vue")) {
      return { name: "vue", confidence: "high", packageManager, suggestedStartCommand: `${packageManager} run dev`, defaultPort: 5173 };
    }
    if (has("svelte")) {
      return { name: "svelte", confidence: "high", packageManager, suggestedStartCommand: `${packageManager} run dev`, defaultPort: 5173 };
    }
    if (has("react") || has("react-dom")) {
      return { name: "react", confidence: "medium", packageManager, suggestedStartCommand: `${packageManager} run start`, defaultPort: 3000 };
    }
    return {
      name: "unknown",
      confidence: "low",
      packageManager,
      suggestedStartCommand: pkg.scripts?.start ? `${packageManager} run start` : pkg.scripts?.dev ? `${packageManager} run dev` : undefined,
    };
  }

  if (existsSync(join(repoPath, "wp-content"))) {
    const isWoo = hasFileMatching(repoPath, (relativePath) => relativePath.includes(join("wp-content", "plugins", "woocommerce")));
    return { name: isWoo ? "woocommerce" : "wordpress", confidence: "high" };
  }
  if (hasFileMatching(repoPath, ".csproj")) {
    return { name: "aspnet", confidence: "high", suggestedStartCommand: "dotnet run", defaultPort: 5000 };
  }
  if (existsSync(join(repoPath, "composer.json"))) {
    return { name: "php", confidence: "medium", suggestedStartCommand: "php -S localhost:8080", defaultPort: 8080 };
  }
  if (hasFileMatching(repoPath, ".html")) {
    return { name: "static-html", confidence: "medium" };
  }

  return { name: "unknown", confidence: "low" };
}
