import type { Finding, RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "eu-consumer-rights";
const REGULATION = "EU Consumer Rights Directive 2011/83/EU (as amended by (EU) 2023/2673) / UCPD / DSA Art. 25";
const JURISDICTION = "European Union";

const withdrawalFunction = defineRule({
  id: "crd-withdrawal-function-present",
  requirement:
    "For distance contracts concluded online, the trader must provide a withdrawal function - a clearly labelled control that lets the consumer end the contract as easily as it was entered into.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference:
    "Directive 2011/83/EU Art. 11a, inserted by Directive (EU) 2023/2673 (applies from 19 June 2026); Art. 11(1)",
  remediation:
    "Add a permanently available, clearly labelled withdrawal/cancel control on the account or subscription management surface, reachable without contacting support, and confirm the withdrawal on a durable medium.",
  run: (context) => {
    const findings: Finding[] = [];
    const subscriptionPages = context.pages.filter((page) => page.consumerJourney?.isSubscriptionSurface);
    if (subscriptionPages.length === 0) return findings;

    const anyWithdrawalControl = context.pages.some(
      (page) => (page.consumerJourney?.withdrawalControls.length ?? 0) > 0
    );
    if (anyWithdrawalControl) return findings;

    findings.push(
      buildFinding(withdrawalFunction, PACK_ID, REGULATION, JURISDICTION, {
        status: "probable-violation",
        affectedUrl: subscriptionPages[0].url,
        observedBehavior: `${subscriptionPages.length} page(s) look like a paid subscription or sign-up surface, but no control labelled as cancelling or withdrawing from a contract was found on any scanned page.`,
        expectedBehavior:
          "A clearly labelled withdrawal/cancellation control is available to the consumer online.",
        evidence: [
          context.evidence.note(
            "Subscription surfaces detected",
            subscriptionPages.map((page) => ({ url: page.url, autoRenewal: page.consumerJourney?.autoRenewalDisclosures }))
          ),
        ],
      })
    );
    return findings;
  },
});

const orderButtonLabelling = defineRule({
  id: "crd-order-button-payment-obligation",
  requirement:
    "The control that concludes an order must be labelled unambiguously with the payment obligation - 'order with obligation to pay' or a comparably explicit formulation.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Directive 2011/83/EU Art. 8(2), second subparagraph",
  remediation:
    "Relabel the order control so the payment obligation is explicit (for example 'Buy now' or 'Order with obligation to pay'), rather than a neutral 'Continue' or 'Confirm'.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const ambiguous = page.consumerJourney?.ambiguousOrderButtons ?? [];
      for (const control of ambiguous) {
        findings.push(
          buildFinding(orderButtonLabelling, PACK_ID, REGULATION, JURISDICTION, {
            status: "probable-violation",
            affectedUrl: page.url,
            affectedElement: `${control.tag}: ${control.text}`,
            observedBehavior: `The order control is labelled "${control.text}", which does not state that placing the order carries an obligation to pay.`,
            expectedBehavior:
              "The order control's label makes the payment obligation explicit.",
            evidence: [context.evidence.domFragment("Order control label", control.text)],
          })
        );
      }
    }
    return findings;
  },
});

const autoRenewalTransparency = defineRule({
  id: "crd-auto-renewal-disclosure",
  requirement:
    "Before the consumer is bound, the trader must give the pre-contractual information for the contract, including its duration, the conditions for terminating it, and any automatic renewal.",
  severity: "medium",
  confidence: "low",
  automationLevel: "partially-automated",
  legalReference: "Directive 2011/83/EU Art. 6(1)(o) and 6(1)(p); Directive 93/13/EEC on unfair contract terms",
  remediation:
    "State the renewal cadence, the amount that will be charged, and how to stop the renewal, on the same surface as the sign-up control rather than only in the terms.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const journey = page.consumerJourney;
      if (!journey?.isSubscriptionSurface) continue;
      if (journey.autoRenewalDisclosures.length > 0) continue;
      if (journey.orderButtons.length === 0) continue;
      findings.push(
        buildFinding(autoRenewalTransparency, PACK_ID, REGULATION, JURISDICTION, {
          status: "manual-review",
          affectedUrl: page.url,
          observedBehavior:
            "A paid sign-up control was found on a subscription surface, but no text describing renewal cadence or automatic renewal was detected on the same page.",
          expectedBehavior:
            "Contract duration, renewal terms, and termination conditions are given before the consumer is bound.",
          evidence: [
            context.evidence.note("Order controls on subscription surface", journey.orderButtons.map((b) => b.text)),
          ],
          manualReviewRequired: true,
        })
      );
    }
    return findings;
  },
});

