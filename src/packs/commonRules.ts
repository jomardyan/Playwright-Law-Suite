import { classifyDomain, isNonEssentialTrackingCategory } from "../utils/domainClassifier.js";
import { findTrackingStorage } from "../utils/trackerStorage.js";
import type { Confidence, Finding, Rule, Severity } from "../engine/types.js";
import { buildFinding, defineRule } from "./helpers.js";

/**
 * Factories for the rule shapes that recur across data-protection regimes.
 *
 * Most modern privacy laws ask structurally similar questions of a website -
 * is there a notice, is non-essential tracking gated behind consent, can
 * consent be withdrawn, is a contact published. The *detection* is therefore
 * shared, but nothing legal is: every factory requires the calling pack to
 * state its own severity, confidence, automation level, legal reference and
 * remediation. A pack never inherits a legal judgement it did not make, and
 * a regime that treats something differently simply does not use the factory.
 */

export interface PackIdentity {
  packId: string;
  regulation: string;
  jurisdiction: string;
}

/** Legal framing a pack must supply for any shared rule it adopts. */
export interface RuleFraming {
  id: string;
  requirement: string;
  severity: Severity;
  confidence: Confidence;
  legalReference: string;
  remediation: string;
}

/** A privacy notice must be discoverable from the pages a visitor lands on. */
export function privacyNoticePresentRule(identity: PackIdentity, framing: RuleFraming): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "fully-automated",
    run: (context) => {
      const findings: Finding[] = [];
      for (const page of context.pages) {
        const notice = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
        if (notice?.url) continue;
        findings.push(
          buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
            status: "missing-disclosure",
            affectedUrl: page.url,
            observedBehavior: "No privacy notice or policy link was found on this page.",
            expectedBehavior: "A privacy notice is discoverable from every page a visitor can land on.",
            manualReviewRequired: false,
          })
        );
      }
      return findings;
    },
  });
  return rule;
}

/**
 * Non-essential trackers must not fire before the visitor opts in. Only for
 * regimes that actually require prior opt-in - an opt-out or
 * notice-and-choice regime must not use this.
 */
export function trackingBeforeConsentRule(identity: PackIdentity, framing: RuleFraming): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "fully-automated",
    run: (context) => {
      const findings: Finding[] = [];
      for (const page of context.pages) {
        if (!page.consentFlow) continue;
        const offenders = page.consentFlow.requestsBeforeAnyConsentAction.filter((request) =>
          isNonEssentialTrackingCategory(classifyDomain(request.domain).category)
        );
        // Storage counts as much as traffic. Art. 5(3) ePrivacy and its
        // equivalents govern the storing of, and access to, information on
        // the visitor's device - so a first-party `_ga` written by a
        // server-side tag is the same act as a request to
        // google-analytics.com, and a request-only check misses exactly the
        // deployments built not to be seen.
        const beforeConsent = page.consentFlow.states.find((state) => state.consentState === "before-consent");
        const storageOffenders = beforeConsent
          ? findTrackingStorage(beforeConsent).filter((entry) => isNonEssentialTrackingCategory(entry.category))
          : [];
        if (offenders.length === 0 && storageOffenders.length === 0) continue;

        const domains = Array.from(new Set(offenders.map((request) => request.domain)));
        const observed: string[] = [];
        if (offenders.length > 0) {
          observed.push(
            `${offenders.length} request(s) to non-essential third-party services fired before any consent action: ${domains.join(", ")}.`
          );
        }
        if (storageOffenders.length > 0) {
          observed.push(
            `${storageOffenders.length} tracking identifier(s) were written to the device before any consent action: ${storageOffenders
              .map((entry) => `${entry.key} (${entry.mechanism}, ${entry.service})`)
              .join(", ")}.`
          );
        }

        const evidence = [];
        if (offenders.length > 0) evidence.push(context.evidence.requestLog("Pre-consent third-party requests", offenders));
        if (storageOffenders.length > 0) evidence.push(context.evidence.note("Pre-consent tracking storage", storageOffenders));

        findings.push(
          buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
            status: "violation",
            affectedUrl: page.url,
            affectedElement: domains.join(", ") || storageOffenders.map((entry) => entry.key).join(", "),
            observedBehavior: observed.join(" "),
            expectedBehavior: "No non-essential tracking, and no non-essential storage on the device, before the visitor opts in.",
            evidence,
            manualReviewRequired: false,
          })
        );
      }
      return findings;
    },
  });
  return rule;
}

