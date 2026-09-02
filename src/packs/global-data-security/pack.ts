import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "global-data-security";
const REGULATION = "Security of processing (technical measures common to major data protection regimes)";
const JURISDICTION = "Global";

/**
 * Every major data protection regime obliges a controller to apply technical
 * measures appropriate to the risk, without enumerating them. This pack
 * checks the transport-layer measures a browser can observe and reports each
 * as a risk, never as a violation of a named article: whether a given
 * measure is "appropriate" for a given service is a judgement no scanner
 * can make.
 */
const SECURITY_ARTICLES =
  "GDPR Art. 32; UK GDPR Art. 32; LGPD Art. 46; PIPEDA Principle 4.7; APPI Art. 23; APP 11; DPDP Act 2023 s. 8(5)";

const HEADER_GUIDANCE: Record<string, { why: string; fix: string }> = {
  "strict-transport-security": {
    why: "Without HSTS a first request can be downgraded to plaintext, exposing session cookies in transit.",
    fix: "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` on HTTPS responses.",
  },
  "content-security-policy": {
    why: "Without a CSP, an injected script can read form input and exfiltrate personal data from the page.",
    fix: "Define a Content-Security-Policy that restricts script-src to trusted origins and forbids inline script.",
  },
  "x-content-type-options": {
    why: "Without it, a browser may MIME-sniff a response and execute content that was never meant to be script.",
    fix: "Send `X-Content-Type-Options: nosniff` on every response.",
  },
  "referrer-policy": {
    why: "A permissive referrer policy leaks the full URL - which can itself carry identifiers - to third parties.",
    fix: "Send `Referrer-Policy: strict-origin-when-cross-origin` or stricter.",
  },
};

const transportEncryption = defineRule({
  id: "security-transport-encryption",
  requirement: "Personal data must be transmitted over an encrypted channel.",
  severity: "critical",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: SECURITY_ARTICLES,
  remediation: "Serve the whole site over HTTPS and redirect plaintext requests permanently.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const security = page.securityHeaders;
      if (!security) continue;
      // localhost is how source mode scans a locally started app; a dev
      // server on loopback is not a plaintext-transport risk.
      const host = (() => {
        try {
          return new URL(page.url).hostname;
        } catch {
          return "";
        }
      })();
      const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
      if (security.https || isLoopback) continue;
      findings.push(
        buildFinding(transportEncryption, PACK_ID, REGULATION, JURISDICTION, {
          status: "violation",
          affectedUrl: page.url,
          observedBehavior: "The page was served over plaintext HTTP.",
          expectedBehavior: "All pages are served over HTTPS.",
          evidence: [context.evidence.note("Transport", { url: page.url, https: false })],
          manualReviewRequired: false,
        })
      );
    }
    return findings;
  },
});

const mixedContent = defineRule({
  id: "security-mixed-content",
  requirement: "An encrypted page must not load subresources over plaintext HTTP.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: SECURITY_ARTICLES,
  remediation: "Serve every subresource over HTTPS, or remove it.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const requests = page.securityHeaders?.mixedContentRequests ?? [];
      if (requests.length === 0) continue;
      findings.push(
        buildFinding(mixedContent, PACK_ID, REGULATION, JURISDICTION, {
          status: "violation",
          affectedUrl: page.url,
          observedBehavior: `${requests.length} plaintext subresource request(s) were made from an HTTPS page.`,
          expectedBehavior: "No plaintext subresources on an encrypted page.",
          evidence: [context.evidence.requestLog("Plaintext subresource requests", requests)],
          manualReviewRequired: false,
        })
      );
    }
    return findings;
  },
});

const securityHeaders = defineRule({
  id: "security-response-headers",
  requirement:
    "A service handling personal data should set the browser-side protections that limit script injection, MIME confusion, transport downgrade, and referrer leakage.",
  severity: "medium",
  confidence: "high",
  automationLevel: "partially-automated",
  legalReference: SECURITY_ARTICLES,
  remediation:
    "Set the missing response headers at the edge or in the application framework. Which measures are 'appropriate' depends on the risk of the processing, so treat this as a baseline rather than a complete list.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const missing = page.securityHeaders?.missing ?? [];
      if (missing.length === 0) continue;
      findings.push(
        buildFinding(securityHeaders, PACK_ID, REGULATION, JURISDICTION, {
          status: "risk",
          affectedUrl: page.url,
          affectedElement: missing.join(", "),
          observedBehavior: `The main document response omitted: ${missing
            .map((header) => `${header} (${HEADER_GUIDANCE[header]?.why ?? "recommended protection"})`)
            .join(" ")}`,
          expectedBehavior: "Baseline browser-side security headers are present on the main document response.",
          evidence: [
            context.evidence.note("Missing headers and remediation", {
              missing,
              fixes: missing.map((header) => HEADER_GUIDANCE[header]?.fix).filter(Boolean),
            }),
          ],
          manualReviewRequired: false,
        })
      );
    }
    return findings;
  },
});

