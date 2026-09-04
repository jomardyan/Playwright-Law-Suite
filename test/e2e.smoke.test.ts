import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ScanEngine } from "../src/engine/ScanEngine.js";
import { loadConfigFromObject } from "../src/config/loader.js";
import { hasLocalChromium } from "./chromium.js";

const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Fixture Site</title></head>
<body>
  <div id="cookie-banner">
    <span>We use cookies.</span>
    <button id="accept-all-button">Accept all</button>
  </div>
  <img src="hero.png">
  <form>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required />
    <label for="marketing">
      <input id="marketing" type="checkbox" checked /> Sign up for marketing emails
    </label>
    <button type="submit">Submit</button>
  </form>
</body>
</html>`;

describe.skipIf(!hasLocalChromium)("ScanEngine end-to-end smoke test (live mode)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("scans a fixture page and surfaces real findings across accessibility, consent, and privacy rules", async () => {
    const config = loadConfigFromObject({
      target: { url: baseUrl },
      jurisdictions: ["European Union"],
      regulatoryPacks: ["eu-gdpr-eprivacy", "wcag-accessibility"],
      crawl: { depth: 1, pageLimit: 1, respectRobotsTxt: false },
      consent: {
        enabled: true,
        testWithdrawal: false,
        acceptSelectors: ["#accept-all-button"],
        rejectSelectors: ["#reject-all-button-that-does-not-exist"],
      },
      reporting: { formats: [], outputDir: "./universcan-report-test" },
    });

    const report = await new ScanEngine().runLive(config);

    expect(report.coverage.pagesScanned).toBe(1);
    const ruleIds = report.findings.map((f) => f.ruleId);

    // WCAG: missing alt attribute should be caught by axe-core.
    expect(report.findings.some((f) => f.packId === "wcag-accessibility" && f.status === "violation")).toBe(true);

    // GDPR: accept-all is present, reject-all is not -> probable-violation.
    expect(ruleIds).toContain("gdpr-eprivacy-reject-control-present");

    // GDPR: no privacy policy link on the page -> missing-disclosure.
    expect(ruleIds).toContain("gdpr-privacy-policy-present");

    // GDPR: pre-checked marketing consent checkbox -> violation.
    const preCheckedFinding = report.findings.find((f) => f.ruleId === "gdpr-consent-checkbox-not-prechecked" && f.status === "violation");
    expect(preCheckedFinding).toBeDefined();

    expect(report.coverage.rulesEvaluated).toBeGreaterThan(0);
    expect(report.riskIndicators.scanCompleteness).toBeGreaterThan(0);
  }, 60_000);
});