/** Refusing must be offered alongside accepting, on the first layer. */
export function rejectControlRule(identity: PackIdentity, framing: RuleFraming): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "partially-automated",
    run: (context) => {
      const findings: Finding[] = [];
      for (const page of context.pages) {
        const flow = page.consentFlow;
        if (!flow) continue;
        if (!flow.bannerAcceptControlFound || flow.bannerRejectControlFound) continue;
        findings.push(
          buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
            status: "probable-violation",
            affectedUrl: page.url,
            observedBehavior:
              "An accept control was detected on the consent banner, but no equivalent control to refuse was found.",
            expectedBehavior: "Refusing is offered on the same layer, and is no harder than accepting.",
            evidence: [
              context.evidence.note("Consent control detection", {
                acceptFound: flow.bannerAcceptControlFound,
                rejectFound: flow.bannerRejectControlFound,
              }),
            ],
          })
        );
      }
      return findings;
    },
  });
  return rule;
}

/** Withdrawing consent must be as easy as giving it. */
export function consentWithdrawalRule(identity: PackIdentity, framing: RuleFraming): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "partially-automated",
    run: (context) => {
      const findings: Finding[] = [];
      for (const page of context.pages) {
        const flow = page.consentFlow;
        if (!flow?.bannerAcceptControlFound || flow.withdrawalControlFound) continue;
        findings.push(
          buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
            status: "probable-violation",
            affectedUrl: page.url,
            observedBehavior:
              "Consent could be given in one click, but no equivalent route to withdraw it was reachable afterwards.",
            expectedBehavior: "Withdrawing consent is as easy as giving it.",
            evidence: [
              context.evidence.consentSequence("Consent states captured", flow.states.map((state) => state.consentState)),
            ],
          })
        );
      }
      return findings;
    },
  });
  return rule;
}

/** A pre-ticked box is not consent under any opt-in regime. */
export function preCheckedConsentRule(identity: PackIdentity, framing: RuleFraming): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "fully-automated",
    run: (context) => {
      const findings: Finding[] = [];
      for (const page of context.pages) {
        for (const form of page.forms) {
          for (const checkbox of form.consentCheckboxes.filter((entry) => entry.preChecked)) {
            findings.push(
              buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
                status: "violation",
                affectedUrl: page.url,
                affectedElement: `form[${form.formIndex}] checkbox: ${checkbox.label}`,
                observedBehavior: `A consent checkbox labelled "${checkbox.label}" is pre-ticked on page load.`,
                expectedBehavior: "Consent checkboxes are unchecked until the visitor ticks them.",
                evidence: [context.evidence.domFragment("Pre-checked consent control", checkbox.label)],
                manualReviewRequired: false,
              })
            );
          }
        }
      }
      return findings;
    },
  });
  return rule;
}

/**
 * The published notice must address the topics the regime requires. Keyword
 * presence is evidence a topic is *mentioned*, never that its legal substance
 * is adequate, so this is always reported for review rather than as a breach.
 */
export function noticeContentsRule(
  identity: PackIdentity,
  framing: RuleFraming,
  requiredDisclosures: readonly string[]
): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "partially-automated",
    run: (context) => {
      const findings: Finding[] = [];
      const seen = new Set<string>();
      for (const page of context.pages) {
        const notice = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
        if (!notice?.url || seen.has(notice.url)) continue;
        seen.add(notice.url);

        if (notice.textLength === 0) {
          findings.push(
            buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
              status: "not-evaluated",
              affectedUrl: notice.url,
              observedBehavior:
                "The linked notice could not be fetched, or contained no readable text, so its contents were not assessed.",
              expectedBehavior: "The notice is readable and addresses every required topic.",
              manualReviewRequired: true,
            })
          );
          continue;
        }

        // A topic matched only by weak wording is reported as weak, not as
        // absent. "third parties" appears in "we never share your data with
        // third parties" just as readily as in a recipients disclosure, so
        // treating a weak hit as a gap manufactured a review item on notices
        // that address the topic, and treating it as a pass hid the ones that
        // do not. Both are named, and kept apart.
        const missing = requiredDisclosures.filter((category) =>
          notice.disclosures.some((entry) => entry.category === category && entry.status === "missing")
        );
        const weak = requiredDisclosures.filter((category) =>
          notice.disclosures.some((entry) => entry.category === category && entry.status === "potentially-incomplete")
        );
        if (missing.length === 0 && weak.length === 0) continue;

        const parts: string[] = [];
        if (missing.length > 0) {
          parts.push(`No language covering the following was found: ${missing.join(", ")}.`);
        }
        if (weak.length > 0) {
          parts.push(
            `Wording that may or may not address the following was found, and needs reading in context: ${weak.join(", ")}.`
          );
        }
        parts.push("Wording varies, so this is a prompt to check the notice rather than a conclusion about it.");

        findings.push(
          buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
            status: "manual-review",
            affectedUrl: notice.url,
            observedBehavior: parts.join(" "),
            expectedBehavior: "The notice addresses every topic the regime requires.",
            evidence: [context.evidence.note("Disclosure detection", notice.disclosures)],
            manualReviewRequired: true,
          })
        );
      }
      return findings;
    },
  });
  return rule;
}

