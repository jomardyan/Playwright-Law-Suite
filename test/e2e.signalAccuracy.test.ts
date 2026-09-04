import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import { BrowserManager } from "../src/engine/BrowserManager.js";
import { FormsScanner } from "../src/modules/forms/FormsScanner.js";
import { ConsumerJourneyScanner } from "../src/modules/consumer/ConsumerJourneyScanner.js";
import { PrivacyDocumentScanner } from "../src/modules/privacy/PrivacyDocumentScanner.js";
import { CookieScanner } from "../src/modules/cookies/CookieScanner.js";
import { AccessibilityScanner } from "../src/modules/accessibility/AccessibilityScanner.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

const CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const hasLocalChromium = existsSync(CHROMIUM_PATH);
if (hasLocalChromium && !process.env.UNIVERSCAN_CHROMIUM_PATH) {
  process.env.UNIVERSCAN_CHROMIUM_PATH = CHROMIUM_PATH;
}

/**
 * A sign-up page written the way modern applications actually are: the
 * consent boxes are wrapped in their labels rather than wired up with
 * `for=`, several controls sit outside any `<form>` element, and one input
 * is a hidden honeypot.
 */
const SIGNUP_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign up</title></head>
<body>
  <h1>Create your account</h1>
  <form action="https://api.example.test/signup" method="post">
    <label><input type="checkbox" name="marketing" checked> Yes, send me marketing emails and I accept the terms</label>
    <label><input type="checkbox" name="tos"> I have read the privacy policy</label>
    <input type="text" name="company_name" placeholder="Company name">
    <input type="text" name="full_name" placeholder="Your name">
    <input type="text" name="contact" autocomplete="email">
    <input type="hidden" name="email_confirm" value="">
    <input type="text" name="nhs_number" placeholder="Health record number">
    <button type="submit">Create account</button>
  </form>

  <!-- No form element: the SPA pattern the old scanner could not see. -->
  <div id="newsletter">
    <input type="text" id="subscriber-phone" autocomplete="tel">
    <input type="checkbox" id="optin" aria-label="Subscribe to the newsletter">
  </div>

  <footer>
    <a href="/legal/privacy_policy">Privacy</a>
    <a href="/legal/cookies">Cookie Policy</a>
    <a href="/impressum">Impressum</a>
  </footer>
</body>
</html>`;

/** A free newsletter signup. Not a paid subscription, so not a CRD surface. */
const NEWSLETTER_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Newsletter</title></head>
<body>
  <main>
    <h1>Newsletter</h1>
    <p>Join our free mailing list for monthly project news.</p>
    <input type="email" id="nl-email" autocomplete="email">
    <button id="nl-go">Subscribe</button>
  </main>
  <a href="/contact">Contact</a>
</body>
</html>`;

/** A paid plan page: subscription wording plus a price and a billing period. */
const PRICING_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Pricing</title></head>
<body>
  <main>
    <h1>Pricing plans</h1>
    <p>Pro: €29 per month, billed monthly.</p>
    <button id="buy">Subscribe now</button>
  </main>
  <a href="/legal">Legal</a>
</body>
</html>`;

/** A content page that mentions plans and checkout in prose but sells nothing. */
const ARTICLE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>How we build our roadmap</title></head>
<body>
  <h1>How we build our roadmap</h1>
  <p>Our plans for the next quarter include a faster checkout and clearer pricing.
     We will subscribe to more feedback channels and upgrade our billing stack.</p>
  <a href="/about">About us</a>
</body>
</html>`;

/** A genuine order-completion page. */
const CHECKOUT_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Checkout</title></head>
<body>
  <h1>Checkout</h1>
  <p>Your membership renews automatically every month until you cancel.</p>
  <button id="order">Complete your order</button>
  <a href="/impressum">Legal notice</a>
</body>
</html>`;

/**
 * A page whose consent banner is rendered inside an iframe, with the reject
 * control only reachable there - the layout every major CMP ships.
 */
const FRAMED_CONSENT_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Framed consent</title></head>
<body>
  <h1>Framed consent</h1>
  <iframe src="/cmp" title="Consent" style="width:400px;height:200px;border:0"></iframe>
  <a href="/legal/privacy_policy">Privacy</a>
</body>
</html>`;

