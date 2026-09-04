import type { Page } from "playwright";

export interface AiInteractionSignal {
  kind: "vendor-script" | "widget-markup" | "page-text";
  detail: string;
}

export interface AiInteractionReport {
  url: string;
  /** Signals that the page puts the visitor in direct contact with an AI system. */
  interactionSignals: AiInteractionSignal[];
  /** Text on the page that tells the visitor they are dealing with an AI system. */
  disclosureSignals: AiInteractionSignal[];
  /** Signals that AI-generated or AI-manipulated content is published on the page. */
  generatedContentSignals: AiInteractionSignal[];
  /**
   * Page text that names an AI feature without telling the visitor they are
   * interacting with one. Not a disclosure, but worth reporting: it means the
   * page knows there is an AI system and chose not to say so at the point of
   * interaction.
   */
  marketingMentions: AiInteractionSignal[];
}

/**
 * Hosts of widely used conversational-AI and AI-assistant widgets. A match
 * means the page loads something that can hold a conversation with the
 * visitor - it does not by itself mean the deployer failed to disclose it,
 * which is why the detector reports disclosure signals separately.
 */
const AI_VENDOR_PATTERNS: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /(^|\.)intercom(cdn)?\.(io|com)$/i, vendor: "Intercom (Fin AI agent capable)" },
  { pattern: /(^|\.)drift\.com$/i, vendor: "Drift" },
  { pattern: /(^|\.)ada\.support$/i, vendor: "Ada" },
  { pattern: /(^|\.)tidio(chat)?\.(com|co)$/i, vendor: "Tidio / Lyro" },
  { pattern: /(^|\.)forethought\.ai$/i, vendor: "Forethought" },
  { pattern: /(^|\.)ultimate\.ai$/i, vendor: "Ultimate" },
  { pattern: /(^|\.)voiceflow\.com$/i, vendor: "Voiceflow" },
  { pattern: /(^|\.)kustomer(app)?\.com$/i, vendor: "Kustomer" },
  { pattern: /(^|\.)dialogflow\.(com|cloud\.google\.com)$/i, vendor: "Google Dialogflow" },
  { pattern: /(^|\.)openai\.com$/i, vendor: "OpenAI" },
  { pattern: /(^|\.)anthropic\.com$/i, vendor: "Anthropic" },
  { pattern: /(^|\.)watsonassistant\.[a-z.]+$/i, vendor: "IBM watsonx Assistant" },
];

const WIDGET_SELECTORS = [
  "[class*='chatbot' i]",
  "[id*='chatbot' i]",
  "[data-testid*='chatbot' i]",
  "[aria-label*='chatbot' i]",
  "[class*='ai-assistant' i]",
  "[id*='ai-assistant' i]",
  "[aria-label*='ai assistant' i]",
  "[aria-label*='virtual assistant' i]",
];

/**
 * Phrasing that tells a visitor, in the page's own words, that they are
 * interacting with an AI system. Article 50(1) requires this to be given at
 * the latest at the point of first interaction, so text hidden behind the
 * conversation is not equivalent - a match here is evidence the disclosure
 * exists somewhere on the page, and is deliberately reported as such.
 */
const DISCLOSURE_PATTERNS: RegExp[] = [
  /you are (chatting|speaking|talking|interacting) with (an? )?(ai|artificial intelligence|bot|virtual assistant|automated)/i,
  /this (chat|assistant|conversation|service|agent) is (powered by|handled by|run by|an?) (ai|artificial intelligence|automated)/i,
  /responses? (are|is) (generated|produced) by (ai|artificial intelligence|an automated system)/i,
  /i am an? (ai|artificial intelligence|virtual assistant|bot|automated assistant)/i,
  /(you|visitors?|users?) (are|is) (now )?(speaking|chatting) (to|with) (a|an) (bot|machine|automated)/i,
  // Multilingual equivalents, because a disclosure duty is not discharged in
  // English on a German or French site - and the absence of the English
  // wording is not evidence the disclosure is missing.
  /sie (chatten|sprechen|kommunizieren) mit (einer|einem) (ki|künstlichen intelligenz|bot|virtuellen assistenten)/i,
  /vous (discutez|parlez|échangez) avec (une|un) (ia|intelligence artificielle|robot|assistant virtuel)/i,
  /est[áa]s? (hablando|chateando) con (una|un) (ia|inteligencia artificial|bot|asistente virtual)/i,
];