/**
 * Transfers abroad. Whether a lawful transfer mechanism is in place cannot be
 * seen from a browser, so third-party recipients are surfaced as evidence for
 * a person to assess.
 */
export function crossBorderTransferRule(identity: PackIdentity, framing: RuleFraming): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "evidence-only",
    run: (context) => {
      const domains = Array.from(new Set(context.thirdPartyServices.map((record) => record.domain)));
      if (domains.length === 0) return [];
      const page = context.pages[0];
      if (!page) return [];
      return [
        buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
          status: "manual-review",
          affectedUrl: page.url,
          observedBehavior: `Personal data may reach ${domains.length} third-party domain(s): ${domains.slice(0, 12).join(", ")}${domains.length > 12 ? ", ..." : ""}. Where each recipient processes the data, and whether a lawful transfer mechanism covers it, cannot be determined from the browser.`,
          expectedBehavior:
            "Every transfer out of the jurisdiction is covered by a lawful transfer mechanism, and disclosed in the notice.",
          evidence: [context.evidence.note("Third-party recipients observed", domains)],
          manualReviewRequired: true,
        }),
      ];
    },
  });
  return rule;
}

/** A named contact, representative, or officer must be reachable. */
export function contactPublishedRule(identity: PackIdentity, framing: RuleFraming): Rule {
  const rule = defineRule({
    ...framing,
    automationLevel: "partially-automated",
    run: (context) => {
      const findings: Finding[] = [];
      const seen = new Set<string>();
      for (const page of context.pages) {
        const notice = page.privacyDocuments.find((doc) => doc.label === "privacy-policy");
        if (!notice?.url || notice.textLength === 0 || seen.has(notice.url)) continue;
        seen.add(notice.url);
        const contactEntries = notice.disclosures.filter(
          (entry) => entry.category === "controller-contact" || entry.category === "dpo-information"
        );
        if (contactEntries.some((entry) => entry.status === "detected")) continue;
        // A weak match - an email address somewhere in the notice, with
        // nothing tying it to privacy enquiries - is not proof the contact is
        // published, but it is not proof it is missing either.
        const weakOnly = contactEntries.some((entry) => entry.status === "potentially-incomplete");
        if (weakOnly) {
          findings.push(
            buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
              status: "manual-review",
              affectedUrl: notice.url,
              observedBehavior:
                "The notice carries contact details, but nothing identifies them as the route for privacy enquiries.",
              expectedBehavior: "A named, reachable contact for privacy enquiries is published.",
              evidence: [context.evidence.note("Contact-related disclosure detection", notice.disclosures)],
              manualReviewRequired: true,
            })
          );
          continue;
        }
        findings.push(
          buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
            status: "missing-disclosure",
            affectedUrl: notice.url,
            observedBehavior: "The published notice does not appear to name a contact for privacy enquiries.",
            expectedBehavior: "A named, reachable contact for privacy enquiries is published.",
            evidence: [context.evidence.note("Contact-related disclosure detection", notice.disclosures)],
          })
        );
      }
      return findings;
    },
  });
  return rule;
}

/**
 * Sensitive-category fields collected by a form. Whether the heightened
 * condition the regime attaches to them is met is a legal question, so this
 * always reports for review.
 */
export function sensitiveDataFormRule(
  identity: PackIdentity,
  framing: RuleFraming,
  categories: readonly string[] = ["health", "biometric", "location", "identification-number", "financial"]
): Rule {
  const sensitive = new Set(categories);
  const rule = defineRule({
    ...framing,
    automationLevel: "manual-review-required",
    run: (context) => {
      const findings: Finding[] = [];
      for (const page of context.pages) {
        for (const form of page.forms) {
          const fields = form.fields.filter((field) => field.category && sensitive.has(field.category));
          if (fields.length === 0) continue;
          findings.push(
            buildFinding(rule, identity.packId, identity.regulation, identity.jurisdiction, {
              status: "manual-review",
              affectedUrl: page.url,
              affectedElement: `form[${form.formIndex}]`,
              observedBehavior: `A form collects field(s) in sensitive categories (${fields
                .map((field) => `${field.name}:${field.category}`)
                .join(", ")}). Whether the heightened condition for them is met is a legal determination.`,
              expectedBehavior: "Sensitive-category processing meets the heightened condition the regime attaches to it.",
              evidence: [context.evidence.note("Sensitive form fields", fields)],
              manualReviewRequired: true,
            })
          );
        }
      }
      return findings;
    },
  });
  return rule;
}

/** Builds the `applicability` predicate for a jurisdiction-specific pack. */
export function jurisdictionMatcher(pattern: RegExp) {
  return (config: { jurisdictions: string[]; customerMarkets?: string[] }): boolean =>
    config.jurisdictions.some((jurisdiction) => pattern.test(jurisdiction)) ||
    (config.customerMarkets ?? []).some((market) => pattern.test(market));
}
