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
  /** The links that were read as publishing the trader's identity, as evidence. */
  traderIdentityLinks: string[];
  /** What made this page look like a subscription or order surface, for the evidence trail. */
  surfaceEvidence: string[];
}

const WITHDRAWAL_PATTERN =
  /(cancel|end|terminate) (my |your |the )?(contract|subscription|membership|plan|order)|withdraw from (the )?contract|right of withdrawal|cancel contract|cancel subscription|k[üu]ndig(en|ung)|widerrufsrecht|widerruf(en)?\b|r[ée]silier|droit de r[ée]tractation|cancelar (la )?(suscripci[óo]n|subscripci[óo]n)|desistir|disdire|recesso|opzeggen|herroepingsrecht/i;

const ORDER_BUTTON_PATTERN =
  /(place|complete|submit|confirm|finish) (your |the |my )?order|buy now|pay now|order now|complete purchase|checkout now|subscribe now|start (my |your )?(subscription|plan|membership|free trial)|proceed to payment|zahlungspflichtig bestellen|jetzt kaufen|kostenpflichtig bestellen|jetzt bestellen|commander avec obligation de paiement|commander et payer|acheter maintenant|comprar ahora|pedido con obligaci[óo]n de pago|acquista ora|ordine con obbligo di pagamento|nu kopen|bestellen en betalen/i;

/**
 * Art. 8(2) CRD requires the order control to be labelled unambiguously with
 * the payment obligation - "order with obligation to pay" or a comparably
 * explicit formulation. A label that only says "continue" or "confirm" does
 * not carry that meaning. The German "zahlungspflichtig bestellen" and the
 * French "commander avec obligation de paiement" are the formulations those
 * markets' courts have settled on, so they are recognised explicitly.
 */
const PAYMENT_OBLIGATION_PATTERN =
  /obligation to pay|pay(ment)?\b|buy|purchase|order (and|with) pay|subscribe and pay|zahlungspflichtig|kostenpflichtig|kaufen|bezahlen|obligation de paiement|payer|acheter|obligaci[óo]n de pago|pagar|comprar|obbligo di pagamento|pagare|acquista|betalen|kopen/i;

const AUTO_RENEWAL_PATTERN =
  /(auto(matically)?[- ]?renew\w*)|(renews (automatically|every|each|on))|(recurring (payment|billing|charge))|(until (you )?cancel)|(automatisch (verl[äa]ngert|erneuert))|(reconduction tacite)|(renovaci[óo]n autom[áa]tica)|(rinnovo automatico)|(automatisch verlengd)/i;

const URGENCY_PATTERN =
  /(only \d+ (left|remaining|in stock))|(\d+ (people|others|customers) (are )?(viewing|looking|watching))|(offer ends (in|soon))|(sale ends in)|(hurry[,!.])|(selling fast)|(almost (sold out|gone))|(last chance)|(limited time only)|(\d+ (booked|sold) (today|in the last))|(nur noch \d+ (verf[üu]gbar|auf lager))|(plus que \d+ (en stock|disponibles?))|(solo quedan \d+)|(ultimi \d+ (pezzi|disponibili))/i;

/**
 * Where a trader's identity is published, in the words sites actually use.
 *
 * The previous pattern required "about us" / "contact us" with the pronoun,
 * and nothing else in English. Real scans of stripe.com ("Contact sales"),
 * digitalocean.com ("About", "Legal"), python.org ("Legal Statements",
 * "Help & General Contact") and rijksoverheid.nl ("Contact") all reported
 * that no trader identity was published anywhere on the site. Both the link
 * text and the href are now matched, and bare "About" / "Contact" / "Legal"
 * count, because that is how the link is usually labelled.
 */
const TRADER_IDENTITY_PATTERN =
  /\b(imprint|impressum|legal\s*(notice|information|statements?)?|terms|company|corporate|about|contact|support|help\s*(centre|center)?|who\s+we\s+are)\b|mentions\s+l[ée]gales|informations?\s+l[ée]gales|qui\s+sommes[- ]nous|nous\s+contacter|aviso\s+legal|informaci[óo]n\s+legal|sobre\s+nosotros|contacta|note\s+legali|informazioni\s+legali|chi\s+siamo|contatti|colofon|over\s+ons|juridisch|dane\s+firmy|o\s+nas|kontakt|impressum|om\s+oss|yritys|会社(概要|案内)|特定商取引|運営会社|お問い合わせ|公司(简介|信息)|联系我们|회사\s*소개|고객센터/i;