/**
 * Wording that names an AI feature without telling the visitor they are
 * dealing with one *now*.
 *
 * "Our AI assistant answers in seconds" is marketing copy on a landing page;
 * treating it as an Art. 50(1) disclosure meant a site that never told anyone
 * anything was recorded as having disclosed. It is kept as a weaker signal
 * rather than dropped, so a reviewer can still see it was said somewhere.
 */
const MARKETING_MENTION_PATTERNS: RegExp[] = [
  /\b(ai|automated)[- ](assistant|agent|chatbot|chat ?bot|concierge|copilot)\b/i,
  /\bpowered by (ai|artificial intelligence)\b/i,
  /\bki[- ](assistent|chatbot)\b/i,
];

const GENERATED_CONTENT_PATTERNS: RegExp[] = [
  /(ai|artificially)[- ]generated (content|image|images|video|text|audio)/i,
  /generated (using|with|by) (ai|artificial intelligence)/i,
  /synthetic (media|image|video|audio)/i,
  /this (image|video|audio|article) was created (using|with) ai/i,
];

/**
 * Detects whether a page exposes an AI system a visitor interacts with, and
 * whether the page carries an AI-transparency disclosure. Both halves are
 * reported: the pack that consumes this decides what the combination means,
 * and no result here is a legal conclusion on its own.
 */
export class AiInteractionDetector {
  private readonly vendorHits = new Map<string, Set<string>>();

  /** Records AI-vendor requests for `page`. Call before navigating. */
  watch(page: Page): void {
    page.on("request", (request) => {
      let host: string;
      try {
        host = new URL(request.url()).hostname;
      } catch {
        return;
      }
      const match = AI_VENDOR_PATTERNS.find((entry) => entry.pattern.test(host));
      if (!match) return;
      const pageUrl = page.url();
      const bucket = this.vendorHits.get(pageUrl) ?? new Set<string>();
      bucket.add(`${match.vendor} (${host})`);
      this.vendorHits.set(pageUrl, bucket);
    });
  }

  async detect(page: Page): Promise<AiInteractionReport> {
    const url = page.url();
    const interactionSignals: AiInteractionSignal[] = [];
    const disclosureSignals: AiInteractionSignal[] = [];
    const generatedContentSignals: AiInteractionSignal[] = [];
    const marketingMentions: AiInteractionSignal[] = [];

    for (const vendor of this.vendorHits.get(url) ?? []) {
      interactionSignals.push({ kind: "vendor-script", detail: vendor });
    }
    this.vendorHits.delete(url);

    for (const selector of WIDGET_SELECTORS) {
      const count = await page.locator(selector).count().catch(() => 0);
      if (count > 0) {
        interactionSignals.push({ kind: "widget-markup", detail: `${count} element(s) matching ${selector}` });
      }
    }

    const text = await page.locator("body").innerText().catch(() => "");
    for (const pattern of DISCLOSURE_PATTERNS) {
      const match = text.match(pattern);
      if (match) disclosureSignals.push({ kind: "page-text", detail: match[0].slice(0, 200) });
    }
    for (const pattern of MARKETING_MENTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) marketingMentions.push({ kind: "page-text", detail: match[0].slice(0, 200) });
    }
    for (const pattern of GENERATED_CONTENT_PATTERNS) {
      const match = text.match(pattern);
      if (match) generatedContentSignals.push({ kind: "page-text", detail: match[0].slice(0, 200) });
    }

    return { url, interactionSignals, disclosureSignals, generatedContentSignals, marketingMentions };
  }
}
