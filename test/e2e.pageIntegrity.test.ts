import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import { BrowserManager } from "../src/engine/BrowserManager.js";
import { assessPageIntegrity } from "../src/engine/PageIntegrity.js";
import { ScanEngine } from "../src/engine/ScanEngine.js";
import { loadConfigFromObject } from "../src/config/loader.js";

const CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const hasLocalChromium = existsSync(CHROMIUM_PATH);
if (hasLocalChromium && !process.env.UNIVERSCAN_CHROMIUM_PATH) {
  process.env.UNIVERSCAN_CHROMIUM_PATH = CHROMIUM_PATH;
}

/**
 * The interstitial lemonde.fr actually served, with HTTP 200, on three of
 * four scanned routes. Before it was recognised the scanner reported a
 * critical "no privacy notice" and a WCAG 2.4.7 violation against each one.
 */
const CHALLENGE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Client Challenge</title></head>
<body>
  <form action="/validateCaptcha" method="post">
    <p>Enter the characters seen in the image below:</p>
    <input name="answer">
  </form>
</body>
</html>`;

const CLOUDFLARE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Just a moment...</title></head>
<body><div id="challenge-running">Checking your browser before accessing the site.</div></body>
</html>`;

/** A localised challenge, recognised by its markup rather than its words. */
const LOCALISED_CHALLENGE_HTML = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>Sicherheitsprüfung</title></head>
<body><div id="px-captcha">Bitte bestätigen Sie, dass Sie ein Mensch sind.</div></body>
</html>`;

/** A real page, and a deliberately tiny one, both of which must survive. */
const REAL_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Shop</title></head>
<body>
  <main><h1>Shop</h1><p>Welcome.</p></main>
  <footer><a href="/privacy">Privacy</a> <a href="/contact">Contact</a></footer>
</body>
</html>`;

const TINY_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Example Domain</title></head>
<body><div><h1>Example Domain</h1><p>This domain is for use in illustrative examples.</p>
<p><a href="https://www.iana.org/domains/example">More information...</a></p></div></body>
</html>`;

/** An article that discusses captchas: wording alone must not condemn it. */
const ARTICLE_ABOUT_CAPTCHAS = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>How a captcha works</title></head>
<body>
  <main>
    <h1>How a captcha works</h1>
    <p>${"A captcha asks you to verify that you are human. ".repeat(60)}</p>
    <a href="/more">More</a>
  </main>
</body>
</html>`;

describe.skipIf(!hasLocalChromium)("page integrity", () => {
  let server: Server;
  let baseUrl: string;
  let browserManager: BrowserManager;
  let page: Page;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const body =
        path === "/challenge"
          ? CHALLENGE_HTML
          : path === "/cloudflare"
            ? CLOUDFLARE_HTML
            : path === "/localised"
              ? LOCALISED_CHALLENGE_HTML
              : path === "/tiny"
                ? TINY_HTML
                : path === "/captcha-article"
                  ? ARTICLE_ABOUT_CAPTCHAS
                  : REAL_HTML;
      // Deliberately 200: an interstitial that announced itself with a 4xx
      // would already have been excluded by the status check.
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browserManager = new BrowserManager({ engine: "chromium", headless: true });
    await browserManager.launch();
    page = await (await browserManager.newContext()).newPage();
  }, 60_000);

  afterAll(async () => {
    await browserManager?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const assess = async (path: string) => {
    await page.goto(`${baseUrl}${path}`);
    return assessPageIntegrity(page);
  };

  it("rejects a captcha wall served with HTTP 200", async () => {
    const result = await assess("/challenge");
    expect(result.isContent).toBe(false);
    expect(result.reason).toMatch(/captcha|challenge/i);
  });

  it("rejects a Cloudflare browser check", async () => {
    const result = await assess("/cloudflare");
    expect(result.isContent).toBe(false);
  });

  it("rejects a localised challenge by its markup rather than its wording", async () => {
    const result = await assess("/localised");
    expect(result.isContent).toBe(false);
    expect(result.reason).toMatch(/px-captcha/);
  });

  it("accepts an ordinary page", async () => {
    expect((await assess("/")).isContent).toBe(true);
  });

  it("accepts a deliberately minimal page", async () => {
    // example.com is a legitimate page with about 170 characters of text.
    // Rejecting on sparseness alone would discard it.
    expect((await assess("/tiny")).isContent).toBe(true);
  });

  it("accepts an article that merely talks about captchas", async () => {
    expect((await assess("/captcha-article")).isContent).toBe(true);
  });
});

describe.skipIf(!hasLocalChromium)("ScanEngine and interstitials", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/robots.txt") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        path === "/walled"
          ? CHALLENGE_HTML
          : `<!doctype html><html lang="en"><head><title>Home</title></head><body>
             <main><h1>Home</h1></main>
             <footer><a href="/walled">Archive</a><a href="/privacy">Privacy</a></footer>
             </body></html>`
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("records the walled route as unreachable instead of finding everything missing on it", async () => {
    const config = loadConfigFromObject({
      target: { url: baseUrl },
      jurisdictions: ["European Union"],
      crawl: { depth: 1, pageLimit: 5 },
      consent: { enabled: false },
      accessibility: { standard: "wcag22aa", includeInteractionChecks: false },
      reporting: { formats: [], outputDir: "/tmp/universcan-integrity-test" },
    });
    const report = await new ScanEngine().run(config);

    const walled = report.unreachablePages.find((p) => p.url.endsWith("/walled"));
    expect(walled, "the captcha page belongs in unreachablePages").toBeDefined();
    expect(walled?.reason).toMatch(/captcha|challenge|interstitial/i);

    // And nothing may be asserted about it.
    expect(report.findings.some((f) => f.affectedUrl?.endsWith("/walled") === true)).toBe(false);
  }, 120_000);
});
