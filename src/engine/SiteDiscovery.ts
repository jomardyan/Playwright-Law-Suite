import { XMLParser } from "fast-xml-parser";
import type { Page } from "playwright";
import type { UniVerscanConfig } from "../config/schema.js";
import type { DiscoveredRoute } from "./types.js";
import { logger } from "../utils/logger.js";
import { EMPTY_ROBOTS, fetchRobotsTxt, isAllowedByRobots, type RobotsRules, type TextFetcher } from "../utils/robots.js";

const PRIORITY_KEYWORDS: Array<{ pattern: RegExp; priority: number; label: string }> = [
  { pattern: /^\/?$/, priority: 100, label: "home" },
  { pattern: /login|sign-?in|anmelden|connexion|iniciar-sesion/i, priority: 95, label: "login" },
  { pattern: /register|sign-?up|create-account|registrieren|inscription|registro/i, priority: 95, label: "registration" },
  { pattern: /checkout|kasse|caisse|finalizar-compra/i, priority: 95, label: "checkout" },
  { pattern: /privacy|datenschutz|confidentialite|privacidad|privacidade|riservatezza|prywatnosc/i, priority: 90, label: "privacy-policy" },
  { pattern: /cookie/i, priority: 90, label: "cookie-policy" },
  { pattern: /payment|billing|zahlung|paiement|pago/i, priority: 90, label: "payment" },
  { pattern: /cart|basket|warenkorb|panier|carrito|carrello/i, priority: 85, label: "cart" },
  { pattern: /terms|tos\b|agb|conditions|voorwaarden|regulamin/i, priority: 85, label: "terms" },
  { pattern: /account|konto|compte|cuenta/i, priority: 80, label: "account" },
  { pattern: /cancel|unsubscribe|kuendigen|resilier|widerruf/i, priority: 80, label: "cancellation" },
  { pattern: /subscri(be|ption)|abonnement|abo\b/i, priority: 75, label: "subscription" },
  { pattern: /contact|kontakt|impressum|imprint/i, priority: 60, label: "contact" },
  { pattern: /newsletter/i, priority: 60, label: "newsletter" },
];

/**
 * Scores a path by the highest-priority journey it matches, not the first.
 *
 * `/account/privacy` matched `account` (80) because that pattern was listed
 * earlier, so the privacy notice on a large site could be dropped by the page
 * limit while a settings page was kept.
 */
function scoreRoute(pathname: string): { priority: number; label?: string } {
  let best: { priority: number; label?: string } = { priority: 40 };
  for (const entry of PRIORITY_KEYWORDS) {
    if (entry.pattern.test(pathname) && entry.priority > best.priority) {
      best = { priority: entry.priority, label: entry.label };
    }
  }
  return best;
}

/**
 * File extensions that are not pages. Handing a PDF or an image to the rule
 * engine produces a document with no links, no forms and no consent banner -
 * which reads as "this page has no privacy notice" rather than "this is not a
 * page".
 */
const NON_PAGE_EXTENSIONS =
  /\.(pdf|zip|gz|tar|rar|7z|docx?|xlsx?|pptx?|csv|rtf|txt|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp[34]|m4[av]|wav|ogg|webm|mov|avi|mkv|woff2?|ttf|otf|eot|css|js|mjs|json|xml|rss|atom|apk|dmg|exe|pkg)$/i;

/**
 * Query parameters that identify a campaign, not a page. Left in place they
 * turn one page into a dozen routes, each consuming a slot in the page limit
 * that a genuinely different page needed.
 */
