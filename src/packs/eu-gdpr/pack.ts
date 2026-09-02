import { classifyDomain } from "../../utils/domainClassifier.js";
import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "eu-gdpr-eprivacy";
const REGULATION = "GDPR / ePrivacy Directive";
const JURISDICTION = "European Union";
const TRACKING_CATEGORIES = new Set(["analytics", "advertising", "session-recording"]);

const trackingBeforeConsent = defineRule({
  id: "gdpr-eprivacy-tracking-before-consent",
  requirement: "Non-essential cookies/trackers (analytics, advertising, session recording) must not load before the visitor gives consent.",
  severity: "critical",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "ePrivacy Directive Art. 5(3); GDPR Art. 6, 7",
  remediation: "Gate non-essential scripts behind the consent management platform so they only fire after explicit opt-in.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      if (!page.consentFlow) continue;
      const offenders = page.consentFlow.requestsBeforeAnyConsentAction.filter((req) => {
        const { category } = classifyDomain(req.domain);
        return TRACKING_CATEGORIES.has(category);
      });
      for (const offender of offenders) {
        findings.push(
          buildFinding(trackingBeforeConsent, PACK_ID, REGULATION, JURISDICTION, {
            status: "violation",
            affectedUrl: page.url,
            affectedElement: offender.domain,
            observedBehavior: `Request to ${offender.domain} (${classifyDomain(offender.domain).category}) observed before any consent action.`,
            expectedBehavior: "No non-essential tracking requests before consent is given.",
            evidence: [context.evidence.requestLog(`Pre-consent request to ${offender.domain}`, [offender])],
          })
        );
      }
    }
    return findings;
  },
});

const rejectControlPresent = defineRule({
  id: "gdpr-eprivacy-reject-control-present",
  requirement: "The consent banner must offer a control to reject non-essential processing that is at least as accessible as the accept control.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "EDPB Guidelines 03/2022 on Dark Patterns; ePrivacy Directive Art. 5(3)",
  remediation: "Add a clearly visible 'Reject all' control on the first layer of the consent banner.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      if (!page.consentFlow) continue;
      if (page.consentFlow.bannerAcceptControlFound && !page.consentFlow.bannerRejectControlFound) {
        findings.push(
          buildFinding(rejectControlPresent, PACK_ID, REGULATION, JURISDICTION, {
            status: "probable-violation",
            affectedUrl: page.url,
            observedBehavior: "An 'accept all' control was detected but no equivalent 'reject all' control was found by heuristic matching.",
            expectedBehavior: "A reject-all control exists and is no harder to use than accept-all.",
            evidence: [context.evidence.note("Consent control detection", {
              acceptFound: page.consentFlow.bannerAcceptControlFound,
              rejectFound: page.consentFlow.bannerRejectControlFound,
            })],
          })
        );
      } else if (!page.consentFlow.bannerAcceptControlFound && !page.consentFlow.bannerRejectControlFound) {
        findings.push(
          buildFinding(rejectControlPresent, PACK_ID, REGULATION, JURISDICTION, {
            status: "manual-review",
            affectedUrl: page.url,
            observedBehavior: "No consent banner controls were detected by the configured selector heuristics.",
            expectedBehavior: "A consent banner with accept/reject controls should be present if the site sets non-essential cookies.",
            manualReviewRequired: true,
          })
        );
      }
    }
    return findings;
  },
});

const withdrawalAvailable = defineRule({
  id: "gdpr-consent-withdrawal-available",
  requirement: "It must be as easy to withdraw consent as it was to give it.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "GDPR Art. 7(3)",
  remediation: "Provide a persistent 'cookie settings' / 'privacy settings' control that lets visitors withdraw consent at any time.",
  applicable: (context) => context.config.consent.testWithdrawal !== false,
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      if (!page.consentFlow) continue;
      if (!page.consentFlow.withdrawalControlFound) {
        findings.push(
          buildFinding(withdrawalAvailable, PACK_ID, REGULATION, JURISDICTION, {
            status: "risk",
            affectedUrl: page.url,
            observedBehavior: "No 'manage cookies' / 'privacy settings' control was found after granting consent.",
            expectedBehavior: "A persistent control allows withdrawing previously granted consent.",
          })
        );
      }
    }
    return findings;
  },
});

