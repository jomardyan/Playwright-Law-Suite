import type { Page } from "playwright";

export type DisclosureStatus = "detected" | "missing" | "potentially-incomplete";

export interface DisclosureCategoryResult {
  category: string;
  status: DisclosureStatus;
  matchedKeywords: string[];
}

export interface PrivacyDocument {
  label: "privacy-policy" | "cookie-policy" | "terms" | "do-not-sell" | "data-rights" | "accessibility-statement";
  url: string | null;
  textLength: number;
  disclosures: DisclosureCategoryResult[];
  /** Text of the link the document was found through, for the evidence trail. */
  linkText?: string;
  /** Detected language of the document body, when it declares or reveals one. */
  language?: string | null;
}

interface DocumentMatcher {
  label: PrivacyDocument["label"];
  /** Matched against the visible link text. */
  text: RegExp;
  /** Matched against the href path, where words are separated by - _ or /. */
  href: RegExp;
  /**
   * Link text that disqualifies an otherwise matching candidate. "Privacy
   * settings" and "Cookie preferences" contain the right words but open a
   * control, not the published document a disclosure rule needs to read.
   */
  exclude?: RegExp;
}

/**
 * How a privacy-relevant document is recognised.
 *
 * Two failures in the previous version made this the single biggest source of
 * false "no privacy notice" violations:
 *
 * - The link-text patterns required a space ("privacy policy") and were also
 *   tested against the href, where the real world writes `/privacy-policy`,
 *   `/privacy_policy` or just `/privacy`. Almost no href matched.
 * - Everything was English. A German shop links "Datenschutzerklärung" and a
 *   French one "Politique de confidentialité"; both were reported as having
 *   no privacy notice at all, on packs whose whole point is that they apply
 *   outside the anglosphere.
 *
 * Text and href are therefore matched by separate patterns, and both cover
 * the languages of the markets the shipped packs address.
 */
const DOCUMENT_MATCHERS: DocumentMatcher[] = [
  {
    label: "privacy-policy",
    text: /privacy\s*(policy|notice|statement|centre|center)?\b|data\s*protection\s*(policy|notice|statement)|datenschutz(erkl[äa]rung|hinweise|richtlinie)?|politique\s+de\s+confidentialit[ée]|confidentialit[ée]|pol[ií]tica\s+de\s+privacidad(e)?|privacidad(e)?|informativa\s+(sulla\s+)?privacy|privacybeleid|privacyverklaring|polityka\s+prywatno[śs]ci|prywatno[śs][ćc]|integritetspolicy|personuppgifter|persondatapolitik|personvern|tietosuoja|z[áa]sady\s+ochrany\s+osobn[íi]ch\s+[úu]daj[ůu]|adatv[ée]delm|politica\s+de\s+confiden[țt]ialitate|gizlilik|プライバシー|個人情報保護方針|隐私(政策|权政策)?|私隱|개인정보\s*(처리방침|취급방침)|สิทธิส่วนบุคคล|سياسة\s+الخصوصية/i,
    href: /(^|[/\-_.])(privacy|privacidad|privacidade|privacybeleid|privacyverklaring|datenschutz|confidentialite|confidentialit|riservatezza|prywatnosc|integritetspolicy|personvern|tietosuoja|gizlilik|adatvedelem|osobnich-udaju)([/\-_.]|$)|privacy[-_]?(policy|notice|statement)|data[-_]?protection/i,
    exclude: /\b(settings|preferences|choices|manage|centre\s+control|einstellungen|pr[ée]f[ée]rences|preferencias|impostazioni|instellingen|ustawienia)\b/i,
  },
  {
    label: "cookie-policy",
    text: /cookie\s*(policy|notice|statement|declaration|information)|about\s+cookies|use\s+of\s+cookies|cookie-?richtlinie|cookie-?erkl[äa]rung|politique\s+(de\s+)?cookies|pol[ií]tica\s+de\s+cookies|informativa\s+(sui\s+)?cookie|cookiebeleid|cookieverklaring|polityka\s+cookie|cookie-?policy|クッキー|cookie\s*ポリシー|Cookie政策|쿠키/i,
    href: /(^|[/\-_.])cookies?([/\-_.]|$)|cookie[-_]?(policy|notice|statement|richtlinie|beleid)/i,
    exclude: /\b(settings|preferences|manage|einstellungen|pr[ée]f[ée]rences|preferencias|impostazioni|instellingen|ustawienia)\b/i,
  },
  {
    label: "terms",
    text: /terms\s+(and\s+conditions|of\s+(use|service|sale|business))|^\s*terms\s*$|general\s+terms|conditions\s+g[ée]n[ée]rales|allgemeine\s+gesch[äa]ftsbedingungen|\bAGB\b|t[ée]rminos\s+y\s+condiciones|termos\s+de\s+(uso|servi[çc]o)|termini\s+e\s+condizioni|algemene\s+voorwaarden|regulamin|k[äa]ytt[öo]ehdot|利用規約|服务条款|이용약관/i,
    href: /(^|[/\-_.])(terms|tos|agb|conditions|voorwaarden|regulamin|terminos|termos|termini)([/\-_.]|$)|terms[-_]?(of[-_]?(use|service|sale)|and[-_]?conditions)/i,
  },
  {
    label: "do-not-sell",
    text: /do\s+not\s+sell(\s+or\s+share)?(\s+my)?(\s+personal)?(\s+(information|data))?|opt[-\s]?out\s+of\s+(the\s+)?(sale|sharing)|your\s+privacy\s+choices|limit\s+the\s+use\s+of\s+my\s+sensitive/i,
    href: /do[-_]?not[-_]?sell|privacy[-_]?choices|opt[-_]?out[-_]?of[-_]?(sale|sharing)|ccpa|dnsmpi/i,
  },
  {
    label: "data-rights",
    text: /your\s+(privacy\s+)?rights|data\s+subject\s+rights|manage\s+your\s+data|exercise\s+your\s+rights|privacy\s+request|subject\s+access\s+request|betroffenenrechte|ihre\s+rechte|vos\s+droits|sus\s+derechos|i\s+tuoi\s+diritti|uw\s+rechten/i,
    href: /data[-_]?(subject[-_]?)?rights|privacy[-_]?(rights|request)|dsar|subject[-_]?access/i,
  },
  {
    label: "accessibility-statement",
    text: /accessibility\s*(statement|declaration|policy|commitment)?\b|barrierefreiheit(serkl[äa]rung)?|erkl[äa]rung\s+zur\s+barrierefreiheit|d[ée]claration\s+d.accessibilit[ée]|accessibilit[ée]|declaraci[óo]n\s+de\s+accesibilidad|accesibilidad|dichiarazione\s+di\s+accessibilit[àa]|toegankelijkheid(sverklaring)?|deklaracja\s+dost[ęe]pno[śs]ci/i,
    href: /(^|[/\-_.])(accessibility|barrierefreiheit|accessibilite|accesibilidad|accessibilita|toegankelijkheid|dostepnosc)([/\-_.]|$)|accessibility[-_]?statement/i,
  },
];