const TRACKING_PARAMS =
  /^(utm_[a-z_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|ttclid|twclid|igshid|mc_[ce]id|_hs[a-z]*|yclid|s_kwcid|ref|referrer|source|campaign)$/i;

/**
 * Normalises a URL so two links to the same page become one route: the
 * fragment is dropped (it never reaches the server), tracking parameters are
 * stripped, and the remaining query is ordered.
 */
export function canonicalizeRouteUrl(url: URL): string {
  const canonical = new URL(url.toString());
  canonical.hash = "";
  const kept = Array.from(canonical.searchParams.entries())
    .filter(([name]) => !TRACKING_PARAMS.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  canonical.search = "";
  for (const [name, value] of kept) canonical.searchParams.append(name, value);
  return canonical.toString();
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

interface SitemapResult {
  urls: string[];
  /** Child sitemaps declared by a `<sitemapindex>`. */
  children: string[];
}

/**
 * Reads a sitemap, handling both a `<urlset>` of pages and a `<sitemapindex>`
 * pointing at further sitemaps. Large sites publish the second kind almost
 * exclusively; treating it as an empty urlset meant discovery silently fell
 * back to crawling links from the homepage.
 */
async function tryLoadSitemap(fetcher: TextFetcher, sitemapUrl: string): Promise<SitemapResult> {
  try {
    const response = await fetcher(sitemapUrl);
    if (!response?.ok) return { urls: [], children: [] };
    const parser = new XMLParser();
    const parsed = parser.parse(response.body) as {
      urlset?: { url?: Array<{ loc?: string }> | { loc?: string } };
      sitemapindex?: { sitemap?: Array<{ loc?: string }> | { loc?: string } };
    };

    const collect = (entries: Array<{ loc?: string }> | { loc?: string } | undefined): string[] => {
      if (!entries) return [];
      const list = Array.isArray(entries) ? entries : [entries];
      return list.map((entry) => entry.loc).filter((loc): loc is string => typeof loc === "string");
    };

    return { urls: collect(parsed.urlset?.url), children: collect(parsed.sitemapindex?.sitemap) };
  } catch (error) {
    logger.debug(`Sitemap ${sitemapUrl} not available or unparsable`, error);
    return { urls: [], children: [] };
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

/** How many sitemaps a sitemap index is followed into, so one file cannot stall a scan. */
const MAX_SITEMAP_FETCHES = 10;

/**
 * Discovers routes worth scanning: sitemap.xml (including sitemap indexes)
 * first, falling back to a same-origin link crawl seeded from the homepage
 * and followed to `config.crawl.depth` levels, bounded by
 * `config.crawl.pageLimit`. Discovered routes are ranked so legally
 * significant journeys (checkout, login, privacy policy, ...) are scanned
 * even when the page limit truncates a large site.
 */
export class SiteDiscovery {
  async discover(baseUrl: string, page: Page, config: UniVerscanConfig): Promise<DiscoveredRoute[]> {
    const routes = new Map<string, DiscoveredRoute>();
    let robotsBlocked = 0;

    const fetcher = browserTextFetcher(page);
    const robots: RobotsRules =
      config.crawl.respectRobotsTxt === false ? EMPTY_ROBOTS : await fetchRobotsTxt(baseUrl, fetcher);
    if (robots.loaded) {
      logger.info(`robots.txt loaded: ${robots.disallow.length} disallow rule(s) apply to UniVerscan`);
    }

    // A scan of `https://example.com` that lands on `https://www.example.com`
    // must follow the site there. Comparing every link against the origin the
    // user typed excluded the entire site, leaving a one-page scan whose
    // "no findings" said nothing.
    const origins = new Set<string>([new URL(baseUrl).origin]);
    const landing = await page
      .goto(baseUrl, { waitUntil: "domcontentloaded" })
      .then(() => page.url())
      .catch(() => null);
    if (landing) {
      try {
        const landedOrigin = new URL(landing).origin;
        if (!origins.has(landedOrigin)) {
          logger.info(`${baseUrl} redirected to ${landedOrigin}; both origins are treated as in scope.`);
          origins.add(landedOrigin);
        }
      } catch {
        // A landing URL that will not parse tells us nothing; keep the original scope.
      }
    }

    const addRoute = (url: string, source: DiscoveredRoute["source"]): string | null => {
      try {
        const parsed = new URL(url, baseUrl);
        if (!origins.has(parsed.origin)) return null;
        if (NON_PAGE_EXTENSIONS.test(parsed.pathname)) return null;
        if (isExcluded(parsed.pathname, config)) return null;
        // robots.txt rules are matched against the path *and* query string:
        // rules such as "Disallow: /search?*" are common and only work when
        // the query is included.
        if (!isAllowedByRobots(`${parsed.pathname}${parsed.search}`, robots)) {
          robotsBlocked += 1;
          return null;
        }
        const key = canonicalizeRouteUrl(parsed);
        if (routes.has(key)) return null;
        const { priority, label } = scoreRoute(parsed.pathname);
        routes.set(key, { url: key, label, priority, source });
        return key;
      } catch {
        // ignore malformed URLs
        return null;
      }
    };

    addRoute(baseUrl, "config");
    if (landing) addRoute(landing, "config");

    // --- Sitemaps, following a sitemap index one level at a time. ---
    const pending = robots.sitemaps.length > 0 ? [...robots.sitemaps] : [new URL("/sitemap.xml", baseUrl).toString()];
    const fetched = new Set<string>();
    while (pending.length > 0 && fetched.size < MAX_SITEMAP_FETCHES) {
      const sitemapUrl = pending.shift()!;
      if (fetched.has(sitemapUrl)) continue;
      fetched.add(sitemapUrl);
      const { urls, children } = await tryLoadSitemap(fetcher, sitemapUrl);
      for (const url of urls) addRoute(url, "sitemap");
      for (const child of children) if (!fetched.has(child)) pending.push(child);
    }

    // --- Link crawl, to the configured depth. ---
    // The homepage is already loaded from the redirect probe above.
    const maxDepth = Math.max(1, config.crawl.depth ?? 1);
    let frontier = [landing ?? baseUrl];
    const visited = new Set<string>();
    for (let depth = 0; depth < maxDepth && routes.size < config.crawl.pageLimit; depth += 1) {
      const nextFrontier: string[] = [];
      for (const url of frontier) {
        if (routes.size >= config.crawl.pageLimit) break;
        const key = canonicalizeRouteUrl(new URL(url, baseUrl));
        if (visited.has(key)) continue;
        visited.add(key);

        // The homepage is already open on the first pass; every deeper page
        // has to be loaded to read its links.
        if (!(depth === 0 && landing)) {
          const reached = await page.goto(url, { waitUntil: "domcontentloaded" }).then(() => true).catch(() => false);
          if (!reached) continue;
        }
        const links = await page
          .locator("a[href]")
          .evaluateAll((elements) => elements.map((el) => (el as HTMLAnchorElement).href))
          .catch(() => [] as string[]);
        for (const link of links) {
          const added = addRoute(link, "link-crawl");
          if (added && !visited.has(added)) nextFrontier.push(added);
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
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