/**
 * Hrefs that lead to the same information, for sites whose link text is an
 * icon or a logo.
 */
const TRADER_IDENTITY_HREF_PATTERN =
  /(^|[/\-_.])(imprint|impressum|legal|legals|about|about-us|aboutus|company|corporate|contact|contacts|contact-us|kontakt|contatti|colofon|over-ons|mentions-legales|informations-legales|aviso-legal|note-legali|chi-siamo|quienes-somos|qui-sommes-nous|o-nas|om-oss|dane-firmy|tokushoho)([/\-_.]|$)/i;

/**
 * Path segments that identify a commercial surface.
 *
 * Deliberately matched against the URL path and the page's own headings and
 * control labels, never against a slab of body text. The previous version
 * tested `/plans?\b|checkout|pricing/` against the first 4000 characters of
 * every page, so any site whose footer said "plans" or whose copy mentioned
 * "checkout" was classified as a subscription surface - which then handed
 * every consumer-rights rule a page it had no business judging.
 */
const SUBSCRIPTION_PATH_PATTERN = /(^|\/)(subscri\w*|pricing|plans?|membership|billing|checkout|upgrade|abo|abonnement|tarifs?|precios|prezzi)(\/|$|[?#])/i;
const ORDER_PATH_PATTERN = /(^|\/)(checkout|cart|basket|order|orders|payment|pay|billing|warenkorb|panier|carrito|carrello|winkelwagen|kasse)(\/|$|[?#])/i;
const SUBSCRIPTION_HEADING_PATTERN =
  /\b(pricing|plans?|subscription|membership|billing|per month|per year|\/mo\b|\/month\b|monthly|annually|free trial)\b|preise|tarifs|abonnement|precios|prezzi|abonnement/i;

/**
 * Evidence that money is involved: a price, a billing period, or explicit
 * payment wording.
 *
 * A paid-subscription surface is what the Consumer Rights Directive's
 * withdrawal right attaches to, and "Subscribe" on its own does not mean one.
 * A scan of python.org classified `/psf/newsletter/` - a free mailing list -
 * as a paid subscription and reported a missing withdrawal function against
 * the Python Software Foundation. A payment signal is now required alongside
 * the subscription wording.
 */
const PRICE_PATTERN =
  /(?:[€£$¥₹₩฿₦]|\b(?:EUR|GBP|USD|CHF|SEK|DKK|NOK|PLN|CZK|JPY|CNY|KRW|INR|BRL|CAD|AUD|SGD|ZAR|SAR|NGN|THB)\b)\s?\d|\d+[.,]?\d*\s?(?:[€£$]|\b(?:EUR|GBP|USD|CHF|PLN|SEK|kr|z[łl])\b)/i;
const BILLING_PERIOD_PATTERN =
  /\b(per|a|\/)\s?(month|year|mo|yr|seat|user)\b|\bmonthly\b|\byearly\b|\bannually\b|\bbilled\s+(monthly|annually|yearly)\b|\bpro\s?monat\b|\bpar\s+mois\b|\bal\s+mese\b|\bpor\s+mes\b|\bper\s+maand\b|\bmiesi[ąa]c\b/i;

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
    // A page reached through an unusual scheme (about:blank after a failed
    // navigation, for instance) has no path to reason about. Parsing it
    // unguarded threw, and the caller recorded the whole consumer scan as
    // failed rather than as "no signals here".
    let path = "";
    try {
      path = new URL(url).pathname;
    } catch {
      path = "";
    }

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

    const headings = await page
      .locator("h1, h2, h3, title")
      .evaluateAll((elements) => elements.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()).slice(0, 40))
      .catch(() => [] as string[]);

    const links = await page
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((el) => ({
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: (el as HTMLAnchorElement).href,
        }))
      )
      .catch(() => [] as Array<{ text: string; href: string }>);

    const bodyText = await page.locator("body").innerText().catch(() => "");

    const withdrawalControls = controls.filter((c) => WITHDRAWAL_PATTERN.test(c.text));
    const orderButtons = controls.filter((c) => c.visible && ORDER_BUTTON_PATTERN.test(c.text));
    const ambiguousOrderButtons = orderButtons.filter((c) => !PAYMENT_OBLIGATION_PATTERN.test(c.text));

    const collectMatches = (pattern: RegExp): string[] => {
      const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      return Array.from(new Set((bodyText.match(global) ?? []).map((m) => m.trim().slice(0, 200))));
    };

    const autoRenewalDisclosures = collectMatches(AUTO_RENEWAL_PATTERN);

    const traderIdentityLinks = links
      .filter((link) => TRADER_IDENTITY_PATTERN.test(link.text) || TRADER_IDENTITY_HREF_PATTERN.test(link.href))
      .map((link) => `${link.text.slice(0, 60)} -> ${link.href}`);

    // Each signal is recorded with what produced it, so a rule that acts on
    // "this is a subscription page" can be checked rather than believed.
    const surfaceEvidence: string[] = [];
    const subscriptionSignals: string[] = [];
    if (SUBSCRIPTION_PATH_PATTERN.test(path)) subscriptionSignals.push(`URL path matches a subscription surface: ${path}`);
    const matchingHeading = headings.find((heading) => SUBSCRIPTION_HEADING_PATTERN.test(heading));
    if (matchingHeading) subscriptionSignals.push(`Heading indicates a pricing/subscription surface: "${matchingHeading.slice(0, 120)}"`);
    if (autoRenewalDisclosures.length > 0) subscriptionSignals.push(`Auto-renewal language on the page: ${autoRenewalDisclosures[0]}`);
    const subscriptionControl = controls.find((c) => c.visible && /subscribe|start (my |your )?(subscription|plan|membership|free trial)|abonnieren|s.abonner|suscrib|abbonati/i.test(c.text));
    if (subscriptionControl) subscriptionSignals.push(`Subscription control: "${subscriptionControl.text}"`);

    // The withdrawal right the consumer-rights pack reasons about attaches to
    // a paid contract, so a subscription signal only counts when money is
    // visible on the page too. Auto-renewal wording is the exception: nothing
    // renews automatically without a charge behind it.
    const priceMatch = bodyText.match(PRICE_PATTERN);
    const billingMatch = bodyText.match(BILLING_PERIOD_PATTERN);
    const paymentEvidence =
      autoRenewalDisclosures.length > 0 ||
      (priceMatch !== null && billingMatch !== null) ||
      (priceMatch !== null && ORDER_PATH_PATTERN.test(path));
    if (priceMatch) subscriptionSignals.push(`Price on the page: "${priceMatch[0].trim().slice(0, 40)}"`);
    if (billingMatch) subscriptionSignals.push(`Billing period: "${billingMatch[0].trim().slice(0, 40)}"`);

    const isSubscriptionSurface = subscriptionSignals.length > 0 && paymentEvidence;
    if (isSubscriptionSurface) surfaceEvidence.push(...subscriptionSignals);
    else if (subscriptionSignals.length > 0) {
      surfaceEvidence.push(
        `Subscription wording without any price or billing period, so this is not treated as a paid subscription surface: ${subscriptionSignals.join("; ")}`
      );
    }

    if (ORDER_PATH_PATTERN.test(path)) surfaceEvidence.push(`URL path matches an order surface: ${path}`);
    if (orderButtons.length > 0) surfaceEvidence.push(`Order control(s): ${orderButtons.map((b) => `"${b.text}"`).slice(0, 3).join(", ")}`);

    return {
      url,
      isSubscriptionSurface,
      isOrderCompletionSurface: ORDER_PATH_PATTERN.test(path) || orderButtons.length > 0,
      withdrawalControls,
      orderButtons,
      ambiguousOrderButtons,
      autoRenewalDisclosures,
      urgencyClaims: collectMatches(URGENCY_PATTERN),
      traderIdentityLinked: traderIdentityLinks.length > 0,
      traderIdentityLinks: traderIdentityLinks.slice(0, 5),
      surfaceEvidence,
    };
  }
}