const cookieAttributes = defineRule({
  id: "security-cookie-attributes",
  requirement:
    "Cookies carrying session or authentication state must be marked Secure and HttpOnly, and every cookie should declare an explicit SameSite policy.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: SECURITY_ARTICLES,
  remediation:
    "Set `Secure; HttpOnly; SameSite=Lax` (or `Strict`) on session cookies. A cookie needing `SameSite=None` for a cross-site flow must also be `Secure`.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const issues = page.securityHeaders?.cookieIssues ?? [];
      // SameSite-unset alone is a hygiene note rather than an exposure, so it
      // is reported at a lower status than a missing Secure/HttpOnly flag.
      const serious = issues.filter((issue) => issue.problem !== "samesite-unset");
      const hygiene = issues.filter((issue) => issue.problem === "samesite-unset");

      for (const issue of serious) {
        findings.push(
          buildFinding(cookieAttributes, PACK_ID, REGULATION, JURISDICTION, {
            status: "violation",
            affectedUrl: page.url,
            affectedElement: `${issue.name} (${issue.domain})`,
            observedBehavior: `Cookie '${issue.name}' on ${issue.domain}: ${issue.problem}.`,
            expectedBehavior: "Session and authentication cookies are Secure and HttpOnly.",
            evidence: [context.evidence.cookieSnapshot("Cookie attribute issue", [issue])],
            manualReviewRequired: false,
          })
        );
      }
      if (hygiene.length > 0) {
        findings.push(
          buildFinding(cookieAttributes, PACK_ID, REGULATION, JURISDICTION, {
            status: "risk",
            affectedUrl: page.url,
            affectedElement: hygiene.map((i) => i.name).join(", "),
            observedBehavior: `${hygiene.length} cookie(s) declare no SameSite attribute and fall back to the browser default.`,
            expectedBehavior: "Every cookie declares an explicit SameSite policy.",
            evidence: [context.evidence.cookieSnapshot("Cookies without SameSite", hygiene)],
            manualReviewRequired: false,
          })
        );
      }
    }
    return findings;
  },
});

const formTransport = defineRule({
  id: "security-form-transport",
  requirement: "A form collecting personal data must submit over an encrypted channel to a disclosed recipient.",
  severity: "critical",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: SECURITY_ARTICLES,
  remediation: "Point the form action at an HTTPS endpoint, and disclose any third-party processor in the privacy notice.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const form of page.forms) {
        const collectsPersonalData = form.fields.some((field) => field.category !== null);
        if (!collectsPersonalData || form.usesHttps) continue;
        findings.push(
          buildFinding(formTransport, PACK_ID, REGULATION, JURISDICTION, {
            status: "violation",
            affectedUrl: page.url,
            affectedElement: `form[${form.formIndex}] -> ${form.action ?? "(same page)"}`,
            observedBehavior: `A form collecting ${form.fields.filter((f) => f.category).length} personal-data field(s) submits over plaintext HTTP.`,
            expectedBehavior: "Forms collecting personal data submit over HTTPS.",
            evidence: [context.evidence.note("Form transport", { action: form.action, method: form.method })],
            manualReviewRequired: false,
          })
        );
      }
    }
    return findings;
  },
});

export const globalDataSecurityPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "Global",
  regulation: REGULATION,
  authority: "Applicable data protection authority for the jurisdictions in scope",
  version: "1.0.0",
  effectiveDate: "2018-05-25",
  /**
   * Security of processing is an obligation under every regime this tool
   * ships a pack for, so it loads whenever any jurisdiction is selected.
   */
  applicability: (config) => config.jurisdictions.length > 0,
  rules: [transportEncryption, mixedContent, securityHeaders, cookieAttributes, formTransport] as Rule[],
};
