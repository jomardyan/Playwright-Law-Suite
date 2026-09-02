import { classifyDomain } from "../../utils/domainClassifier.js";
import type { CapturedState, RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "us-state-privacy";
const REGULATION = "US state comprehensive consumer privacy laws (universal opt-out mechanisms)";
const JURISDICTION = "United States - multi-state";

/**
 * States whose comprehensive privacy statutes or implementing regulations
 * require a controller to honour a universal opt-out mechanism such as
 * Global Privacy Control. California is covered by its own dedicated pack
 * (`us-ca-ccpa-cpra`) and is listed here only because a UOOM signal is not
 * addressable per state - one browser signal reaches every one of them.
 */
export const UOOM_STATES = [
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "Maryland",
  "Minnesota",
  "Montana",
  "Nebraska",
  "New Hampshire",
  "New Jersey",
  "Oregon",
  "Texas",
] as const;

const STATE_PATTERN =
  /united states|u\.s\.|usa|california|colorado|connecticut|delaware|maryland|minnesota|montana|nebraska|new hampshire|new jersey|oregon|texas|virginia|utah|iowa|indiana|kentucky|rhode island|tennessee|florida/i;

const TARGETED_ADVERTISING_CATEGORIES = new Set(["advertising", "session-recording"]);

function stateFor(states: CapturedState[], name: CapturedState["consentState"]): CapturedState | undefined {
  return states.find((state) => state.consentState === name);
}

const gpcHonoured = defineRule({
  id: "us-state-gpc-signal-honoured",
  requirement:
    "A controller must treat a universal opt-out mechanism (Global Privacy Control) as a valid request to stop selling personal data and to stop processing it for targeted advertising.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference:
    "Cal. Civ. Code 1798.135(b) and 11 CCR 7025; Colo. Rev. Stat. 6-1-1313 and 4 CCR 904-3 Rule 5; Conn. Gen. Stat. 42-518(e); N.J.S.A. 56:8-166.10; Tex. Bus. & Com. Code 541.055; Or. Rev. Stat. 646A.578",
  remediation:
    "Read the `Sec-GPC` request header and `navigator.globalPrivacyControl` on entry, and suppress sale/share and targeted-advertising tags for that visitor without requiring any further interaction.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow) continue;

      if (!flow.gpcProbeRan) {
        findings.push(
          buildFinding(gpcHonoured, PACK_ID, REGULATION, JURISDICTION, {
            status: "not-evaluated",
            affectedUrl: page.url,
            observedBehavior:
              "The Global Privacy Control probe did not run (consent.probeGlobalPrivacyControl is disabled), so whether the signal is honoured is unknown.",
            expectedBehavior: "A visit asserting GPC does not trigger sale/share or targeted-advertising processing.",
            manualReviewRequired: true,
          })
        );
        continue;
      }

      const gpcState = stateFor(flow.states, "gpc-signal");
      if (!gpcState) continue;

      const offenders = gpcState.thirdPartyRequests.filter((req) =>
        TARGETED_ADVERTISING_CATEGORIES.has(classifyDomain(req.domain).category)
      );
      if (offenders.length === 0) continue;

      const domains = Array.from(new Set(offenders.map((req) => req.domain)));
      findings.push(
        buildFinding(gpcHonoured, PACK_ID, REGULATION, JURISDICTION, {
          status: "probable-violation",
          affectedUrl: page.url,
          affectedElement: domains.join(", "),
          observedBehavior: `A visit sending 'Sec-GPC: 1' and exposing navigator.globalPrivacyControl still triggered ${offenders.length} request(s) to advertising or session-recording domains: ${domains.join(", ")}.`,
          expectedBehavior:
            "No sale/share or targeted-advertising processing occurs for a visitor asserting a universal opt-out signal.",
          evidence: [
            context.evidence.requestLog("Third-party requests observed while GPC was asserted", offenders),
            context.evidence.note("States compared", { probe: "gpc-signal", statesCaptured: flow.states.map((s) => s.consentState) }),
          ],
        })
      );
    }
    return findings;
  },
});

