import type { Page } from "playwright";

/**
 * Whether the document a navigation produced is actually the page that was
 * requested.
 *
 * A bot-management challenge, a captcha wall or a geo-block is routinely
 * served with HTTP 200 and a body containing none of the site's content. Every
 * "this page is missing X" rule then fires against it: on a real scan of
 * lemonde.fr, three routes returned a Radware "Client Challenge" captcha and
 * were reported as having no privacy notice (critical) and no mechanism to
 * bypass repeated content (a WCAG 2.4.7 violation) - four findings per page,
 * none of them about Le Monde.
 *
 * The engine already refuses to reason about a page that failed to load or
 * answered 4xx. An interstitial is the same situation wearing a 200, and is
 * treated the same way: recorded as unreachable, so the rules that needed it
 * report `not-evaluated` rather than inventing a violation.
 */

export interface PageIntegrityResult {
  /** True when the document looks like the requested content. */
  isContent: boolean;
  /** Why it was rejected, phrased for the unreachable-pages report. */
  reason?: string;
}

/**
 * Titles and body text of the interstitials in wide deployment. Matched
 * case-insensitively against the document title and the first part of the
 * body text, both of which are short on a challenge page.
 */
const CHALLENGE_TEXT_PATTERNS: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /\bclient challenge\b/i, vendor: "a bot-management challenge" },
  { pattern: /just a moment\b/i, vendor: "a Cloudflare interstitial" },
  { pattern: /checking (if )?(your|the) (browser|site connection)/i, vendor: "a Cloudflare browser check" },
  { pattern: /enable javascript and cookies to continue/i, vendor: "a Cloudflare challenge" },
  { pattern: /attention required!?\s*\|?\s*cloudflare/i, vendor: "a Cloudflare block page" },
  { pattern: /\bpardon our interruption\b/i, vendor: "an Imperva/Distil interstitial" },
  { pattern: /request unsuccessful\.?\s*incapsula incident/i, vendor: "an Imperva Incapsula block page" },
  { pattern: /verify(ing)? (that )?you are (a )?human/i, vendor: "a human-verification challenge" },
  { pattern: /are you a (robot|human)\b/i, vendor: "a bot check" },
  { pattern: /unusual traffic from your computer network/i, vendor: "a rate-limit interstitial" },
  { pattern: /access (to this page )?(has been )?denied/i, vendor: "an access-denied page" },
  { pattern: /\byou have been blocked\b/i, vendor: "a block page" },
  { pattern: /enter the characters (seen|shown) in the image/i, vendor: "a captcha wall" },
  { pattern: /\bcaptcha\b/i, vendor: "a captcha wall" },
  { pattern: /please (enable|turn on) javascript to (view|continue)/i, vendor: "a scripting-required interstitial" },
  { pattern: /one more step\b/i, vendor: "a Cloudflare interstitial" },
  { pattern: /this (content|page) is not available in your (country|region|location)/i, vendor: "a geo-block" },
  { pattern: /\b(451|403)\b.*unavailable for legal reasons/i, vendor: "a legal geo-block" },
];

/**
 * Markup that identifies a challenge even when its wording is localised.
 * Vendor-specific, so a match is strong evidence on its own.
 */
const CHALLENGE_SELECTORS: Array<{ selector: string; vendor: string }> = [
  { selector: "#challenge-running", vendor: "a Cloudflare challenge" },
  { selector: "#cf-challenge-running", vendor: "a Cloudflare challenge" },
  { selector: "#cf-wrapper", vendor: "a Cloudflare error page" },
  { selector: ".cf-browser-verification", vendor: "a Cloudflare browser check" },
  { selector: "#px-captcha", vendor: "a HUMAN/PerimeterX captcha" },
  { selector: "[id^='distil_ident']", vendor: "an Imperva/Distil challenge" },
  { selector: "iframe[src*='captcha-delivery.com']", vendor: "a DataDome captcha" },
  { selector: "iframe[src*='geo.captcha']", vendor: "a DataDome captcha" },
  { selector: "form[action*='validateCaptcha']", vendor: "a captcha wall" },
  { selector: "#recaptcha-token", vendor: "a reCAPTCHA challenge" },
  { selector: "[data-testid='challenge-page']", vendor: "a challenge page" },
];

/**
 * Text below this length, with no heading and no link, is not a page a
 * compliance rule can say anything about. Used only in combination with
 * challenge wording, never on its own: `example.com` is a legitimate page
 * with about 170 characters of text.
 */
const SPARSE_TEXT_LIMIT = 1200;

interface PageShape {
  title: string;
  text: string;
  links: number;
  headings: number;
  challengeSelector: string | null;
}

/**
 * Inspects the rendered document and decides whether it is the requested
 * content or an interstitial standing in front of it.
 *
 * Deliberately conservative in one direction: challenge wording alone is not
 * enough when the page is otherwise a full document, because an article about
 * captchas would match. The page has to be *both* sparse and self-identifying
 * as a challenge - or carry vendor-specific challenge markup, which no
 * ordinary page does.
 */
export async function assessPageIntegrity(page: Page): Promise<PageIntegrityResult> {
  const shape = await page
    .evaluate((selectors: string[]) => {
      const found = selectors.find((selector) => {
        try {
          return document.querySelector(selector) !== null;
        } catch {
          return false;
        }
      });
      return {
        title: document.title ?? "",
        text: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
        links: document.querySelectorAll("a[href]").length,
        headings: document.querySelectorAll("h1, h2, h3, h4, h5, h6").length,
        challengeSelector: found ?? null,
      } satisfies PageShape;
    }, CHALLENGE_SELECTORS.map((entry) => entry.selector))
    .catch(() => null);

  // A document that cannot be inspected is left to the caller's other checks;
  // claiming it is an interstitial would be its own guess.
  if (!shape) return { isContent: true };

  if (shape.challengeSelector) {
    const vendor = CHALLENGE_SELECTORS.find((entry) => entry.selector === shape.challengeSelector)?.vendor;
    return {
      isContent: false,
      reason: `the response carried ${vendor ?? "challenge markup"} (${shape.challengeSelector}) rather than the requested page`,
    };
  }

  const haystack = `${shape.title}\n${shape.text}`;
  const sparse = shape.text.length < SPARSE_TEXT_LIMIT && shape.headings === 0 && shape.links <= 2;
  if (!sparse) return { isContent: true };

  const match = CHALLENGE_TEXT_PATTERNS.find((entry) => entry.pattern.test(haystack));
  if (match) {
    return {
      isContent: false,
      reason: `the response was ${match.vendor}, not the requested page (title: "${shape.title.slice(0, 80)}")`,
    };
  }

  return { isContent: true };
}