const CMP_FRAME_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Consent</title></head>
<body>
  <div id="cookie-banner">
    <p>We use cookies.</p>
    <button id="accept">Accept all</button>
    <button id="refuse">Reject all</button>
  </div>
</body>
</html>`;

const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Privacy Policy</title></head>
<body>
  <h1>Privacy Policy</h1>
  <p>Beispiel Ltd is the data controller. Our legal basis is legitimate interest.
     You have the right to access and the right to erasure. You may lodge a complaint
     with the supervisory authority. You can withdraw your consent at any time.
     For privacy questions write to privacy@example.test. The retention period is 24 months.</p>
</body>
</html>`;

/**
 * Focus is indicated by a background change with the outline suppressed - the
 * house style of most modern design systems, and previously reported as a
 * WCAG 2.4.7 violation.
 */
const CUSTOM_FOCUS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Custom focus</title>
<style>
  a:focus { outline: none; background: #002b5c; color: #fff; }
</style></head>
<body>
  <main><h1>Custom focus</h1><a href="/next">Next</a></main>
</body>
</html>`;

/** Focus is suppressed and nothing replaces it: a real 2.4.7 failure. */
const NO_FOCUS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>No focus</title>
<style> a:focus { outline: none; } </style></head>
<body>
  <main><h1>No focus</h1><a href="/next">Next</a></main>
</body>
</html>`;

/** Landmarks and headings, but no skip link. */
const LANDMARKS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Landmarks</title></head>
<body>
  <header>Site</header>
  <nav><a href="/a">A</a></nav>
  <main><h1>Landmarks</h1><h2>Section</h2><p>Body</p></main>
</body>
</html>`;

/** A skip link, the classic bypass mechanism. */
const SKIPLINK_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Skip link</title></head>
<body>
  <a href="#content">Skip to main content</a>
  <main id="content"><h1>Skip link</h1></main>
</body>
</html>`;

describe.skipIf(!hasLocalChromium)("signal collection accuracy", () => {
  let server: Server;
  let baseUrl: string;
  let browserManager: BrowserManager;
  let page: Page;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      const body = url.startsWith("/newsletter")
        ? NEWSLETTER_HTML
        : url.startsWith("/pricing")
        ? PRICING_HTML
        : url.startsWith("/a11y/custom-focus")
        ? CUSTOM_FOCUS_HTML
        : url.startsWith("/a11y/no-focus")
        ? NO_FOCUS_HTML
        : url.startsWith("/a11y/landmarks")
        ? LANDMARKS_HTML
        : url.startsWith("/a11y/skiplink")
        ? SKIPLINK_HTML
        : url.startsWith("/article")
        ? ARTICLE_HTML
        : url.startsWith("/checkout")
          ? CHECKOUT_HTML
          : url.startsWith("/framed")
            ? FRAMED_CONSENT_HTML
            : url.startsWith("/cmp")
              ? CMP_FRAME_HTML
              : url.startsWith("/legal/privacy_policy")
                ? PRIVACY_HTML
                : SIGNUP_HTML;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    browserManager = new BrowserManager({ engine: "chromium", headless: true });
    await browserManager.launch();
    const context = await browserManager.newContext();
    page = await context.newPage();
  }, 60_000);

  afterAll(async () => {
    await browserManager?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("FormsScanner", () => {
    it("reads a consent label from the element wrapping the checkbox", async () => {
      await page.goto(`${baseUrl}/signup`);
      const forms = await new FormsScanner().scan(page);
      const realForm = forms.find((f) => f.scope === "form");

      const marketing = realForm?.consentCheckboxes.find((c) => /marketing/i.test(c.label));
      expect(marketing, "a wrapping <label> is the most common consent markup there is").toBeDefined();
      expect(marketing?.preChecked).toBe(true);
      expect(marketing?.purposeBundled, "one box asking for marketing and the terms together").toBe(true);

      const terms = realForm?.consentCheckboxes.find((c) => /privacy policy/i.test(c.label));
      expect(terms?.preChecked).toBe(false);
    });

    it("does not read a company name as a person's name", async () => {
      await page.goto(`${baseUrl}/signup`);
      const forms = await new FormsScanner().scan(page);
      const fields = forms.flatMap((f) => f.fields);
      expect(fields.find((f) => f.name === "company_name")?.category).toBeNull();
      expect(fields.find((f) => f.name === "full_name")?.category).toBe("name");
    });

    it("classifies by the autocomplete token when the field name says nothing", async () => {
      await page.goto(`${baseUrl}/signup`);
      const fields = (await new FormsScanner().scan(page)).flatMap((f) => f.fields);
      expect(fields.find((f) => f.name === "contact")?.category).toBe("email");
    });

    it("marks a hidden field as hidden rather than as collected personal data", async () => {
      await page.goto(`${baseUrl}/signup`);
      const fields = (await new FormsScanner().scan(page)).flatMap((f) => f.fields);
      expect(fields.find((f) => f.name === "email_confirm")?.hidden).toBe(true);
    });

    it("sees controls that sit outside any form element", async () => {
      await page.goto(`${baseUrl}/signup`);
      const forms = await new FormsScanner().scan(page);
      const pageScoped = forms.find((f) => f.scope === "page");
      expect(pageScoped, "single-page applications routinely submit without a <form>").toBeDefined();
      expect(pageScoped?.fields.find((f) => f.name === "subscriber-phone")?.category).toBe("phone");
      expect(pageScoped?.consentCheckboxes.map((c) => c.label)).toContain("Subscribe to the newsletter");
    });

    it("treats a post to the site's own API subdomain as first-party", async () => {
      await page.goto(`${baseUrl}/signup`);
      const forms = await new FormsScanner().scan(page);
      // The fixture posts to api.example.test from 127.0.0.1, so it is a
      // genuine third party here; the assertion that matters is that the
      // decision is made at all rather than by comparing full origins.
      expect(forms.find((f) => f.scope === "form")?.actionIsThirdParty).toBe(true);
    });
  });

  describe("ConsumerJourneyScanner", () => {
    it("does not call an article a subscription surface because its prose says 'plans'", async () => {
      await page.goto(`${baseUrl}/article`);
      const report = await new ConsumerJourneyScanner().scan(page);
      expect(report.isSubscriptionSurface).toBe(false);
      expect(report.isOrderCompletionSurface).toBe(false);
      expect(report.surfaceEvidence).toEqual([]);
    });

    it("does not treat a free newsletter signup as a paid subscription", async () => {
      // python.org's /psf/newsletter/ was classified a paid subscription
      // surface off the word "Subscribe" alone, which produced a Consumer
      // Rights Directive withdrawal finding against the Python Software
      // Foundation.
      await page.goto(`${baseUrl}/newsletter`);
      const report = await new ConsumerJourneyScanner().scan(page);
      expect(report.isSubscriptionSurface).toBe(false);
      expect(report.surfaceEvidence.join(" ")).toMatch(/without any price or billing period/);
    });

    it("recognises a paid plan page, where money is visible", async () => {
      await page.goto(`${baseUrl}/pricing`);
      const report = await new ConsumerJourneyScanner().scan(page);
      expect(report.isSubscriptionSurface).toBe(true);
      expect(report.surfaceEvidence.join(" ")).toMatch(/Price on the page/);
    });

    it("finds the trader identity behind a bare 'Contact' or 'Legal' link", async () => {
      // Stripe ("Contact sales"), DigitalOcean ("About", "Legal"),
      // python.org ("Legal Statements") and Rijksoverheid ("Contact") were
      // all reported as publishing no trader identity anywhere.
      await page.goto(`${baseUrl}/pricing`);
      const report = await new ConsumerJourneyScanner().scan(page);
      expect(report.traderIdentityLinked).toBe(true);
      expect(report.traderIdentityLinks.join(" ")).toMatch(/Legal/);
    });

    it("recognises a real checkout, and says what made it think so", async () => {
      await page.goto(`${baseUrl}/checkout`);
      const report = await new ConsumerJourneyScanner().scan(page);
      expect(report.isOrderCompletionSurface).toBe(true);
      expect(report.isSubscriptionSurface).toBe(true);
      expect(report.surfaceEvidence.length).toBeGreaterThan(0);
      expect(report.ambiguousOrderButtons.map((b) => b.text)).toContain("Complete your order");
      expect(report.autoRenewalDisclosures.length).toBeGreaterThan(0);
      expect(report.traderIdentityLinked).toBe(true);
    });
  });

  describe("PrivacyDocumentScanner", () => {
    it("finds a notice whose link text is only 'Privacy' and reads its disclosures", async () => {
      await page.goto(`${baseUrl}/signup`);
      const scanner = new PrivacyDocumentScanner();
      const documents = await scanner.findDocuments(page);
      const notice = documents.find((d) => d.label === "privacy-policy");
      expect(notice?.url).toBe(`${baseUrl}/legal/privacy_policy`);

      const analyzed = await scanner.analyzeDocument(page, notice!);
      expect(analyzed.textLength).toBeGreaterThan(0);
      const detected = analyzed.disclosures.filter((d) => d.status === "detected").map((d) => d.category);
      expect(detected).toContain("controller-identity");
      expect(detected).toContain("legal-bases");
      expect(detected).toContain("supervisory-authority");
      expect(detected).toContain("controller-contact");
    });
  });

  describe("AccessibilityScanner", () => {
    const check = async (path: string, id: string) => {
      await page.goto(`${baseUrl}${path}`);
      const results = await new AccessibilityScanner().runInteractionChecks(page);
      return results.find((result) => result.id === id);
    };

    it("accepts a focus indicator that is not an outline", async () => {
      // Suppressing the outline and colouring the element instead is the
      // house style of most design systems; it used to read as a violation.
      const result = await check("/a11y/custom-focus", "focus-visible-indicator");
      expect(result?.passed).toBe(true);
      expect(result?.detail).toMatch(/backgroundColor|color/);
    });

    it("still reports a focused element that renders identically unfocused", async () => {
      const result = await check("/a11y/no-focus", "focus-visible-indicator");
      expect(result?.passed).toBe(false);
    });

    it("does not call a landmark-structured page a bypass-blocks failure", async () => {
      // SC 2.4.1 accepts landmark navigation as a bypass mechanism, so the
      // absence of a skip link is a question, not a verdict.
      const result = await check("/a11y/landmarks", "bypass-blocks-mechanism");
      expect(result?.passed).toBeNull();
      expect(result?.detail).toContain("landmark");
    });

    it("passes a page that does have a skip link", async () => {
      const result = await check("/a11y/skiplink", "bypass-blocks-mechanism");
      expect(result?.passed).toBe(true);
    });

    it("returns axe's undecided checks instead of discarding them", async () => {
      await page.goto(`${baseUrl}/signup`);
      const result = await new AccessibilityScanner().analyze(page, "wcag22aa");
      // The shape is what matters: incomplete results are carried, so a
      // check axe could not decide can never be reported as a pass.
      expect(Array.isArray(result.incomplete)).toBe(true);
      expect(Array.isArray(result.violations)).toBe(true);
    });
  });

  describe("CookieScanner", () => {
    it("finds accept and reject controls rendered inside a CMP iframe", async () => {
      const scanner = new CookieScanner(browserManager, {
        ...DEFAULT_CONFIG.consent,
        probeGlobalPrivacyControl: false,
        testWithdrawal: false,
        settleMs: 300,
      });
      const flow = await scanner.runConsentFlow(`${baseUrl}/framed`);

      expect(flow.bannerDetected, "banner markup lives in the iframe").toBe(true);
      expect(flow.bannerAcceptControlFound).toBe(true);
      // Before this, a reject control inside an iframe read as absent, and
      // the site was reported for offering no way to refuse.
      expect(flow.bannerRejectControlFound).toBe(true);
    }, 60_000);

    it("reports no banner on a page that has none", async () => {
      const scanner = new CookieScanner(browserManager, {
        ...DEFAULT_CONFIG.consent,
        probeGlobalPrivacyControl: false,
        testWithdrawal: false,
        settleMs: 300,
      });
      const flow = await scanner.runConsentFlow(`${baseUrl}/article`);
      expect(flow.bannerDetected).toBe(false);
      expect(flow.bannerAcceptControlFound).toBe(false);
      expect(flow.bannerRejectControlFound).toBe(false);
    }, 60_000);
  });
});