const gpcVsBaseline = defineRule({
  id: "us-state-gpc-changes-nothing",
  requirement:
    "Asserting a universal opt-out mechanism must produce a materially different outcome from a visit that asserts nothing; identical behaviour indicates the signal is not being read.",
  severity: "medium",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "11 CCR 7025(c); 4 CCR 904-3 Rule 5.06; Conn. Gen. Stat. 42-518(e)",
  remediation:
    "Verify the signal is read server-side or by the tag manager on first load, rather than only surfaced as a pre-set toggle inside a preference centre the visitor never opens.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const flow = page.consentFlow;
      if (!flow?.gpcProbeRan) continue;
      const gpcState = stateFor(flow.states, "gpc-signal");
      const baseline = stateFor(flow.states, "before-consent");
      if (!gpcState || !baseline) continue;

      const advertisingDomains = (state: CapturedState) =>
        new Set(
          state.thirdPartyRequests
            .filter((req) => TARGETED_ADVERTISING_CATEGORIES.has(classifyDomain(req.domain).category))
            .map((req) => req.domain)
        );

      const withGpc = advertisingDomains(gpcState);
      const withoutGpc = advertisingDomains(baseline);
      if (withoutGpc.size === 0) continue;
      const identical = withGpc.size === withoutGpc.size && Array.from(withoutGpc).every((d) => withGpc.has(d));
      if (!identical) continue;

      findings.push(
        buildFinding(gpcVsBaseline, PACK_ID, REGULATION, JURISDICTION, {
          status: "inconsistent",
          affectedUrl: page.url,
          observedBehavior: `The set of advertising/session-recording domains contacted is identical with and without the GPC signal (${Array.from(withoutGpc).join(", ")}), which suggests the signal is not being read.`,
          expectedBehavior: "The GPC visit suppresses sale/share and targeted-advertising processing.",
          evidence: [
            context.evidence.note("Advertising domains by consent state", {
              "before-consent": Array.from(withoutGpc),
              "gpc-signal": Array.from(withGpc),
            }),
          ],
        })
      );
    }
    return findings;
  },
});

const optOutMechanismDisclosed = defineRule({
  id: "us-state-opt-out-mechanism-disclosed",
  requirement:
    "A privacy notice must tell consumers how to exercise their opt-out rights, including how the controller responds to a universal opt-out mechanism.",
  severity: "medium",
  confidence: "low",
  automationLevel: "partially-automated",
  legalReference:
    "Colo. Rev. Stat. 6-1-1308(1); Conn. Gen. Stat. 42-520(c); Tex. Bus. & Com. Code 541.102; Cal. Civ. Code 1798.130(a)(5)",
  remediation:
    "State in the privacy notice which universal opt-out mechanisms are honoured, at what scope (browser, device, or account), and how a consumer can confirm the opt-out took effect.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const optOutLink = page.privacyDocuments.find((doc) => doc.label === "do-not-sell" && doc.url);
      const rightsLink = page.privacyDocuments.find((doc) => doc.label === "data-rights" && doc.url);
      const sellsOrShares = (page.consentFlow?.requestsBeforeAnyConsentAction ?? []).some(
        (req) => classifyDomain(req.domain).category === "advertising"
      );
      if (!sellsOrShares || optOutLink || rightsLink) continue;
      findings.push(
        buildFinding(optOutMechanismDisclosed, PACK_ID, REGULATION, JURISDICTION, {
          status: "missing-disclosure",
          affectedUrl: page.url,
          observedBehavior:
            "Advertising third parties load on this page, but no opt-out or consumer-rights link was found from which a consumer could exercise an opt-out.",
          expectedBehavior:
            "An opt-out route and a description of universal-opt-out handling are reachable from the page.",
        })
      );
    }
    return findings;
  },
});

const sensitiveDataOptIn = defineRule({
  id: "us-state-sensitive-data-opt-in",
  requirement:
    "Most state comprehensive privacy laws require opt-in consent before processing sensitive data (including precise geolocation, health, and biometric data); a few instead require an opt-out.",
  severity: "high",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference:
    "Colo. Rev. Stat. 6-1-1308(7); Conn. Gen. Stat. 42-520(a)(4); Va. Code 59.1-578(A)(5); Tex. Bus. & Com. Code 541.101(b)(4)",
  remediation:
    "Gate collection of sensitive-category fields behind affirmative opt-in consent in the states that require it, and document the lawful basis and retention period for each category.",
  run: (context) => {
    const findings = [];
    const sensitiveCategories = new Set(["health", "biometric", "location", "identification-number", "financial"]);
    for (const page of context.pages) {
      for (const form of page.forms) {
        const sensitive = form.fields.filter((field) => field.category && sensitiveCategories.has(field.category));
        if (sensitive.length === 0) continue;
        findings.push(
          buildFinding(sensitiveDataOptIn, PACK_ID, REGULATION, JURISDICTION, {
            status: "manual-review",
            affectedUrl: page.url,
            affectedElement: `form[${form.formIndex}]`,
            observedBehavior: `A form collects field(s) in sensitive categories (${sensitive
              .map((f) => `${f.name}:${f.category}`)
              .join(", ")}). Whether opt-in consent is obtained where required is a legal determination.`,
            expectedBehavior:
              "Sensitive-category processing is preceded by opt-in consent in the states that require it.",
            evidence: [context.evidence.note("Sensitive form fields", sensitive)],
            manualReviewRequired: true,
          })
        );
      }
    }
    return findings;
  },
});

export const usStatePrivacyPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "US",
  regulation: REGULATION,
  authority: "State attorneys general; California Privacy Protection Agency",
  version: "1.0.0",
  effectiveDate: "2026-01-01",
  applicability: (config) =>
    config.jurisdictions.some((j) => STATE_PATTERN.test(j)) ||
    (config.customerMarkets ?? []).some((m) => STATE_PATTERN.test(m)),
  rules: [gpcHonoured, gpcVsBaseline, optOutMechanismDisclosed, sensitiveDataOptIn] as Rule[],
};
