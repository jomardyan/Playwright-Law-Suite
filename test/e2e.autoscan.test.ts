import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScanEngine } from "../src/engine/ScanEngine.js";
import { detectScope } from "../src/engine/AutoScan.js";
import { loadConfigFromObject } from "../src/config/loader.js";

const CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const hasLocalChromium = existsSync(CHROMIUM_PATH);
if (hasLocalChromium && !process.env.UNIVERSCAN_CHROMIUM_PATH) {
  process.env.UNIVERSCAN_CHROMIUM_PATH = CHROMIUM_PATH;
}

/** A shop that declares an EU/UK audience several different ways. */
const EU_HOME = `<!doctype html>
<html lang="de-DE">
<head>
  <meta charset="utf-8"><title>Beispiel Shop</title>
  <link rel="alternate" hreflang="de-DE" href="/de" />
  <link rel="alternate" hreflang="fr-FR" href="/fr" />
  <link rel="alternate" hreflang="en-GB" href="/uk" />
  <link rel="alternate" hreflang="x-default" href="/" />
</head>
<body>
  <h1>Beispiel Shop</h1>
  <p>Preis: 49,99 &euro; - inkl. MwSt.</p>
  <button>Add to cart</button>
  <a href="/checkout">Proceed to checkout</a>
  <a href="/impressum">Impressum</a>
  <a href="/privacy">Datenschutz</a>
</body>
</html>`;

const EU_PRIVACY = `<!doctype html>
<html lang="de-DE"><head><meta charset="utf-8"><title>Datenschutz</title></head>
<body><h1>Datenschutz</h1><p>Wir verarbeiten Daten nach der DSGVO (GDPR).</p></body></html>`;

/** A page with nothing that identifies a market. */
const NEUTRAL_HOME = `<!doctype html>
<html><head><meta charset="utf-8"><title>Internal Tool</title></head>
<body><h1>Internal Tool</h1><p>Status dashboard.</p></body></html>`;

describe.skipIf(!hasLocalChromium)("autoscan end-to-end", () => {
  let server: Server;
  let baseUrl: string;
  let mode: "eu" | "neutral" = "eu";

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (mode === "neutral") {
        if (path !== "/") {
          res.writeHead(404, { "Content-Type": "text/html" });
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(NEUTRAL_HOME);
        return;
      }
      if (path === "/privacy") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(EU_PRIVACY);
        return;
      }
      if (path === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(EU_HOME);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("infers EU and UK from hreflang, currency, Impressum, and a named regulation", async () => {
    mode = "eu";
    const { detection, config } = await detectScope(
      loadConfigFromObject({ target: { url: baseUrl }, reporting: { formats: [], outputDir: mkdtempSync(join(tmpdir(), "as-")) } })
    );

    expect(detection.jurisdictions).toContain("European Union");
    expect(detection.inconclusive).toBe(false);

    const eu = detection.selected.find((m) => m.jurisdiction === "European Union");
    expect(eu?.confidence).toBe("high");
    const kinds = eu!.evidence.map((s) => s.kind);
    expect(kinds).toContain("hreflang");
    expect(kinds).toContain("currency");
    expect(kinds).toContain("legal-document"); // the Impressum link
    expect(kinds).toContain("regulation-mention"); // DSGVO/GDPR on /privacy

    // en-GB is a single hreflang, which clears the bar on its own.
    expect(detection.jurisdictions).toContain("United Kingdom");

    // Cart and checkout language identifies the sector.
    expect(config.businessSector).toBe("e-commerce");
  }, 120_000);

  it("scans against the inferred scope and records it on the report", async () => {
    mode = "eu";
    const report = await new ScanEngine().runAuto(
      loadConfigFromObject({
        target: { url: baseUrl },
        crawl: { depth: 1, pageLimit: 3, respectRobotsTxt: false },
        consent: { enabled: false },
        reporting: { formats: [], outputDir: mkdtempSync(join(tmpdir(), "as-")) },
      })
    );

    expect(report.meta.scopeDetection).toBeDefined();
    expect(report.meta.jurisdictions).toContain("European Union");

    // The packs the inferred scope names actually ran.
    const packIds = report.meta.packs.map((p) => p.id);
    expect(packIds).toContain("eu-gdpr-eprivacy");
    expect(packIds).toContain("uk-gdpr-pecr");
    expect(packIds).toContain("eu-accessibility-act"); // sector-gated, needs e-commerce
    expect(report.findings.length).toBeGreaterThan(0);
  }, 180_000);

  it("reports inconclusive rather than guessing when a site exposes no market signal", async () => {
    mode = "neutral";
    const { detection, config } = await detectScope(
      loadConfigFromObject({ target: { url: baseUrl }, reporting: { formats: [], outputDir: mkdtempSync(join(tmpdir(), "as-")) } })
    );

    expect(detection.inconclusive).toBe(true);
    expect(detection.jurisdictions).toEqual([]);
    expect(config.jurisdictions).toEqual([]);
    expect(detection.notes.join(" ")).toContain("unscanned market is an unknown");
  }, 120_000);

  it("never overrides an explicitly supplied scope", async () => {
    mode = "eu";
    const { detection, config } = await detectScope(
      loadConfigFromObject({
        target: { url: baseUrl },
        jurisdictions: ["Japan"],
        businessSector: "banking",
        reporting: { formats: [], outputDir: mkdtempSync(join(tmpdir(), "as-")) },
      })
    );

    // Detection still runs and is reported, but the caller's decision stands.
    expect(config.jurisdictions).toEqual(["Japan"]);
    expect(config.businessSector).toBe("banking");
    expect(detection.jurisdictions).toContain("European Union");
    expect(detection.notes.join(" ")).toContain("recorded but not applied");
    expect(detection.notes.join(" ")).toContain("The supplied value was used");
  }, 120_000);
});
