import type { Page, Response } from "playwright";

export interface CookieSecurityIssue {
  name: string;
  domain: string;
  problem:
    | "not-secure-on-https"
    | "no-httponly"
    | "samesite-none-without-secure"
    | "samesite-unset"
    | "prefix-requirements-unmet";
  /**
   * True when the cookie's name marks it as carrying session or
   * authentication state. A missing `Secure` flag on one of those exposes a
   * credential; on a `theme` cookie it is hygiene. Reporting both at the same
   * weight buried the first in a list of the second.
   */
  sessionLike: boolean;
}

export interface SecurityHeaderReport {
  url: string;
  /** True when the main document was served over TLS. */
  https: boolean;
  /** Lower-cased response header names -> value, for the main document only. */
  headers: Record<string, string>;
  /** Headers this scanner looks for that were absent from the main document response. */
  missing: string[];
  /** Cookies whose attributes weaken protection of the data they carry. */
  cookieIssues: CookieSecurityIssue[];
  /** True when an http:// subresource was requested from an https:// page. */
  mixedContentRequests: string[];
}

/**
 * Cookie names that conventionally carry a session or authentication token.
 * `HttpOnly` is only meaningful for these - analytics and preference cookies
 * are read by client-side script by design, so flagging every non-HttpOnly
 * cookie would bury the ones that matter.
 *
 * The optional `id`/`token`/`key`/`hash` suffix matters more than it looks:
 * without it the pattern required a separator or the end of the string right
 * after the keyword, so `sessionid` - the default in Django and Flask, and
 * one of the most common session cookie names in existence - did not match,
 * and its missing `HttpOnly` flag went unreported.
 */
export const SESSION_COOKIE_PATTERN =
  /(^|[_.-])(sess|session|sid|ssid|auth|authn|token|jwt|login|logon|remember|credential|csrf|xsrf)([_.-]?(id|token|key|hash))?([_.-]|$)|^(phpsessid|jsessionid|asp\.net_sessionid|connect\.sid|laravel_session|ci_session|_session_id)$/i;

/**
 * Names that match `SESSION_COOKIE_PATTERN` but carry a *measurement*
 * session, not a credential.
 *
 * Analytics and personalisation platforms number their visits, and the
 * resulting cookie is meant to be read by their own script - `HttpOnly`
 * would break it by design. Real scans reported `analytics_session_id`
 * (DigitalOcean), `wt_mcp_sid` (heise, Webtrekk), `__lt__sid` (asahi) and
 * `ch_sid` (Piano) as credential exposures at violation severity, which put
 * four false positives ahead of the one cookie on those sites that might
 * actually have mattered.
 */
const MEASUREMENT_SESSION_PATTERN =
  /analytic|telemetry|metric|\btrack|tracker|\bstat(s)?[_.-]|pageview|visit(or)?[_.-]|_ga|^_ga|^wt_|^__lt__|^ch_sid$|^s_|^amp_|^ajs_|^mp_|^_pk_|^_hj|^optimizely|^ab[_.-]|experiment|abtest|^gtm|^utm|^cto_|^ttp$|^sc_|^snowplow|^sp_|^cs_|^_cs_|^dtm|^adobe|^AMCV|^mbox$|banner|consent|survey|feedback|recommend/i;

/**
 * A CSRF token in the widely used double-submit-cookie pattern has to be
 * readable by the page's own script - Django, Laravel and Angular all ship it
 * that way, deliberately. Requiring `HttpOnly` on it, as this scanner did,
 * reported python.org's `csrftoken` as a violation of a rule it cannot
 * satisfy without breaking the protection the token provides.
 */
const CSRF_COOKIE_PATTERN = /(^|[_.-])(csrf|xsrf)([_.-]|$)|csrftoken|xsrf[_-]?token/i;

/** True when the name marks a cookie as carrying session or authentication state. */
export function isSessionCredentialName(name: string): boolean {
  if (!SESSION_COOKIE_PATTERN.test(name)) return false;
  if (MEASUREMENT_SESSION_PATTERN.test(name)) return false;
  return true;
}

/**
 * Response headers checked on the main document. These are transport and
 * browser-side protections that data-protection regimes reference through
 * their "security of processing" / "appropriate technical measures" duties
 * (GDPR Art. 32, UK GDPR Art. 32, LGPD Art. 46, APPI Art. 23, APP 11).
 * Their absence is a risk signal, never on its own a legal verdict.
 */
export const EXPECTED_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
] as const;

/**
 * Reads the attributes a `Set-Cookie` header actually declares.
 *
 * The browser cookie API is not usable for this: Chromium reports an
 * effective SameSite of `Lax` for a cookie that declared none, so a cookie
 * missing the attribute is indistinguishable from one that set it. The raw
 * response header is the only place the server's real intent is visible.
 */
