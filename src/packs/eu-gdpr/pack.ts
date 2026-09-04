import { classifyDomain, isNonEssentialTrackingCategory } from "../../utils/domainClassifier.js";
import { findTrackingStorage } from "../../utils/trackerStorage.js";
import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "eu-gdpr-eprivacy";
const REGULATION = "GDPR / ePrivacy Directive";
const JURISDICTION = "European Union";

/**
 * States which no-interaction visit saw a request, and how many were made.
 *
 * A site does not load the same trackers on every request, so "observed on
 * visit 1 of 2" is a materially different claim from "observed on every
 * visit". Saying which is what lets a reader reproduce the finding.
 */
function basisOf(flow: { beforeConsentVisits?: number } | null, requests: Array<{ visit?: number }>): string {
  const visits = flow?.beforeConsentVisits;
  if (!visits || visits < 2) return "";
  const seen = Array.from(new Set(requests.map((r) => r.visit).filter((v): v is number => v !== undefined))).sort();
  if (seen.length === 0) return ` The pre-consent state was measured over ${visits} independent no-interaction visits.`;
  if (seen.length === visits) return ` Seen on all ${visits} independent no-interaction visits.`;
  return ` Seen on ${seen.length} of ${visits} independent no-interaction visits (visit ${seen.join(", ")}); a site does not load the same trackers on every request.`;
}

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
      // A tracker the map names is a fact. A host classified only from a
      // `sync.`/`rtb.`/`pixel.` marker is a strong signal about the RTB tail
      // that no static list can enumerate - reported, but as a probable
      // violation that names the inference, not as an established one.
      //
      // Grouped by host: the pre-consent state is measured over several
      // independent visits, so one tracker seen on each of them would
      // otherwise produce one finding per visit and per request. It is one
      // fact about one recipient.
      const byHost = new Map<
        string,
        { classification: ReturnType<typeof classifyDomain>; requests: typeof page.consentFlow.requestsBeforeAnyConsentAction }
      >();
      for (const req of page.consentFlow.requestsBeforeAnyConsentAction) {
        const classification = classifyDomain(req.domain, req.url);
        if (!isNonEssentialTrackingCategory(classification.category)) continue;
        const entry = byHost.get(req.domain);
        if (entry) entry.requests.push(req);
        else byHost.set(req.domain, { classification, requests: [req] });
      }

      for (const [host, { classification, requests }] of byHost) {
        const inferred = classification.evidence === "inferred";
        findings.push(
          buildFinding(trackingBeforeConsent, PACK_ID, REGULATION, JURISDICTION, {
            status: inferred ? "probable-violation" : "violation",
            affectedUrl: page.url,
            affectedElement: host,
            observedBehavior: `${
              inferred
                ? `${requests.length} request(s) to ${host} observed before any consent action. The host is not a service this scanner names, but it carries ${classification.inferredFrom}, so it was classified ${classification.category} by pattern - confirm what it is.`
                : `${requests.length} request(s) to ${host} (${classification.service}, ${classification.category}) observed before any consent action.`
            }${basisOf(page.consentFlow, requests)}`,
            expectedBehavior: "No non-essential tracking requests before consent is given.",
            evidence: [context.evidence.requestLog(`Pre-consent requests to ${host}`, requests)],
            manualReviewRequired: inferred,
          })
        );
      }

      // Art. 5(3) ePrivacy prohibits the *storing of, or access to,*
      // information on the visitor's terminal equipment without consent. A
      // first-party analytics identifier written by a server-side tag never
      // shows up as a request to a tracker's domain, but it is the same act
      // and the same provision.
      const beforeConsent = page.consentFlow.states.find((state) => state.consentState === "before-consent");
      const storageOffenders = beforeConsent
        ? findTrackingStorage(beforeConsent).filter((entry) => isNonEssentialTrackingCategory(entry.category))
        : [];
      for (const entry of storageOffenders) {
        findings.push(
          buildFinding(trackingBeforeConsent, PACK_ID, REGULATION, JURISDICTION, {
            status: "violation",
            affectedUrl: page.url,
            affectedElement: `${entry.mechanism}: ${entry.key}`,
            observedBehavior: `${entry.service} wrote the identifier "${entry.key}" to ${entry.mechanism} before any consent action.`,
            expectedBehavior:
              "Nothing but strictly necessary information is stored on, or read from, the visitor's device before consent is given.",
            evidence: [context.evidence.note(`Pre-consent ${entry.mechanism} entry`, entry)],
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
        // Two different situations, and collapsing them loses the finding
        // that matters. Banner markup with no recognised control is a
        // detection limit; no banner markup at all, on a site that sets
        // non-essential cookies, is the site's own gap.
        const bannerSeen = page.consentFlow.bannerDetected;
        findings.push(
          buildFinding(rejectControlPresent, PACK_ID, REGULATION, JURISDICTION, {
            status: "manual-review",
            affectedUrl: page.url,
            observedBehavior:
              bannerSeen === true
                ? "Consent banner markup was present, but neither an accept nor a reject control could be identified within it by the configured heuristics."
                : bannerSeen === false
                  ? "No consent banner markup and no consent controls were found on this page."
                  : "No consent banner controls were detected by the configured selector heuristics; whether a banner was present was not established.",
            expectedBehavior: "A consent banner with accept/reject controls should be present if the site sets non-essential cookies.",
            evidence: [context.evidence.note("Consent banner detection", { bannerDetected: bannerSeen ?? "not-established" })],
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
            observedBehavior:
              "No link to a privacy notice was found on this page. Link text and href were both matched, in every language this scanner covers.",
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
      // A topic matched only by wording that is often incidental - "third
      // parties", a bare email address - is neither addressed nor absent.
      // Listing it separately is the difference between telling a reviewer
      // where to look and telling them something that is not true.
      const weak = doc.disclosures.filter((d) => d.status === "potentially-incomplete");
      if (missing.length > 0 || weak.length > 0) {
        const parts: string[] = [];
        if (missing.length > 0) {
          parts.push(`No language covering these topics was found: ${missing.map((m) => m.category).join(", ")}.`);
        }
        if (weak.length > 0) {
          parts.push(
            `Wording that may or may not address these was found, and needs reading in context: ${weak
              .map((m) => m.category)
              .join(", ")}.`
          );
        }
        findings.push(
          buildFinding(privacyPolicyDisclosures, PACK_ID, REGULATION, JURISDICTION, {
            status: "inconsistent",
            affectedUrl: doc.url,
            observedBehavior: parts.join(" "),
            expectedBehavior: "All GDPR Art. 13/14 disclosure categories are addressed in the privacy policy.",
            manualReviewRequired: true,
            evidence: [context.evidence.note("Disclosure keyword scan", { textLength: doc.textLength, missing, weak })],
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
