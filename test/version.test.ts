import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The version used to live hardcoded in src/cli.ts, separately from
 * package.json, and a release bump updated one without the other: the 0.5.0
 * package would have reported `--version 0.4.0`. These pin the single source
 * of truth so that cannot recur.
 */
describe("version reporting", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8")
  ) as { version: string };

  it("reports the version from package.json rather than a hardcoded copy", () => {
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const reported = execFileSync("npx", ["tsx", cli, "--version"], {
      encoding: "utf-8",
    }).trim();
    expect(reported).toBe(pkg.version);
  });

  it("keeps the version out of the CLI source, so there is nothing to drift", () => {
    const source = readFileSync(
      new URL("../src/cli.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toMatch(/\.version\(\s*"[0-9]+\.[0-9]+\.[0-9]+"/);
  });

  it("pins the same version in action.yml, which installs it from npm", () => {
    const action = readFileSync(
      new URL("../action.yml", import.meta.url),
      "utf-8"
    );
    const match = action.match(/version:[\s\S]*?default:\s*"([^"]+)"/);
    expect(match?.[1]).toBe(pkg.version);
  });
});