export function analyzeSetCookieHeaders(
  setCookieHeaders: string[],
  https: boolean,
  defaultDomain: string
): CookieSecurityIssue[] {
  const issues: CookieSecurityIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: CookieSecurityIssue) => {
    // The same cookie can be set more than once in a single response; one
    // finding per cookie and problem is enough.
    const key = `${issue.name}|${issue.domain}|${issue.problem}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const header of setCookieHeaders) {
    const [pair, ...attributeParts] = header.split(";");
    const name = pair.split("=")[0]?.trim();
    if (!name) continue;
    const attributes = attributeParts.map((part) => part.trim().toLowerCase());
    const secure = attributes.includes("secure");
    const httpOnly = attributes.includes("httponly");
    const sameSite = attributes.find((attr) => attr.startsWith("samesite="))?.split("=")[1] ?? "";
    const domainAttribute = attributes.find((attr) => attr.startsWith("domain="))?.split("=")[1];
    const domain = domainAttribute ?? defaultDomain;
    const path = attributes.find((attr) => attr.startsWith("path="))?.split("=")[1] ?? "";
    const sessionLike = isSessionCredentialName(name);

    if (https && !secure) add({ name, domain, problem: "not-secure-on-https", sessionLike });
    if (sameSite === "none" && !secure) add({ name, domain, problem: "samesite-none-without-secure", sessionLike });
    if (sameSite.length === 0) add({ name, domain, problem: "samesite-unset", sessionLike });
    // A CSRF token is exempt from HttpOnly: the double-submit pattern needs
    // script to read it. It is still expected to be Secure, checked above.
    if (!httpOnly && sessionLike && !CSRF_COOKIE_PATTERN.test(name)) {
      add({ name, domain, problem: "no-httponly", sessionLike });
    }

    // The `__Secure-` and `__Host-` prefixes are a browser-enforced promise
    // about a cookie's scope. A cookie that carries the prefix without
    // meeting its conditions is silently rejected by the browser, so the
    // protection the developer thought they had does not exist.
    const prefixed = /^__Secure-/i.test(name) || /^__Host-/i.test(name);
    const hostPrefixed = /^__Host-/i.test(name);
    if (prefixed && !secure) add({ name, domain, problem: "prefix-requirements-unmet", sessionLike });
    else if (hostPrefixed && (domainAttribute !== undefined || path !== "/")) {
      add({ name, domain, problem: "prefix-requirements-unmet", sessionLike });
    }
  }
  return issues;
}

/**
 * Collects transport-security evidence for a page: main-document response
 * headers, cookie attribute hygiene, and any plaintext subresource loaded by
 * an encrypted page.
 *
 * Attach the request listener via `watch()` before navigating; call
 * `collect()` after the navigation resolves.
 */
export class SecurityHeaderScanner {
  private readonly mixedContent = new Map<string, Set<string>>();

  /**
   * Starts recording plaintext subresource requests for `page`. Safe to call
   * once per page object; the listener accumulates across navigations and is
   * read (and reset) per URL by `collect()`.
   */
  watch(page: Page): void {
    page.on("request", (request) => {
      const requestUrl = request.url();
      if (!requestUrl.startsWith("http://")) return;
      // The document that made the request, not whatever the page has since
      // navigated to. `page.url()` changes mid-flight, which attributed
      // subresources loaded during a navigation to the previous route.
      let pageUrl: string;
      try {
        pageUrl = request.frame().url() || page.url();
      } catch {
        pageUrl = page.url();
      }
      if (!pageUrl.startsWith("https://")) return;
      const bucket = this.mixedContent.get(pageUrl) ?? new Set<string>();
      bucket.add(requestUrl);
      this.mixedContent.set(pageUrl, bucket);
    });
  }

  async collect(page: Page, response: Response | null): Promise<SecurityHeaderReport> {
    const url = page.url();
    const https = url.startsWith("https://");
    const headers: Record<string, string> = {};
    const setCookieHeaders: string[] = [];
    if (response) {
      // headersArray() preserves repeated Set-Cookie entries, which the
      // flattened allHeaders() map collapses into one.
      for (const { name, value } of await response.headersArray().catch(() => [])) {
        const key = name.toLowerCase();
        if (key === "set-cookie") {
          setCookieHeaders.push(value);
          continue;
        }
        headers[key] = value;
      }
    }

    const missing = EXPECTED_HEADERS.filter((header) => !(header in headers));
    const cookieIssues = analyzeSetCookieHeaders(setCookieHeaders, https, new URL(url).hostname);

    const mixedContentRequests = Array.from(this.mixedContent.get(url) ?? []);
    this.mixedContent.delete(url);

    return { url, https, headers, missing, cookieIssues, mixedContentRequests };
  }
}
