import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadConfigFromObject } from "../src/config/loader.js";

describe("loadConfigFromObject", () => {
  it("merges a partial config over the defaults", () => {
    const config = loadConfigFromObject({ target: { url: "https://example.com" }, jurisdictions: ["European Union"] });
    expect(config.target.url).toBe("https://example.com");
    expect(config.jurisdictions).toEqual(["European Union"]);
    expect(config.accessibility.standard).toBe("wcag22aa"); // from DEFAULT_CONFIG
  });
});

describe("loadConfig with extends", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a relative extends chain and lets the child override scalar and object fields", () => {
    dir = mkdtempSync(join(tmpdir(), "universcan-config-"));
    const basePath = join(dir, "base.json");
    const childPath = join(dir, "child.json");

    writeFileSync(
      basePath,
      JSON.stringify({
        jurisdictions: ["European Union"],
        accessibility: { standard: "wcag22aa", includeInteractionChecks: true },
        crawl: { depth: 2, pageLimit: 25 },
      })
    );
    writeFileSync(
      childPath,
      JSON.stringify({
        extends: "./base.json",
        target: { url: "https://example.com" },
        crawl: { depth: 5 },
      })
    );

    const config = loadConfig(childPath);
    expect(config.target.url).toBe("https://example.com");
    expect(config.jurisdictions).toEqual(["European Union"]); // inherited from base
    expect(config.crawl.depth).toBe(5); // overridden by child
    expect(config.crawl.pageLimit).toBe(25); // inherited from base, not overwritten
  });

  it("detects circular extends chains", () => {
    dir = mkdtempSync(join(tmpdir(), "universcan-config-"));
    const aPath = join(dir, "a.json");
    const bPath = join(dir, "b.json");
    writeFileSync(aPath, JSON.stringify({ extends: "./b.json" }));
    writeFileSync(bPath, JSON.stringify({ extends: "./a.json" }));
    expect(() => loadConfig(aPath)).toThrow(/Circular config extends chain/);
  });
});

describe("customRulesPaths resolution", () => {
  it("resolves a relative custom pack path against the config file that declared it", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-custom-"));
    const configPath = join(dir, "scan.json");
    writeFileSync(
      configPath,
      JSON.stringify({ jurisdictions: ["European Union"], customRulesPaths: ["./packs/acme.mjs"] }),
      "utf-8"
    );

    const config = loadConfig(configPath);

    // Without this, the bare "./packs/acme.mjs" reaches import() and Node
    // resolves it against dist/packs/, which no config author intends.
    expect(config.customRulesPaths).toEqual([join(dir, "packs", "acme.mjs")]);
  });

  it("leaves a bare package specifier alone so a pack can be installed from a registry", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-custom-"));
    const configPath = join(dir, "scan.json");
    writeFileSync(configPath, JSON.stringify({ customRulesPaths: ["@acme/universcan-pack"] }), "utf-8");

    expect(loadConfig(configPath).customRulesPaths).toEqual(["@acme/universcan-pack"]);
  });

  it("resolves a relative path against an explicit baseDir for programmatic use", () => {
    const config = loadConfigFromObject({ customRulesPaths: ["./rules/local.js"] }, "/srv/app");
    expect(config.customRulesPaths).toEqual([join("/srv/app", "rules", "local.js")]);
  });
});

describe("extends resolution", () => {
  it("resolves a bundled profile from the package, not the working directory", () => {
    // A config written into a user's project must be able to extend a
    // bundled profile from anywhere, not only from inside a clone of this
    // repository. Simulated by pointing cwd somewhere with no config/ dir.
    const dir = mkdtempSync(join(tmpdir(), "universcan-extends-"));
    const configPath = join(dir, "universcan.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ extends: "global-baseline", jurisdictions: ["European Union"] }),
      "utf-8"
    );

    const previousCwd = process.cwd();
    try {
      process.chdir(dir);
      const config = loadConfig(configPath);
      // Values that only exist in the bundled baseline.
      expect(config.accessibility.standard).toBe("wcag22aa");
      expect(config.crawl.respectRobotsTxt).toBe(true);
      expect(config.jurisdictions).toEqual(["European Union"]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("names every location it searched when an extends target is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-extends-"));
    const configPath = join(dir, "universcan.config.json");
    writeFileSync(configPath, JSON.stringify({ extends: "no-such-profile" }), "utf-8");

    expect(() => loadConfig(configPath)).toThrow(/extends 'no-such-profile'.*Looked in/s);
  });

  it("lets a sibling file shadow a bundled profile name", () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-extends-"));
    writeFileSync(join(dir, "house-baseline.json"), JSON.stringify({ crawl: { pageLimit: 7 } }), "utf-8");
    const configPath = join(dir, "universcan.config.json");
    writeFileSync(configPath, JSON.stringify({ extends: "./house-baseline.json" }), "utf-8");

    expect(loadConfig(configPath).crawl.pageLimit).toBe(7);
  });
});
