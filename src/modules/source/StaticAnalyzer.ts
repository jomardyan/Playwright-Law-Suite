import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { walkFiles } from "../../utils/walkFiles.js";
import type { Confidence, Finding, Severity } from "../../engine/types.js";

const PACK_ID = "static-source-analysis";
const REGULATION = "Cross-jurisdiction technical signal (static source analysis)";
const JURISDICTION = "N/A - technical";

const SCANNED_EXTENSIONS = [".html", ".htm", ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".php"];

interface PatternRule {
  id: string;
  pattern: RegExp;
  requirement: string;
  severity: Severity;
  confidence: Confidence;
  observedTemplate: (match: string) => string;
  expectedBehavior: string;
  remediation: string;
}

const PATTERN_RULES: PatternRule[] = [
  {
    id: "static-google-analytics-detected",
    pattern: /gtag\(|GoogleAnalyticsObject|google-analytics\.com\/analytics\.js|googletagmanager\.com\/gtag/,
    requirement: "Analytics integrations should be inventoried and gated behind consent where required.",
    severity: "informational",
    confidence: "high",
    observedTemplate: () => "Google Analytics integration detected in source.",
    expectedBehavior: "Analytics scripts are loaded only after consent, where the applicable regulatory pack requires it.",
    remediation: "Confirm this script is gated by the consent management platform, not loaded unconditionally.",
  },
  {
    id: "static-meta-pixel-detected",
    pattern: /fbq\(|connect\.facebook\.net\/.*\/fbevents/,
    requirement: "Advertising pixels should be inventoried and gated behind consent where required.",
    severity: "informational",
    confidence: "high",
    observedTemplate: () => "Meta (Facebook) Pixel integration detected in source.",
    expectedBehavior: "Advertising pixels are loaded only after consent, where the applicable regulatory pack requires it.",
    remediation: "Confirm this script is gated by the consent management platform, not loaded unconditionally.",
  },
  {
    id: "static-advertising-sdk-detected",
    pattern: /doubleclick\.net|googlesyndication\.com|ads\.linkedin\.com|analytics\.tiktok\.com/,
    requirement: "Third-party advertising SDKs should be inventoried and gated behind consent where required.",
    severity: "informational",
    confidence: "medium",
    observedTemplate: (match) => `Third-party advertising SDK reference detected: ${match}`,
    expectedBehavior: "Advertising SDKs are loaded only after consent, where the applicable regulatory pack requires it.",
    remediation: "Confirm this integration is gated by the consent management platform.",
  },
  {
    id: "static-fingerprinting-library-detected",
    pattern: /FingerprintJS|fingerprintjs2?|clientjs\.fingerprint/i,
    requirement: "Device/browser fingerprinting techniques typically require disclosure and, in many jurisdictions, consent.",
    severity: "medium",
    confidence: "medium",
    observedTemplate: () => "A browser fingerprinting library reference was detected in source.",
    expectedBehavior: "Fingerprinting is disclosed in the privacy/cookie policy and gated by consent where legally required.",
    remediation: "Review whether this fingerprinting use is disclosed and, where required, consent-gated.",
  },
  {
    id: "static-manual-cookie-write",
    pattern: /document\.cookie\s*=/,
    requirement: "Cookies set directly in application code should be inventoried alongside those set by third-party scripts.",
    severity: "informational",
    confidence: "high",
    observedTemplate: () => "Direct 'document.cookie =' write detected in source.",
    expectedBehavior: "All cookies, first- and third-party, are declared in the cookie policy and consent inventory.",
    remediation: "Add this cookie to the site's cookie inventory/disclosure and confirm it is categorized correctly (essential vs. non-essential).",
  },
  {
    id: "static-localstorage-write",
    pattern: /localStorage\.setItem\(/,
    requirement: "Persistent client-side storage of identifiers/preferences should be inventoried alongside cookies.",
    severity: "informational",
    confidence: "medium",
    observedTemplate: () => "'localStorage.setItem(' call detected in source.",
    expectedBehavior: "Storage use is declared in the privacy/cookie policy where it involves personal data or tracking identifiers.",
    remediation: "Confirm this storage use is disclosed if it involves personal data or persistent identifiers.",
  },
  {
    id: "static-consent-management-platform-detected",
    pattern: /cookiebot|onetrust|trustarc|CookieConsent\b/i,
    requirement: "Presence of a recognized consent management platform is a positive signal, but its configuration must still be verified at runtime.",
    severity: "informational",
    confidence: "high",
    observedTemplate: (match) => `Consent management platform reference detected: ${match}`,
    expectedBehavior: "The CMP is present and correctly blocks non-essential scripts before consent (verify with a live scan).",
    remediation: "Run a live-mode scan to confirm the CMP actually gates non-essential scripts before consent.",
  },
  {
    id: "static-payment-form-detected",
    pattern: /stripe\.com\/v3|js\.stripe\.com|paypal\.com\/sdk|braintreegateway\.com/,
    requirement: "Payment integrations process financial data and should be reviewed for PCI-DSS and applicable consumer-protection disclosure requirements.",
    severity: "medium",
    confidence: "medium",
    observedTemplate: (match) => `Payment processor integration detected: ${match}`,
    expectedBehavior: "Payment flows use HTTPS end-to-end and appropriate disclosures are shown before payment data collection.",
    remediation: "Confirm the payment flow is served over HTTPS and disclosures required by the applicable consumer-protection regime are present.",
  },
  {
    id: "static-insecure-resource-reference",
    pattern: /(?:src|href)\s*=\s*["']http:\/\/(?!localhost)/,
    requirement: "Resources referenced over plain HTTP on an otherwise HTTPS site create mixed-content and data-security risk.",
    severity: "high",
    confidence: "high",
    observedTemplate: (match) => `Insecure (http://) resource reference detected: ${match}`,
    expectedBehavior: "All resource references use HTTPS.",
    remediation: "Change the resource reference to https:// or a protocol-relative URL.",
  },
  {
    id: "static-missing-html-lang-attribute",
    pattern: /<html(?![^>]*\blang=)[^>]*>/i,
    requirement: "The <html> element must declare a lang attribute so assistive technology announces the correct language (WCAG 3.1.1).",
    severity: "medium",
    confidence: "high",
    observedTemplate: () => "An <html> tag without a 'lang' attribute was detected.",
    expectedBehavior: "<html lang=\"...\"> declares the page's primary language.",
    remediation: "Add a lang attribute (e.g. lang=\"en\") to the <html> element.",
  },
  {
    id: "static-image-missing-alt-attribute",
    pattern: /<img(?![^>]*\balt=)[^>]*>/i,
    requirement: "Images must have an alt attribute so assistive technology can convey their content or purpose (WCAG 1.1.1).",
    severity: "medium",
    confidence: "medium",
    observedTemplate: (match) => `<img> tag without an 'alt' attribute detected: ${match.slice(0, 120)}`,
    expectedBehavior: "Every <img> has an alt attribute (empty alt=\"\" for purely decorative images).",
    remediation: "Add a descriptive alt attribute, or alt=\"\" if the image is purely decorative.",
  },
];

function findLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

/**
 * Regex-based static analysis over source files. This is the fallback used
 * when the application cannot be started for live scanning, and a
 * complement to live scanning otherwise. It only ever reports "detected"
 * technical signals with evidence-only/informational framing - it never
 * asserts a legal violation on its own, since static text cannot confirm
 * runtime behavior (e.g. whether a script is actually consent-gated).
 */
export async function runStaticAnalysis(repoPath: string): Promise<Finding[]> {
  const files = walkFiles(repoPath, { extensions: SCANNED_EXTENSIONS, maxFiles: 3000 });
  const findings: Finding[] = [];
  let anyPrivacyLinkFound = false;

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (/privacy[- ]?policy|privacy[- ]?notice/i.test(content)) {
      anyPrivacyLinkFound = true;
    }

    for (const rule of PATTERN_RULES) {
      const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = globalPattern.exec(content)) !== null && count < 25) {
        count += 1;
        const line = findLineNumber(content, match.index);
        const relativePath = relative(repoPath, file);
        findings.push({
          ruleId: rule.id,
          packId: PACK_ID,
          regulation: REGULATION,
          jurisdiction: JURISDICTION,
          requirement: rule.requirement,
          status: "informational",
          severity: rule.severity,
          confidence: rule.confidence,
          automationLevel: "evidence-only",
          affectedUrl: undefined,
          affectedElement: relativePath,
          observedBehavior: rule.observedTemplate(match[0]),
          expectedBehavior: rule.expectedBehavior,
          evidence: [
            {
              type: "source-reference",
              description: `Match for ${rule.id}`,
              sourceFile: relativePath,
              sourceLine: line,
              data: match[0].slice(0, 200),
            },
          ],
          remediation: rule.remediation,
          manualReviewRequired: false,
        });
      }
    }
  }

  if (files.length > 0 && !anyPrivacyLinkFound) {
    findings.push({
      ruleId: "static-no-privacy-policy-reference-found",
      packId: PACK_ID,
      regulation: REGULATION,
      jurisdiction: JURISDICTION,
      requirement: "A privacy policy/notice reference should be discoverable somewhere in the application source.",
      status: "missing-disclosure",
      severity: "high",
      confidence: "low",
      automationLevel: "evidence-only",
      observedBehavior: `No text matching "privacy policy" / "privacy notice" was found across ${files.length} scanned source file(s).`,
      expectedBehavior: "A privacy policy link or reference exists somewhere in the application (footer, navigation, or route list).",
      evidence: [],
      remediation: "Add a Privacy Policy link/route, or verify it exists in a file type this scan did not cover.",
      manualReviewRequired: true,
    });
  }

  return findings;
}