/**
 * Link text that means the *opposite* of what a pattern matched: a page
 * explaining a competitor's policy, a marketing page about privacy features,
 * or a blog post. A privacy-notice link is a legal document, and picking a
 * blog post instead means the disclosure scan reads the wrong text.
 */
const DOCUMENT_TEXT_EXCLUSIONS = /\b(blog|news|article|press|careers?|jobs?|webinar|whitepaper|case\s+study|pricing|product|feature)\b/i;

/**
 * Disclosure topics, with the language a notice actually uses.
 *
 * Two tiers per topic. A *strong* match is wording that only appears when the
 * topic is genuinely being addressed. A *weak* match is wording that often
 * accompanies the topic but also appears incidentally - "third parties"
 * appears just as readily in "we never share your data with third parties".
 * A weak-only match is reported `potentially-incomplete` so the report can
 * say "mentioned, but check it" rather than choosing between a false pass and
 * a false gap.
 *
 * Matching is by regular expression with word boundaries, not substring
 * containment: the old `text.includes("dpo")` fired on any word that happened
 * to contain those three letters.
 */
const DISCLOSURE_MATCHERS: Record<string, { strong: RegExp[]; weak: RegExp[] }> = {
  "controller-identity": {
    strong: [
      /\b(data\s+)?controller\b/i,
      /\bverantwortlich(er|e\s+stelle)\b/i,
      /\bresponsable\s+(du\s+)?(traitement|del\s+tratamiento)\b/i,
      /\btitolare\s+del\s+trattamento\b/i,
      /\bverwerkingsverantwoordelijke\b/i,
      /\badministrator(em)?\s+danych\b/i,
      /\bcontrolador(a)?\s+(de\s+dados|dos\s+dados)\b/i,
    ],
    weak: [/\bwe\s+are\s+responsible\s+for\b/i, /\boperated\s+by\b/i, /\bregistered\s+(office|address)\b/i],
  },
  "controller-contact": {
    strong: [
      /\bcontact\s+(us|our|the)\b[^.]{0,80}\b(privacy|data\s+protection|dpo)\b/i,
      /\b(privacy|dataprotection|datenschutz|dpo|gdpr)[a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/i,
      /\bdata\s+protection\s+(contact|enquiries|inquiries|team)\b/i,
      /\bkontakt(ieren)?\s+sie\s+(uns|unseren)\b/i,
      /\bnous\s+contacter\b/i,
    ],
    // An address for enquiries is the substance of the requirement; a bare
    // mailto is evidence of it without proving it is the privacy contact.
    weak: [/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, /\bcontact\s+us\b/i, /\bpostal\s+address\b/i],
  },
  "dpo-information": {
    strong: [
      /\bdata\s+protection\s+officer\b/i,
      /\bDPO\b/,
      /\bdatenschutzbeauftragte(r|n)?\b/i,
      /\bd[ée]l[ée]gu[ée]\s+[àa]\s+la\s+protection\s+des\s+donn[ée]es\b/i,
      /\bdelegado\s+de\s+protecci[óo]n\s+de\s+datos\b/i,
      /\bresponsabile\s+della\s+protezione\s+dei\s+dati\b/i,
      /\bfunctionaris\s+(voor\s+de\s+)?gegevensbescherming\b/i,
    ],
    weak: [/\bprivacy\s+officer\b/i, /\bprivacy\s+team\b/i],
  },
  "processing-purposes": {
    strong: [
      /\bpurpose[s]?\s+(of|for)\s+(the\s+)?processing\b/i,
      /\bwhy\s+we\s+(process|collect|use)\b/i,
      /\bwe\s+(use|process)\s+(your|this|these|personal)\s+(data|information|details)\s+(to|for|in\s+order)\b/i,
      /\bzweck(e|en)?\s+der\s+verarbeitung\b/i,
      /\bfinalit[ée]s?\s+du\s+traitement\b/i,
      /\bfinalidad(es)?\s+del\s+tratamiento\b/i,
      /\bfinalit[àa]\s+del\s+trattamento\b/i,
    ],
    weak: [/\bpurposes?\b/i, /\bhow\s+we\s+use\b/i],
  },
  "legal-bases": {
    strong: [
      /\blegal\s+(basis|bases|ground[s]?)\b/i,
      /\blegitimate\s+interest[s]?\b/i,
      /\brechtsgrundlage(n)?\b/i,
      /\bberechtigte[sn]?\s+interesse\b/i,
      /\bbase\s+(l[ée]gale|juridique)\b/i,
      /\bbase\s+(legal|jur[íi]dica)\b/i,
      /\bbase\s+giuridica\b/i,
      /\bart(icle|\.)\s*6\b/i,
    ],
    weak: [/\bconsent\b/i, /\bcontractual\s+necessity\b/i],
  },
  recipients: {
    strong: [
      /\bwe\s+(share|disclose|transfer)\s+(your|this|personal)\b/i,
      /\brecipients?\s+of\s+(your|the|personal)\s+data\b/i,
      /\bcategories\s+of\s+recipients\b/i,
      /\b(service\s+providers|sub-?processors|processors)\s+(we\s+use|who|that)\b/i,
      /\bempf[äa]nger\s+der\s+daten\b/i,
      /\bdestinataires\b/i,
      /\bdestinatarios\b/i,
    ],
    weak: [/\bthird\s+part(y|ies)\b/i, /\bservice\s+providers\b/i, /\bpartners\b/i],
  },
  "international-transfers": {
    strong: [
      /\binternational\s+(data\s+)?transfers?\b/i,
      /\bstandard\s+contractual\s+clauses\b/i,
      /\boutside\s+(the\s+)?(eea|european\s+economic\s+area|eu|uk)\b/i,
      /\badequacy\s+decision\b/i,
      /\btransfer(red|s)?\s+(your\s+data\s+)?(to|outside)\s+(a\s+)?(third\s+countr|countries\s+outside)/i,
      /\bdrittland(s?[üu]bermittlung)?\b/i,
      /\btransferts?\s+(internationaux|hors\s+(ue|eee))\b/i,
      /\bclauses\s+contractuelles\s+types\b/i,
    ],
    weak: [/\bglobally\b/i, /\bworldwide\b/i, /\bother\s+countries\b/i],
  },
  "retention-periods": {
    strong: [
      /\bretention\s+(period|policy|schedule)\b/i,
      /\bhow\s+long\s+we\s+(keep|store|retain|hold)\b/i,
      /\bwe\s+(keep|retain|store)\s+(your|this|personal)\s+(data|information)\s+(for|until)\b/i,
      /\bspeicherdauer\b/i,
      /\baufbewahrungsfrist\b/i,
      /\bdur[ée]e\s+de\s+conservation\b/i,
      /\bplazo\s+de\s+conservaci[óo]n\b/i,
      /\bperiodo\s+di\s+conservazione\b/i,
    ],
    weak: [/\bas\s+long\s+as\s+necessary\b/i, /\bdeleted?\s+when\b/i],
  },
  "data-subject-rights": {
    strong: [
      /\bright\s+to\s+(access|erasure|be\s+forgotten|rectification|object|restrict|data\s+portability|portability)\b/i,
      /\byour\s+rights\s+(under|as\s+a\s+data\s+subject)\b/i,
      /\bbetroffenenrechte\b|\brecht\s+auf\s+(auskunft|l[öo]schung|berichtigung)\b/i,
      /\bdroit\s+(d.acc[èe]s|de\s+rectification|[àa]\s+l.effacement|d.opposition)\b/i,
      /\bderecho\s+de\s+(acceso|rectificaci[óo]n|supresi[óo]n|oposici[óo]n)\b/i,
      /\bdiritto\s+di\s+(accesso|rettifica|cancellazione|opposizione)\b/i,
    ],
    weak: [/\byour\s+rights\b/i, /\brequest\s+(a\s+copy|deletion)\b/i],
  },
  "supervisory-authority": {
    strong: [
      /\bsupervisory\s+authority\b/i,
      /\bdata\s+protection\s+(authority|commission(er)?|board)\b/i,
      /\blodge\s+a\s+complaint\b/i,
      /\baufsichtsbeh[öo]rde\b/i,
      /\bautorit[ée]\s+de\s+contr[ôo]le\b|\bCNIL\b/i,
      /\bautoridad\s+de\s+(control|protecci[óo]n\s+de\s+datos)\b|\bAEPD\b/i,
      /\bgarante\s+(per\s+la\s+protezione)?\b/i,
      /\bInformation\s+Commissioner\b|\bICO\b/,
    ],
    weak: [/\bregulator\b/i, /\bcomplain(t|ts)?\b/i],
  },
  "consent-withdrawal": {
    strong: [
      /\bwithdraw\s+(your\s+)?consent\b/i,
      /\brevoke\s+(your\s+)?consent\b/i,
      /\bwiderruf(en|lich)?\b.{0,40}\beinwilligung\b|\beinwilligung\b.{0,40}\bwiderruf/i,
      /\bretirer\s+(votre\s+)?consentement\b/i,
      /\bretirar\s+(su\s+)?consentimiento\b/i,
      /\brevocare\s+il\s+consenso\b/i,
    ],
    weak: [/\bopt\s*-?\s*out\b/i, /\bunsubscribe\b/i],
  },
  "automated-decision-making": {
    strong: [
      /\bautomated\s+(decision[-\s]?making|decisions|processing)\b/i,
      /\bprofiling\b/i,
      /\bautomatisierte\s+entscheidungsfindung\b|\bprofiling\b/i,
      /\bd[ée]cision\s+automatis[ée]e\b|\bprofilage\b/i,
      /\bdecisiones\s+automatizadas\b|\belaboraci[óo]n\s+de\s+perfiles\b/i,
      /\bprofilazione\b/i,
    ],
    weak: [/\balgorithm(s|ic)?\b/i, /\bpersonalis(ed|ation)|personaliz(ed|ation)\b/i],
  },
};

function evaluateDisclosures(text: string): DisclosureCategoryResult[] {
  return Object.entries(DISCLOSURE_MATCHERS).map(([category, { strong, weak }]) => {
    const strongHits = strong.filter((pattern) => pattern.test(text));
    if (strongHits.length > 0) {
      return {
        category,
        status: "detected" as DisclosureStatus,
        matchedKeywords: strongHits.map((pattern) => pattern.source.slice(0, 60)),
      };
    }
    const weakHits = weak.filter((pattern) => pattern.test(text));
    if (weakHits.length > 0) {
      return {
        category,
        status: "potentially-incomplete" as DisclosureStatus,
        matchedKeywords: weakHits.map((pattern) => pattern.source.slice(0, 60)),
      };
    }
    return { category, status: "missing" as DisclosureStatus, matchedKeywords: [] };
  });
}

/** Exposed for tests and for callers that already hold a notice's text. */
export function analyzeDisclosureText(text: string): DisclosureCategoryResult[] {
  return evaluateDisclosures(text);
}

export interface LinkCandidate {
  href: string;
  text: string;
}

/**
 * Scores how well a link identifies a given document.
 *
 * Both halves count, and the visible text counts for more: a footer link
 * reading "Privacy Policy" that points at `/legal/12` is still the privacy
 * policy, while `/privacy-settings` labelled "Cookie settings" is a control,
 * not a document. Returns 0 when the link is not a candidate at all.
 */
function scoreCandidate(matcher: DocumentMatcher, link: LinkCandidate): number {
  const text = link.text.replace(/\s+/g, " ").trim();
  if (DOCUMENT_TEXT_EXCLUSIONS.test(text)) return 0;
  if (matcher.exclude?.test(text)) return 0;

  let path = "";
  try {
    const parsed = new URL(link.href);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    path = link.href;
  }

  const textMatch = text.length > 0 && text.length <= 120 && matcher.text.test(text);
  const hrefMatch = matcher.href.test(path);
  if (!textMatch && !hrefMatch) return 0;

  let score = 0;
  if (textMatch) score += 3;
  if (hrefMatch) score += 2;
  // A short, dedicated label ("Privacy Policy") is a better identification
  // than a sentence that happens to contain the words.
  if (textMatch && text.length <= 40) score += 1;
  return score;
}

/**
 * Picks the best link for each document type from a page's links.
 *
 * Pure and exported so the matching can be exercised directly: this is where
 * a missed privacy-notice link turns into a critical "no privacy policy"
 * finding, and it needs to be checkable against real-world markup without a
 * browser in the loop.
 */
export function matchDocumentLinks(links: LinkCandidate[]): PrivacyDocument[] {
  const documents: PrivacyDocument[] = [];
  for (const matcher of DOCUMENT_MATCHERS) {
    let best: { link: LinkCandidate; score: number } | null = null;
    for (const link of links) {
      // `javascript:`, `mailto:` and bare fragment links open no document.
      if (!/^https?:/i.test(link.href)) continue;
      const score = scoreCandidate(matcher, link);
      if (score === 0) continue;
      if (!best || score > best.score) best = { link, score };
    }
    documents.push({
      label: matcher.label,
      url: best?.link.href ?? null,
      linkText: best?.link.text,
      textLength: 0,
      disclosures: [],
      language: null,
    });
  }
  return documents;
}

/**
 * Locates privacy-relevant documents linked from the page and performs a
 * keyword-based disclosure scan. This never asserts legal correctness -
 * only whether the expected topic appears to be addressed in the text.
 *
 * Fetched documents are cached per scanner instance: the same policy is
 * linked from every page of a site, and refetching it once per route both
 * wastes a page load and risks a rate-limited response that would be
 * reported as "the notice could not be read".
 */
export class PrivacyDocumentScanner {
  private readonly analysisCache = new Map<string, { textLength: number; disclosures: DisclosureCategoryResult[]; language: string | null }>();

  async findDocuments(page: Page): Promise<PrivacyDocument[]> {
    const links = await page
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((el) => ({
          href: (el as HTMLAnchorElement).href,
          text:
            (el.textContent ?? "").replace(/\s+/g, " ").trim() ||
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            "",
        }))
      )
      .catch(() => [] as LinkCandidate[]);
    return matchDocumentLinks(links);
  }

  async analyzeDocument(page: Page, doc: PrivacyDocument): Promise<PrivacyDocument> {
    if (!doc.url) return doc;

    const cached = this.analysisCache.get(doc.url);
    if (cached) {
      return {
        ...doc,
        textLength: cached.textLength,
        disclosures: doc.label === "privacy-policy" ? cached.disclosures : [],
        language: cached.language,
      };
    }

    try {
      const docPage = await page.context().newPage();
      await docPage.goto(doc.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      // A notice rendered client-side has no text at `domcontentloaded`, and
      // an empty body is reported as "could not be read" - a not-evaluated
      // result standing in for a notice that is perfectly readable.
      await docPage.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      const text = (await docPage.locator("body").innerText().catch(() => "")) ?? "";
      const language = await docPage
        .evaluate(() => globalThis.document.documentElement.getAttribute("lang"))
        .catch(() => null);
      await docPage.close();
      const disclosures = evaluateDisclosures(text);
      this.analysisCache.set(doc.url, { textLength: text.length, disclosures, language: language ?? null });
      return {
        ...doc,
        textLength: text.length,
        disclosures: doc.label === "privacy-policy" ? disclosures : [],
        language: language ?? null,
      };
    } catch {
      return doc;
    }
  }
}
