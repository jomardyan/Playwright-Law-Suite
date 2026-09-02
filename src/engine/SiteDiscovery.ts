import { XMLParser } from "fast-xml-parser";
import type { Page } from "playwright";
import type { UniVerscanConfig } from "../config/schema.js";
import type { DiscoveredRoute } from "./types.js";
import { logger } from "../utils/logger.js";

const PRIORITY_KEYWORDS: Array<{ pattern: RegExp; priority: number; label: string }> = [
  { pattern: /^\/?$/, priority: 100, label: "home" },
  { pattern: /login|sign-?in/i, priority: 95, label: "login" },
  { pattern: /register|sign-?up|create-account/i, priority: 95, label: "registration" },
  { pattern: /checkout/i, priority: 95, label: "checkout" },
  { pattern: /payment|billing/i, priority: 90, label: "payment" },
  { pattern: /cart|basket/i, priority: 85, label: "cart" },
  { pattern: /account/i, priority: 80, label: "account" },
  { pattern: /cancel|unsubscribe/i, priority: 80, label: "cancellation" },
  { pattern: /subscri(be|ption)/i, priority: 75, label: "subscription" },
  { pattern: /privacy/i, priority: 90, label: "privacy-policy" },
  { pattern: /cookie/i, priority: 90, label: "cookie-policy" },
  { pattern: /terms|tos/i, priority: 85, label: "terms" },
  { pattern: /contact/i, priority: 60, label: "contact" },
  { pattern: /newsletter/i, priority: 60, label: "newsletter" },
];

function scoreRoute(pathname: string): { priority: number; label?: string } {
  for (const entry of PRIORITY_KEYWORDS) {
    if (entry.pattern.test(pathname)) return { priority: entry.priority, label: entry.label };
  }
  return { priority: 40 };
}

async function tryLoadSitemap(baseUrl: string): Promise<string[]> {
  try {
    const sitemapUrl = new URL("/sitemap.xml", baseUrl).toString();
    const response = await fetch(sitemapUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const xml = await response.text();
    const parser = new XMLParser();
    const parsed = parser.parse(xml) as { urlset?: { url?: Array<{ loc: string }> | { loc: string } } };
    const urls = parsed.urlset?.url;
    if (!urls) return [];
    const list = Array.isArray(urls) ? urls : [urls];
    return list.map((entry) => entry.loc).filter((loc): loc is string => typeof loc === "string");
  } catch (error) {
    logger.debug("sitemap.xml not available or unparsable", error);
    return [];
  }
}

function isExcluded(pathname: string, config: UniVerscanConfig): boolean {
  if (config.crawl.includedRoutes && config.crawl.includedRoutes.length > 0) {
    return !config.crawl.includedRoutes.some((pattern) => new RegExp(pattern).test(pathname));
  }
  if (config.crawl.excludedRoutes) {
    return config.crawl.excludedRoutes.some((pattern) => new RegExp(pattern).test(pathname));
  }
  return false;
}

/**
 * Discovers routes worth scanning: sitemap.xml first, falling back to a
 * same-origin link crawl seeded from the homepage, bounded by
 * config.crawl.depth / pageLimit. Discovered routes are ranked so legally
 * significant journeys (checkout, login, privacy policy, ...) are scanned
 * even when the page limit truncates a large site.
 */
export class SiteDiscovery {
  async discover(baseUrl: string, page: Page, config: UniVerscanConfig): Promise<DiscoveredRoute[]> {
    const origin = new URL(baseUrl).origin;
    const routes = new Map<string, DiscoveredRoute>();

    const addRoute = (url: string, source: DiscoveredRoute["source"]) => {
      try {
        const parsed = new URL(url, baseUrl);
        if (parsed.origin !== origin) return;
        if (isExcluded(parsed.pathname, config)) return;
        const key = parsed.toString();
        if (routes.has(key)) return;
        const { priority, label } = scoreRoute(parsed.pathname);
        routes.set(key, { url: key, label, priority, source });
      } catch {
        // ignore malformed URLs
      }
    };

    addRoute(baseUrl, "config");

    const sitemapUrls = await tryLoadSitemap(baseUrl);
    for (const url of sitemapUrls) addRoute(url, "sitemap");

    if (routes.size < config.crawl.pageLimit) {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      const links = await page
        .locator("a[href]")
        .evaluateAll((elements) => elements.map((el) => (el as HTMLAnchorElement).href))
        .catch(() => [] as string[]);
      for (const link of links) addRoute(link, "link-crawl");
    }

    const sorted = Array.from(routes.values()).sort((a, b) => b.priority - a.priority);
    return sorted.slice(0, config.crawl.pageLimit);
  }
}
