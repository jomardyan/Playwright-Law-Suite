import { XMLParser } from "fast-xml-parser";
import type { Page } from "playwright";
import type { UniVerscanConfig } from "../config/schema.js";
import type { DiscoveredRoute } from "./types.js";
import { logger } from "../utils/logger.js";
import { EMPTY_ROBOTS, fetchRobotsTxt, isAllowedByRobots, type RobotsRules, type TextFetcher } from "../utils/robots.js";

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

/**
 * Routes an auxiliary fetch through the browser context, so it inherits the
 * proxy, custom CA, and any TLS setting the scan was configured with.
 */
function browserTextFetcher(page: Page): TextFetcher {
  return async (url) => {
    const response = await page.request.get(url, { timeout: 8000, failOnStatusCode: false });
    return { ok: response.ok(), body: await response.text() };
  };
}

async function tryLoadSitemap(
  fetcher: TextFetcher,
  baseUrl: string,
  sitemapUrl = new URL("/sitemap.xml", baseUrl).toString()
): Promise<string[]> {
  try {
    const response = await fetcher(sitemapUrl);
    if (!response?.ok) return [];
    const xml = response.body;
    const parser = new XMLParser();
    const parsed = parser.parse(xml) as { urlset?: { url?: Array<{ loc: string }> | { loc: string } } };
    const urls = parsed.urlset?.url;
    if (!urls) return [];
    const list = Array.isArray(urls) ? urls : [urls];
    return list.map((entry) => entry.loc).filter((loc): loc is string => typeof loc === "string");
  } catch (error) {
    logger.debug(`Sitemap ${sitemapUrl} not available or unparsable`, error);
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
    let robotsBlocked = 0;

    const fetcher = browserTextFetcher(page);
    const robots: RobotsRules =
      config.crawl.respectRobotsTxt === false ? EMPTY_ROBOTS : await fetchRobotsTxt(baseUrl, fetcher);
    if (robots.loaded) {
      logger.info(`robots.txt loaded: ${robots.disallow.length} disallow rule(s) apply to UniVerscan`);
    }

    const addRoute = (url: string, source: DiscoveredRoute["source"]) => {
      try {
        const parsed = new URL(url, baseUrl);
        if (parsed.origin !== origin) return;
        if (isExcluded(parsed.pathname, config)) return;
        // robots.txt rules are matched against the path *and* query string:
        // rules such as "Disallow: /search?*" are common and only work when
        // the query is included.
        if (!isAllowedByRobots(`${parsed.pathname}${parsed.search}`, robots)) {
          robotsBlocked += 1;
          return;
        }
        const key = parsed.toString();
        if (routes.has(key)) return;
        const { priority, label } = scoreRoute(parsed.pathname);
        routes.set(key, { url: key, label, priority, source });
      } catch {
        // ignore malformed URLs
      }
    };

    addRoute(baseUrl, "config");

    const sitemapSources = robots.sitemaps.length > 0 ? robots.sitemaps : [new URL("/sitemap.xml", baseUrl).toString()];
    for (const sitemapUrl of sitemapSources) {
      for (const url of await tryLoadSitemap(fetcher, baseUrl, sitemapUrl)) addRoute(url, "sitemap");
    }

    if (routes.size < config.crawl.pageLimit) {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      const links = await page
        .locator("a[href]")
        .evaluateAll((elements) => elements.map((el) => (el as HTMLAnchorElement).href))
        .catch(() => [] as string[]);
      for (const link of links) addRoute(link, "link-crawl");
    }

    if (robotsBlocked > 0) {
      // Surfaced rather than silent: pages excluded here are simply not
      // scanned, and an unscanned page must never be read as a compliant one.
      logger.warn(
        `${robotsBlocked} discovered URL(s) were skipped because robots.txt disallows them. Those pages are unscanned, not compliant.`
      );
    }

    const sorted = Array.from(routes.values()).sort((a, b) => b.priority - a.priority);
    return sorted.slice(0, config.crawl.pageLimit);
  }
}
