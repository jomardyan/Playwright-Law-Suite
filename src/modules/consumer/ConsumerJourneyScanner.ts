import type { Page } from "playwright";

export interface ControlMatch {
  text: string;
  tag: string;
  visible: boolean;
}

export interface ConsumerJourneyReport {
  url: string;
  /** True when the page looks like part of a paid sign-up or subscription journey. */
  isSubscriptionSurface: boolean;
  /** True when the page looks like an order-completion step. */
  isOrderCompletionSurface: boolean;
  /** Controls whose label offers withdrawal from, or cancellation of, a contract. */
  withdrawalControls: ControlMatch[];
  /** Controls that place the order, whose label must make the payment obligation explicit. */
  orderButtons: ControlMatch[];
  /** Order buttons whose label does not state that the order carries an obligation to pay. */
  ambiguousOrderButtons: ControlMatch[];
  /** Text indicating a subscription renews automatically. */
  autoRenewalDisclosures: string[];
  /** Urgency or scarcity claims, a recognised manipulative-design pattern when unfounded. */
  urgencyClaims: string[];
  /** Whether trader identity/imprint information is linked from the page. */
  traderIdentityLinked: boolean;
}

const WITHDRAWAL_PATTERN =
  /(cancel|end|terminate) (my |your |the )?(contract|subscription|membership|plan|order)|withdraw from (the )?contract|right of withdrawal|cancel contract|cancel subscription/i;

const ORDER_BUTTON_PATTERN =
  /(place|complete|submit|confirm|finish) (your |the |my )?order|buy now|pay now|order now|complete purchase|checkout now|subscribe now|start (my |your )?(subscription|plan|membership)/i;

/**
 * Art. 8(2) CRD requires the order control to be labelled unambiguously with
 * the payment obligation - "order with obligation to pay" or a comparably
 * explicit formulation. A label that only says "continue" or "confirm" does
 * not carry that meaning.
 */
const PAYMENT_OBLIGATION_PATTERN = /obligation to pay|pay(ment)?\b|buy|purchase|order (and|with) pay|subscribe and pay/i;

const AUTO_RENEWAL_PATTERN =
  /(auto(matically)?[- ]?renew\w*)|(renews (automatically|every|each|on))|(recurring (payment|billing|charge))|(until (you )?cancel)/i;

const URGENCY_PATTERN =
  /(only \d+ (left|remaining|in stock))|(\d+ (people|others) (are )?(viewing|looking))|(offer ends in)|(hurry[,!])|(selling fast)|(last chance)|(limited time only)/i;

const TRADER_IDENTITY_PATTERN = /imprint|impressum|legal notice|company (details|information)|about us|contact us/i;

const SUBSCRIPTION_SURFACE_PATTERN = /subscri|pricing|plans?\b|membership|billing|checkout|upgrade/i;
const ORDER_SURFACE_PATTERN = /checkout|cart|basket|order|payment|billing/i;

/**
 * Collects consumer-protection signals from a page: whether a withdrawal or
 * cancellation control exists, whether the order button states the payment
 * obligation, and whether manipulative-design and auto-renewal cues are
 * present. Everything here is a signal for a rule to interpret, never a
 * conclusion about the fairness of a commercial practice.
 */
export class ConsumerJourneyScanner {
  async scan(page: Page): Promise<ConsumerJourneyReport> {
    const url = page.url();

    const controls = await page
      .evaluate(() => {
        const selector = "button, a[href], input[type='submit'], input[type='button'], [role='button']";
        return Array.from(document.querySelectorAll(selector)).map((el) => {
          const element = el as HTMLElement;
          const value = element.getAttribute("value") ?? "";
          const rect = element.getBoundingClientRect();
          return {
            text: (element.innerText || element.textContent || value || element.getAttribute("aria-label") || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 160),
            tag: element.tagName.toLowerCase(),
            visible: rect.width > 0 && rect.height > 0,
          };
        });
      })
      .catch(() => [] as ControlMatch[]);

    const linkTexts = await page
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((el) => `${el.textContent ?? ""} ${(el as HTMLAnchorElement).href}`)
      )
      .catch(() => [] as string[]);

    const bodyText = await page.locator("body").innerText().catch(() => "");

    const withdrawalControls = controls.filter((c) => WITHDRAWAL_PATTERN.test(c.text));
    const orderButtons = controls.filter((c) => c.visible && ORDER_BUTTON_PATTERN.test(c.text));
    const ambiguousOrderButtons = orderButtons.filter((c) => !PAYMENT_OBLIGATION_PATTERN.test(c.text));

    const collectMatches = (pattern: RegExp): string[] => {
      const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      return Array.from(new Set((bodyText.match(global) ?? []).map((m) => m.trim().slice(0, 200))));
    };

    const pathAndText = `${new URL(url).pathname} ${bodyText.slice(0, 4000)}`;

    return {
      url,
      isSubscriptionSurface: SUBSCRIPTION_SURFACE_PATTERN.test(pathAndText) || AUTO_RENEWAL_PATTERN.test(bodyText),
      isOrderCompletionSurface: ORDER_SURFACE_PATTERN.test(new URL(url).pathname) || orderButtons.length > 0,
      withdrawalControls,
      orderButtons,
      ambiguousOrderButtons,
      autoRenewalDisclosures: collectMatches(AUTO_RENEWAL_PATTERN),
      urgencyClaims: collectMatches(URGENCY_PATTERN),
      traderIdentityLinked: linkTexts.some((text) => TRADER_IDENTITY_PATTERN.test(text)),
    };
  }
}
