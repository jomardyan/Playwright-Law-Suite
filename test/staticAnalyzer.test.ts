import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStaticAnalysis } from "../src/modules/source/StaticAnalyzer.js";

describe("runStaticAnalysis", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("detects tracking scripts, insecure references, and accessibility attribute gaps", async () => {
    dir = mkdtempSync(join(tmpdir(), "universcan-static-"));
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html>
<html>
<head><script src="http://insecure.example/lib.js"></script></head>
<body>
  <img src="hero.png">
  <script>gtag('config', 'G-XXXX');</script>
</body>
</html>`
    );

    const findings = await runStaticAnalysis(dir);
    const ruleIds = findings.map((f) => f.ruleId);

    expect(ruleIds).toContain("static-google-analytics-detected");
    expect(ruleIds).toContain("static-insecure-resource-reference");
    expect(ruleIds).toContain("static-missing-html-lang-attribute");
    expect(ruleIds).toContain("static-image-missing-alt-attribute");
    expect(ruleIds).toContain("static-no-privacy-policy-reference-found");

    for (const finding of findings) {
      expect(finding.automationLevel).toBe("evidence-only");
    }
  });

  it("does not flag a privacy policy reference as missing when one is present", async () => {
    dir = mkdtempSync(join(tmpdir(), "universcan-static-"));
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html lang="en"><body><a href="/privacy">Privacy Policy</a><img src="a.png" alt=""></body></html>`
    );

    const findings = await runStaticAnalysis(dir);
    expect(findings.map((f) => f.ruleId)).not.toContain("static-no-privacy-policy-reference-found");
  });
});