const privacyPolicyPresent = defineRule({
  id: "gdpr-privacy-policy-present",
  requirement: "A privacy policy/notice must be discoverable from the scanned pages.",
  severity: "critical",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "GDPR Art. 13, 14",
  remediation: "Add a clearly labeled 'Privacy Policy' link in the site footer and at data collection points.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy");
      if (!doc?.url) {
        findings.push(
          buildFinding(privacyPolicyPresent, PACK_ID, REGULATION, JURISDICTION, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "No link matching 'Privacy Policy'/'Privacy Notice' was found on this page.",
            expectedBehavior: "A privacy policy link is discoverable from every page, typically in the footer.",
          })
        );
      }
    }
    return findings;
  },
});

const privacyPolicyDisclosures = defineRule({
  id: "gdpr-privacy-policy-disclosures",
  requirement: "The privacy policy should address the disclosure categories required by GDPR Art. 13/14 (controller identity, purposes, legal basis, retention, rights, etc.).",
  severity: "medium",
  confidence: "low",
  automationLevel: "evidence-only",
  legalReference: "GDPR Art. 13, 14",
  remediation: "Review the privacy policy against the missing categories below with legal counsel; keyword absence is not proof of non-compliance.",
  run: (context) => {
    const findings = [];
    const seenPages = new Set<string>();
    for (const page of context.pages) {
      const doc = page.privacyDocuments.find((d) => d.label === "privacy-policy" && d.url);
      if (!doc?.url || seenPages.has(doc.url)) continue;
      seenPages.add(doc.url);
      const missing = doc.disclosures.filter((d) => d.status === "missing");
      if (missing.length > 0) {
        findings.push(
          buildFinding(privacyPolicyDisclosures, PACK_ID, REGULATION, JURISDICTION, {
            status: "inconsistent",
            affectedUrl: doc.url,
            observedBehavior: `Keyword scan did not find expected language for: ${missing.map((m) => m.category).join(", ")}.`,
            expectedBehavior: "All GDPR Art. 13/14 disclosure categories are addressed in the privacy policy.",
            manualReviewRequired: true,
            evidence: [context.evidence.note("Disclosure keyword scan", { textLength: doc.textLength, missing })],
          })
        );
      }
    }
    return findings;
  },
});

const consentNotPrechecked = defineRule({
  id: "gdpr-consent-checkbox-not-prechecked",
  requirement: "Consent checkboxes (marketing, newsletter, optional processing) must not be pre-checked.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "GDPR Art. 4(11), 7(1); CJEU Planet49 (C-673/17)",
  remediation: "Default all optional consent checkboxes to unchecked.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const form of page.forms) {
        for (const checkbox of form.consentCheckboxes) {
          if (checkbox.preChecked) {
            findings.push(
              buildFinding(consentNotPrechecked, PACK_ID, REGULATION, JURISDICTION, {
                status: "violation",
                affectedUrl: page.url,
                affectedElement: checkbox.label,
                observedBehavior: `Consent checkbox "${checkbox.label}" is pre-checked by default.`,
                expectedBehavior: "Consent checkboxes default to unchecked and require an affirmative action.",
              })
            );
          }
          if (checkbox.purposeBundled) {
            findings.push(
              buildFinding(consentNotPrechecked, PACK_ID, REGULATION, JURISDICTION, {
                status: "probable-violation",
                affectedUrl: page.url,
                affectedElement: checkbox.label,
                observedBehavior: `Consent checkbox "${checkbox.label}" appears to bundle multiple purposes (e.g. marketing and required terms) into one control.`,
                expectedBehavior: "Distinct processing purposes require distinct, granular consent.",
              })
            );
          }
        }
      }
    }
    return findings;
  },
});

export const euGdprEprivacyPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "EU",
  regulation: REGULATION,
  authority: "European Data Protection Board / National DPAs",
  version: "1.0.0",
  effectiveDate: "2018-05-25",
  applicability: (config) =>
    config.jurisdictions.some((j) => /^eu$/i.test(j) || /european union/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /^eu$/i.test(m) || /european union/i.test(m)),
  rules: [
    trackingBeforeConsent,
    rejectControlPresent,
    withdrawalAvailable,
    privacyPolicyPresent,
    privacyPolicyDisclosures,
    consentNotPrechecked,
  ] as Rule[],
};
