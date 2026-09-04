import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScanEngine } from "../src/engine/ScanEngine.js";
import { loadConfigFromObject } from "../src/config/loader.js";
import { writeReports } from "../src/reporters/index.js";
import { diffReports } from "../src/engine/ReportDiff.js";
import { hasLocalChromium } from "./chromium.js";

const HOME_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Subscription Shop</title></head>
<body>
  <h1>Subscription Shop</h1>
  <p>Your plan renews automatically every month until you cancel.</p>
  <p>Only 3 left in stock - hurry!</p>
  <div class="ai-assistant-widget" aria-label="Virtual assistant">Need help?</div>
  <a href="/pricing">Pricing plans</a>
  <a href="/admin/secret">Admin</a>
  <button id="place-order">Complete your order</button>
  <form action="/subscribe" method="post">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required />
    <button type="submit">Go</button>
  </form>
</body>
</html>`;

const ROBOTS_TXT = ["User-agent: *", "Disallow: /admin"].join("\n");

describe.skipIf(!hasLocalChromium)("ScanEngine end-to-end: enhanced signal collection", () => {
  let server: Server;
  let baseUrl: string;
  let gpcRequestSeen = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.headers["sec-gpc"] === "1") gpcRequestSeen = true;
      if (req.url === "/robots.txt") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(ROBOTS_TXT);
        return;
      }
      // One path answers 404 so the error-status case can be exercised; the
      // rest return the fixture, since the crawl follows links into them.
      if ((req.url ?? "").startsWith("/gone")) {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Not found</h1></body></html>");
        return;
      }
      // Deliberately omits every header the security pack looks for.
      res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "sessionid=abc123; Path=/" });
      res.end(HOME_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("collects security, consumer, AI, and GPC signals and honours robots.txt", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "universcan-e2e-"));
    const config = loadConfigFromObject({
      target: { url: baseUrl },
      jurisdictions: ["European Union", "United States - Colorado"],
      businessSector: "e-commerce",
      regulatoryPacks: ["global-data-security", "eu-consumer-rights", "eu-ai-act-transparency", "us-state-privacy"],
      crawl: { depth: 1, pageLimit: 5, respectRobotsTxt: true },
      consent: { enabled: true, testWithdrawal: false, probeGlobalPrivacyControl: true },
      reporting: { formats: ["json", "sarif", "markdown", "csv"], outputDir },
    });

    const report = await new ScanEngine().runLive(config);

    // robots.txt disallows /admin, so the linked admin page is never scanned.
    expect(report.coverage.pagesScanned).toBeGreaterThan(0);
    expect(report.findings.every((f) => !f.affectedUrl?.includes("/admin"))).toBe(true);

    // The GPC probe actually sent the Sec-GPC header to the server.
    expect(gpcRequestSeen).toBe(true);

    const ruleIds = new Set(report.findings.map((f) => f.ruleId));

    // Security: the fixture sends none of the expected headers, and its
    // session cookie is neither Secure nor HttpOnly.
    expect(ruleIds).toContain("security-response-headers");
    expect(ruleIds).toContain("security-cookie-attributes");

    // Consumer: "Complete your order" does not state the payment obligation.
    expect(ruleIds).toContain("crd-order-button-payment-obligation");
    // Consumer: urgency claim present on the page.
    expect(ruleIds).toContain("ucpd-dsa-manipulative-design-signals");

    // AI Act: a virtual-assistant widget with no disclosure text.
    expect(ruleIds).toContain("ai-act-interaction-disclosure");

    // Every finding still carries a legal reference and an automation level.
    for (const finding of report.findings) {
      expect(finding.legalReference, finding.ruleId).toBeTruthy();
      expect(finding.automationLevel, finding.ruleId).toBeTruthy();
    }

    // All four requested formats were written.
    const written = writeReports(report, config);
    expect(written).toHaveLength(4);
    const sarif = JSON.parse(readFileSync(join(outputDir, "report.sarif"), "utf-8"));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBe(report.findings.length);
    expect(readFileSync(join(outputDir, "report.md"), "utf-8")).toContain("UniVerscan compliance scan");
    expect(readFileSync(join(outputDir, "findings.csv"), "utf-8").split("\r\n")[0]).toContain('"ruleId"');
  }, 120_000);

  it("suppresses a finding through a documented exception without deleting it", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "universcan-e2e-except-"));
    const config = loadConfigFromObject({
      target: { url: baseUrl },
      jurisdictions: ["European Union"],
      businessSector: "e-commerce",
      regulatoryPacks: ["global-data-security"],
      crawl: { depth: 0, pageLimit: 1, respectRobotsTxt: false },
      consent: { enabled: false },
      ignoredFindings: [
        {
          ruleId: "security-response-headers",
          reason: "Headers are set at the CDN edge, which is not in front of this test origin.",
          approvedBy: "security@example.com",
        },
      ],
      reporting: { formats: [], outputDir },
    });

    const report = await new ScanEngine().runLive(config);

    expect(report.findings.some((f) => f.ruleId === "security-response-headers")).toBe(false);
    expect(report.suppressedFindings.some((s) => s.finding.ruleId === "security-response-headers")).toBe(true);
    expect(report.coverage.findingsSuppressedByException).toBeGreaterThan(0);
    expect(report.suppressedFindings[0].approvedBy).toBe("security@example.com");
  }, 120_000);

  it("produces a diff that identifies the suppressed finding as no longer reported", async () => {
    const base = loadConfigFromObject({
      target: { url: baseUrl },
      jurisdictions: ["European Union"],
      regulatoryPacks: ["global-data-security"],
      crawl: { depth: 0, pageLimit: 1, respectRobotsTxt: false },
      consent: { enabled: false },
      reporting: { formats: [], outputDir: mkdtempSync(join(tmpdir(), "universcan-e2e-diff-")) },
    });
    const engine = new ScanEngine();
    const before = await engine.runLive(base);
    const after = await engine.runLive({
      ...base,
      ignoredFindings: [{ ruleId: "security-response-headers", reason: "Accepted by the security owner." }],
    });

    const diff = diffReports(before, after);

    expect(diff.resolvedFindings.some((d) => d.finding.ruleId === "security-response-headers")).toBe(true);
    expect(diff.newFindings).toHaveLength(0);
  }, 180_000);

  it("reports an unreachable page as not-evaluated, never as a violation", async () => {
    // A page that never loaded has no content for a rule to reason about.
    // Handing it to the rules used to manufacture confirmed violations out
    // of a blank error document - "no privacy policy link found" on a page
    // that does not exist.
    const outputDir = mkdtempSync(join(tmpdir(), "universcan-unreachable-"));
    const config = loadConfigFromObject({
      // Port 1 is reserved and nothing listens on it, so navigation fails.
      target: { url: "http://127.0.0.1:1/" },
      jurisdictions: ["European Union"],
      regulatoryPacks: ["eu-gdpr-eprivacy", "global-data-security"],
      crawl: { depth: 0, pageLimit: 1, respectRobotsTxt: false },
      consent: { enabled: false },
      reporting: { formats: [], outputDir },
    });

    const report = await new ScanEngine().runLive(config);

    expect(report.coverage.pagesScanned).toBe(0);
    expect(report.coverage.pagesUnreachable).toBe(1);
    expect(report.unreachablePages).toHaveLength(1);
    expect(report.unreachablePages[0].url).toContain("127.0.0.1:1");

    // Nothing may be asserted about a site nobody could reach.
    const asserted = report.findings.filter((f) =>
      ["violation", "probable-violation", "risk", "missing-disclosure", "inconsistent"].includes(f.status)
    );
    expect(asserted).toEqual([]);
    expect(report.findings.every((f) => f.status === "not-evaluated" || f.status === "manual-review")).toBe(true);
    expect(report.coverage.rulesNotEvaluated).toBeGreaterThan(0);
  }, 120_000);

  it("skips a route that answers with an error status rather than scanning the error page", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "universcan-404-"));
    const config = loadConfigFromObject({
      target: { url: `${baseUrl}gone` },
      jurisdictions: ["European Union"],
      regulatoryPacks: ["eu-gdpr-eprivacy"],
      crawl: { depth: 0, pageLimit: 1, respectRobotsTxt: false },
      consent: { enabled: false },
      reporting: { formats: [], outputDir },
    });

    const report = await new ScanEngine().runLive(config);

    expect(report.coverage.pagesScanned).toBe(0);
    expect(report.unreachablePages[0].httpStatus).toBe(404);
    expect(report.unreachablePages[0].reason).toContain("404");
  }, 120_000);
});
