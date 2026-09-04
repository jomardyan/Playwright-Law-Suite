import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import { BrowserManager } from "../src/engine/BrowserManager.js";
import { SiteDiscovery, canonicalizeRouteUrl } from "../src/engine/SiteDiscovery.js";
import { loadConfigFromObject } from "../src/config/loader.js";

const CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const hasLocalChromium = existsSync(CHROMIUM_PATH);
if (hasLocalChromium && !process.env.UNIVERSCAN_CHROMIUM_PATH) {
  process.env.UNIVERSCAN_CHROMIUM_PATH = CHROMIUM_PATH;
}

describe("canonicalizeRouteUrl", () => {
  it("drops the fragment, which never reaches the server", () => {
    expect(canonicalizeRouteUrl(new URL("https://example.com/a#section"))).toBe("https://example.com/a");
  });

  it("strips campaign parameters so one page is one route", () => {
    expect(canonicalizeRouteUrl(new URL("https://example.com/a?utm_source=x&gclid=y&id=7"))).toBe(
      "https://example.com/a?id=7"
    );
  });

  it("strips the site-internal referrer parameters publishers stamp on their own links", () => {
    // `/` and `/?iref=pc_gnavi` were two routes on a real scan: the same page
    // scanned twice, every per-page finding doubled, and a 403 for the second
    // request.
    expect(canonicalizeRouteUrl(new URL("https://example.com/?iref=pc_gnavi"))).toBe("https://example.com/");
    expect(canonicalizeRouteUrl(new URL("https://example.com/a?at_medium=RSS&at_campaign=KARANGA"))).toBe(
      "https://example.com/a"
    );
    expect(canonicalizeRouteUrl(new URL("https://example.com/b?ito=newsletter&smid=tw-share"))).toBe(
      "https://example.com/b"
    );
  });

  it("keeps parameters that might be the page's own identifier", () => {
    // Stripping `id`, `cid`, `src` or `from` would merge distinct pages into
    // one, which under-reports rather than over-reports.
    expect(canonicalizeRouteUrl(new URL("https://example.com/article?id=42"))).toContain("id=42");
    expect(canonicalizeRouteUrl(new URL("https://example.com/article?cid=42"))).toContain("cid=42");
  });

  it("orders the remaining query so two spellings of one URL collapse", () => {
    expect(canonicalizeRouteUrl(new URL("https://example.com/a?b=2&a=1"))).toBe(
      canonicalizeRouteUrl(new URL("https://example.com/a?a=1&b=2"))
    );
  });
});

const PAGES: Record<string, string> = {
  "/": `<h1>Home</h1>
    <a href="/about">About</a>
    <a href="/level1">Level one</a>
    <a href="/brochure.pdf">Brochure</a>
    <a href="/logo.png">Logo</a>
    <a href="/about#team">About, team section</a>
    <a href="/about?utm_source=newsletter">About, from the newsletter</a>
    <a href="https://other.example.test/x">Somewhere else</a>`,
  "/about": `<h1>About</h1><a href="/">Home</a>`,
  "/level1": `<h1>Level one</h1><a href="/level2">Level two</a>`,
  "/level2": `<h1>Level two</h1><a href="/level3">Level three</a>`,
  "/level3": `<h1>Level three</h1>`,
  "/account/privacy": `<h1>Privacy notice</h1>`,
};

describe.skipIf(!hasLocalChromium)("SiteDiscovery", () => {
  let server: Server;
  let baseUrl: string;
  let browserManager: BrowserManager;
  let page: Page;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/robots.txt") {
        res.writeHead(404).end();
        return;
      }
      if (path === "/sitemap.xml") {
        res.writeHead(200, { "Content-Type": "application/xml" });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>
           <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
             <sitemap><loc>${baseUrl}/sitemap-pages.xml</loc></sitemap>
           </sitemapindex>`
        );
        return;
      }
      if (path === "/sitemap-pages.xml") {
        res.writeHead(200, { "Content-Type": "application/xml" });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>
           <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
             <url><loc>${baseUrl}/account/privacy</loc></url>
           </urlset>`
        );
        return;
      }
      const body = PAGES[path];
      if (body === undefined) {
        res.writeHead(404, { "Content-Type": "text/html" }).end("<h1>Not found</h1>");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html lang="en"><head><title>${path}</title></head><body>${body}</body></html>`);
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

  const discover = (overrides: Record<string, unknown> = {}) =>
    new SiteDiscovery().discover(
      `${baseUrl}/`,
      page,
      loadConfigFromObject({ target: { url: `${baseUrl}/` }, crawl: { depth: 1, pageLimit: 50, ...overrides } })
    );

  it("follows a sitemap index into the sitemaps it points at", async () => {
    // Large sites publish an index almost exclusively; reading it as an empty
    // urlset silently reduced discovery to a crawl of the homepage.
    const routes = await discover();
    expect(routes.map((r) => r.url)).toContain(`${baseUrl}/account/privacy`);
    expect(routes.find((r) => r.url.endsWith("/account/privacy"))?.source).toBe("sitemap");
  });

  it("scores a path by the most significant journey it matches", async () => {
    const routes = await discover();
    // `/account/privacy` matches both `account` and `privacy`; the notice is
    // what a truncated scan must not lose.
    expect(routes.find((r) => r.url.endsWith("/account/privacy"))?.label).toBe("privacy-policy");
  });

  it("does not hand non-page files to the scanner", async () => {
    const routes = await discover();
    expect(routes.some((r) => r.url.endsWith(".pdf"))).toBe(false);
    expect(routes.some((r) => r.url.endsWith(".png"))).toBe(false);
  });

  it("collapses fragment and campaign variants of one page into one route", async () => {
    const routes = await discover();
    const aboutRoutes = routes.filter((r) => r.url.includes("/about"));
    expect(aboutRoutes).toHaveLength(1);
    expect(aboutRoutes[0].url).toBe(`${baseUrl}/about`);
  });

  it("stays on the target's own origin", async () => {
    const routes = await discover();
    expect(routes.every((r) => r.url.startsWith(baseUrl))).toBe(true);
  });

  it("follows links to the configured depth", async () => {
    // depth 1 reaches only what the homepage links to.
    const shallow = await discover({ depth: 1 });
    expect(shallow.map((r) => r.url)).toContain(`${baseUrl}/level1`);
    expect(shallow.map((r) => r.url)).not.toContain(`${baseUrl}/level2`);

    // depth 3 walks the chain the config asked for; before this, the setting
    // was documented but never read, and every crawl stopped at one level.
    const deep = await discover({ depth: 3 });
    expect(deep.map((r) => r.url)).toContain(`${baseUrl}/level2`);
    expect(deep.map((r) => r.url)).toContain(`${baseUrl}/level3`);
  }, 60_000);

  it("never returns more routes than the page limit allows", async () => {
    const routes = await discover({ depth: 3, pageLimit: 3 });
    expect(routes.length).toBeLessThanOrEqual(3);
    // The homepage outranks everything, so a truncated scan still starts there.
    expect(routes[0].label).toBe("home");
  }, 60_000);
});
