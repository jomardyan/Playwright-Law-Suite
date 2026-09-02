import type { Page, Response } from "playwright";

export interface CookieSecurityIssue {
  name: string;
  domain: string;
  problem: "not-secure-on-https" | "no-httponly" | "samesite-none-without-secure" | "samesite-unset";
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
 */
const SESSION_COOKIE_PATTERN =
  /(^|[_.-])(sess|session|sid|auth|token|jwt|login|remember|csrf|xsrf)([_.-]|$)|^(phpsessid|jsessionid|asp\.net_sessionid|connect\.sid)$/i;

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
  for (const header of setCookieHeaders) {
    const [pair, ...attributeParts] = header.split(";");
    const name = pair.split("=")[0]?.trim();
    if (!name) continue;
    const attributes = attributeParts.map((part) => part.trim().toLowerCase());
    const secure = attributes.includes("secure");
    const httpOnly = attributes.includes("httponly");
    const sameSite = attributes.find((attr) => attr.startsWith("samesite="))?.split("=")[1] ?? "";
    const domain = attributes.find((attr) => attr.startsWith("domain="))?.split("=")[1] ?? defaultDomain;

    if (https && !secure) issues.push({ name, domain, problem: "not-secure-on-https" });
    if (sameSite === "none" && !secure) issues.push({ name, domain, problem: "samesite-none-without-secure" });
    if (sameSite.length === 0) issues.push({ name, domain, problem: "samesite-unset" });
    if (!httpOnly && SESSION_COOKIE_PATTERN.test(name)) issues.push({ name, domain, problem: "no-httponly" });
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
      const pageUrl = page.url();
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