const manipulativeDesign = defineRule({
  id: "ucpd-dsa-manipulative-design-signals",
  requirement:
    "An interface must not distort or impair the consumer's ability to make a free and informed decision, including through false urgency or scarcity claims.",
  severity: "medium",
  confidence: "low",
  automationLevel: "evidence-only",
  legalReference:
    "Directive 2005/29/EC Art. 5-9 and Annex I points 7 and 18; Regulation (EU) 2022/2065 (DSA) Art. 25",
  remediation:
    "Remove urgency or scarcity claims that are not factually accurate, and ensure any that remain reflect real stock or real deadlines that can be evidenced.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const claims = page.consumerJourney?.urgencyClaims ?? [];
      if (claims.length === 0) continue;
      findings.push(
        buildFinding(manipulativeDesign, PACK_ID, REGULATION, JURISDICTION, {
          status: "manual-review",
          affectedUrl: page.url,
          observedBehavior: `Urgency or scarcity claims were found on the page: ${claims.join("; ")}. Whether each claim is factually accurate cannot be determined by scanning.`,
          expectedBehavior:
            "Urgency and scarcity claims reflect verifiable facts, and the interface does not otherwise distort the consumer's decision.",
          evidence: [context.evidence.domFragment("Urgency/scarcity claims", claims.join(" | "))],
          manualReviewRequired: true,
        })
      );
    }
    return findings;
  },
});

const preCheckedConsent = defineRule({
  id: "crd-no-pre-checked-additional-payments",
  requirement:
    "Express consent must be obtained for any additional payment or optional extra; a pre-ticked box does not constitute consent.",
  severity: "high",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "Directive 2011/83/EU Art. 22; Directive 2005/29/EC Annex I point 29",
  remediation: "Ship every optional add-on, newsletter, or marketing checkbox unchecked, and require an affirmative action.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      for (const form of page.forms) {
        for (const checkbox of form.consentCheckboxes.filter((c) => c.preChecked)) {
          findings.push(
            buildFinding(preCheckedConsent, PACK_ID, REGULATION, JURISDICTION, {
              status: "violation",
              affectedUrl: page.url,
              affectedElement: `form[${form.formIndex}] checkbox: ${checkbox.label}`,
              observedBehavior: `A consent checkbox labelled "${checkbox.label}" is pre-ticked on page load.`,
              expectedBehavior: "Optional consent and add-on checkboxes are unchecked by default.",
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

const traderIdentity = defineRule({
  id: "ecd-trader-identity-available",
  requirement:
    "A service provider must make its identity, geographic address, and contact details easily, directly, and permanently accessible to recipients of the service.",
  severity: "medium",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Directive 2000/31/EC Art. 5; Directive 2011/83/EU Art. 6(1)(b)-(d)",
  remediation:
    "Link an imprint / legal notice page carrying the legal entity name, geographic address, email, and registration details from every page.",
  run: (context) => {
    const findings: Finding[] = [];
    const pagesWithoutIdentity = context.pages.filter((page) => page.consumerJourney?.traderIdentityLinked === false);
    if (pagesWithoutIdentity.length === 0 || pagesWithoutIdentity.length !== context.pages.length) return findings;
    findings.push(
      buildFinding(traderIdentity, PACK_ID, REGULATION, JURISDICTION, {
        status: "missing-disclosure",
        affectedUrl: pagesWithoutIdentity[0].url,
        observedBehavior: `No link to an imprint, legal notice, company details, or contact page was found on any of the ${pagesWithoutIdentity.length} scanned page(s).`,
        expectedBehavior: "Trader identity and contact details are permanently and directly accessible.",
      })
    );
    return findings;
  },
});

export const euConsumerRightsPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "EU",
  regulation: REGULATION,
  authority: "National consumer protection authorities (CPC network) and the European Commission",
  version: "1.0.0",
  effectiveDate: "2026-06-19",
  applicability: (config) => {
    const euTargeted =
      config.jurisdictions.some((j) => /european union|eu\b|eea|consumer rights/i.test(j)) ||
      (config.customerMarkets ?? []).some((m) => /european union|eu\b|eea/i.test(m));
    if (!euTargeted) return false;
    // The directive governs trader-to-consumer contracts. A scan that
    // declares a purely business-to-business sector is out of scope; one
    // that declares no sector keeps the pack, so the requirement surfaces.
    return !/b2b|business-to-business|internal|intranet/i.test(config.businessSector ?? "");
  },
  rules: [
    withdrawalFunction,
    orderButtonLabelling,
    autoRenewalTransparency,
    manipulativeDesign,
    preCheckedConsent,
    traderIdentity,
  ] as Rule[],
};
