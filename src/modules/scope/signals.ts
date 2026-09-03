/**
 * Market and sector signals a page can be probed for, and the canonical
 * vocabulary the rest of the scanner speaks.
 *
 * Everything in this file is a *signal*, not a conclusion. A site serving
 * prices in euros is evidence it targets the EU; it is not proof, and it is
 * certainly not a determination of which law applies to its operator. The
 * resolver that consumes these signals is required to carry that distinction
 * through to the report.
 */

/**
 * Jurisdiction strings exactly as the regulatory packs' `applicability()`
 * functions match them. Autoscan must emit these spellings verbatim - a
 * near-miss ("EU-27", "UK/GB") silently loads no pack, which would read as a
 * clean scan of a site nobody checked.
 */
export const CANONICAL_JURISDICTIONS = {
  EU: "European Union",
  UK: "United Kingdom",
  US: "United States",
  US_CA: "United States - California",
  AU: "Australia",
  BR: "Brazil",
  CA: "Canada",
  CA_QC: "Canada - Quebec",
  JP: "Japan",
  IN: "India",
  CN: "China",
  KR: "South Korea",
  CH: "Switzerland",
  TH: "Thailand",
  SG: "Singapore",
  ZA: "South Africa",
  SA: "Saudi Arabia",
  NG: "Nigeria",
} as const;

export type CanonicalJurisdiction = (typeof CANONICAL_JURISDICTIONS)[keyof typeof CANONICAL_JURISDICTIONS];

/**
 * Country and regime names a user is likely to type, mapped to the canonical
 * jurisdiction whose pack actually covers them.
 *
 * Someone scanning a German shop reasonably types "Germany"; no pack matches
 * that spelling, and without this the tool would only be able to say "no
 * pack matched" without saying which one they wanted.
 */
export const JURISDICTION_ALIASES: Record<string, CanonicalJurisdiction> = {
  // EU member states.
  austria: "European Union",
  belgium: "European Union",
  bulgaria: "European Union",
  croatia: "European Union",
  cyprus: "European Union",
  czechia: "European Union",
  "czech republic": "European Union",
  denmark: "European Union",
  estonia: "European Union",
  finland: "European Union",
  france: "European Union",
  germany: "European Union",
  greece: "European Union",
  hungary: "European Union",
  ireland: "European Union",
  italy: "European Union",
  latvia: "European Union",
  lithuania: "European Union",
  luxembourg: "European Union",
  malta: "European Union",
  netherlands: "European Union",
  "the netherlands": "European Union",
  poland: "European Union",
  portugal: "European Union",
  romania: "European Union",
  slovakia: "European Union",
  slovenia: "European Union",
  spain: "European Union",
  sweden: "European Union",
  eea: "European Union",
  "european economic area": "European Union",
  europe: "European Union",
  gdpr: "European Union",
  // Other covered markets, by their common names.
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  wales: "United Kingdom",
  "northern ireland": "United Kingdom",
  usa: "United States",
  america: "United States",
  "united states of america": "United States",
  california: "United States - California",
  ccpa: "United States - California",
  cpra: "United States - California",
  brasil: "Brazil",
  lgpd: "Brazil",
  pipeda: "Canada",
  appi: "Japan",
  nippon: "Japan",
  bharat: "India",
  dpdp: "India",
  "privacy act": "Australia",
  // Newly covered markets, by the names people actually type.
  prc: "China",
  "peoples republic of china": "China",
  "people's republic of china": "China",
  pipl: "China",
  korea: "South Korea",
  "republic of korea": "South Korea",
  pipa: "South Korea",
  swiss: "Switzerland",
  schweiz: "Switzerland",
  suisse: "Switzerland",
  fadp: "Switzerland",
  quebec: "Canada - Quebec",
  "québec": "Canada - Quebec",
  "law 25": "Canada - Quebec",
  thai: "Thailand",
  popia: "South Africa",
  rsa: "South Africa",
  ksa: "Saudi Arabia",
  "kingdom of saudi arabia": "Saudi Arabia",
  ndpa: "Nigeria",
  ndpr: "Nigeria",
};

export type SignalKind =
  | "hreflang"
  | "cctld"
  | "html-lang"
  | "currency"
  | "legal-document"
  | "regulation-mention"
  | "consent-management-platform"
  | "locale-selector";

export interface ScopeSignal {
  kind: SignalKind;
  /** The jurisdiction this signal points at. */
  jurisdiction: CanonicalJurisdiction;
  /**
   * How much this signal is worth. Declarations the site makes about itself
   * (hreflang, a country domain, a jurisdiction-specific legal document)
   * outweigh incidental content (a currency symbol, a language tag).
   */
  weight: number;
  /** Human-readable description of what was observed, for the report. */
  detail: string;
  /** Where it was observed, so a reviewer can check it. */
  observedAt: string;
}

export interface SectorSignal {
  sector: string;
  weight: number;
  detail: string;
}

/**
 * Country-code TLDs that indicate a target market a pack covers. A ccTLD is
 * a strong signal because it is a deliberate, paid-for choice, but it is not
 * conclusive: `.io` and `.co` are sold as generic domains, and are therefore
 * absent here rather than mapped to their nominal territories.
 */
export const CCTLD_MARKETS: Record<string, CanonicalJurisdiction> = {
  // EU member states.
  at: CANONICAL_JURISDICTIONS.EU,
  be: CANONICAL_JURISDICTIONS.EU,
  bg: CANONICAL_JURISDICTIONS.EU,
  hr: CANONICAL_JURISDICTIONS.EU,
  cy: CANONICAL_JURISDICTIONS.EU,
  cz: CANONICAL_JURISDICTIONS.EU,
  dk: CANONICAL_JURISDICTIONS.EU,
  ee: CANONICAL_JURISDICTIONS.EU,
  fi: CANONICAL_JURISDICTIONS.EU,
  fr: CANONICAL_JURISDICTIONS.EU,
  de: CANONICAL_JURISDICTIONS.EU,
  gr: CANONICAL_JURISDICTIONS.EU,
  hu: CANONICAL_JURISDICTIONS.EU,
  ie: CANONICAL_JURISDICTIONS.EU,
  it: CANONICAL_JURISDICTIONS.EU,
  lv: CANONICAL_JURISDICTIONS.EU,
  lt: CANONICAL_JURISDICTIONS.EU,
  lu: CANONICAL_JURISDICTIONS.EU,
  mt: CANONICAL_JURISDICTIONS.EU,
  nl: CANONICAL_JURISDICTIONS.EU,
  pl: CANONICAL_JURISDICTIONS.EU,
  pt: CANONICAL_JURISDICTIONS.EU,
  ro: CANONICAL_JURISDICTIONS.EU,
  sk: CANONICAL_JURISDICTIONS.EU,
  si: CANONICAL_JURISDICTIONS.EU,
  es: CANONICAL_JURISDICTIONS.EU,
  se: CANONICAL_JURISDICTIONS.EU,
  eu: CANONICAL_JURISDICTIONS.EU,
  // Other markets with a pack.
  uk: CANONICAL_JURISDICTIONS.UK,
  gb: CANONICAL_JURISDICTIONS.UK,
  au: CANONICAL_JURISDICTIONS.AU,
  br: CANONICAL_JURISDICTIONS.BR,
  ca: CANONICAL_JURISDICTIONS.CA,
  jp: CANONICAL_JURISDICTIONS.JP,
  in: CANONICAL_JURISDICTIONS.IN,
  us: CANONICAL_JURISDICTIONS.US,
  cn: CANONICAL_JURISDICTIONS.CN,
  kr: CANONICAL_JURISDICTIONS.KR,
  ch: CANONICAL_JURISDICTIONS.CH,
  th: CANONICAL_JURISDICTIONS.TH,
  sg: CANONICAL_JURISDICTIONS.SG,
  za: CANONICAL_JURISDICTIONS.ZA,
  ng: CANONICAL_JURISDICTIONS.NG,
  // .sa is Saudi Arabia's ccTLD; the alias map handles the spelled-out name.
  sa: CANONICAL_JURISDICTIONS.SA,
};

/**
 * Region subtags from `hreflang` / `lang`. The region half of a language tag
 * is the site telling you which market a page is for, which is why it
 * carries more weight than any inferred signal.
 */
export const REGION_MARKETS: Record<string, CanonicalJurisdiction> = {
  ...Object.fromEntries(
    Object.entries(CCTLD_MARKETS).map(([code, market]) => [code.toUpperCase(), market])
  ),
};

/**
 * Languages that, on their own, suggest a market. Deliberately conservative:
 * a language is a weak proxy for a jurisdiction (German is spoken in
 * Germany, Austria and Switzerland; Spanish across Spain and Latin America;
 * English almost everywhere), so only languages whose speaker base sits
 * overwhelmingly inside one covered market appear here, at a low weight.
 */
export const LANGUAGE_MARKETS: Record<string, CanonicalJurisdiction> = {
  de: CANONICAL_JURISDICTIONS.EU,
  fr: CANONICAL_JURISDICTIONS.EU,
  it: CANONICAL_JURISDICTIONS.EU,
  nl: CANONICAL_JURISDICTIONS.EU,
  pl: CANONICAL_JURISDICTIONS.EU,
  sv: CANONICAL_JURISDICTIONS.EU,
  da: CANONICAL_JURISDICTIONS.EU,
  fi: CANONICAL_JURISDICTIONS.EU,
  cs: CANONICAL_JURISDICTIONS.EU,
  el: CANONICAL_JURISDICTIONS.EU,
  hu: CANONICAL_JURISDICTIONS.EU,
  ro: CANONICAL_JURISDICTIONS.EU,
  ja: CANONICAL_JURISDICTIONS.JP,
  hi: CANONICAL_JURISDICTIONS.IN,
  ko: CANONICAL_JURISDICTIONS.KR,
  th: CANONICAL_JURISDICTIONS.TH,
  // Chinese is written in several markets, so only the mainland-simplified
  // tag is mapped, and only weakly.
  zh: CANONICAL_JURISDICTIONS.CN,
  af: CANONICAL_JURISDICTIONS.ZA,
};

/**
 * Currency indicators. The euro and pound map cleanly; the dollar sign does
 * not (it is used by the US, Canada, Australia and others), so a bare `$` is
 * never mapped and only the disambiguated forms are.
 */
export const CURRENCY_MARKETS: Array<{ pattern: RegExp; jurisdiction: CanonicalJurisdiction; label: string }> = [
  { pattern: /€|\bEUR\b/, jurisdiction: CANONICAL_JURISDICTIONS.EU, label: "euro prices" },
  { pattern: /£|\bGBP\b/, jurisdiction: CANONICAL_JURISDICTIONS.UK, label: "pound sterling prices" },
  { pattern: /\bUSD\b|\bUS\$/, jurisdiction: CANONICAL_JURISDICTIONS.US, label: "US dollar prices" },
  { pattern: /\bAUD\b|\bA\$/, jurisdiction: CANONICAL_JURISDICTIONS.AU, label: "Australian dollar prices" },
  { pattern: /\bCAD\b|\bC\$/, jurisdiction: CANONICAL_JURISDICTIONS.CA, label: "Canadian dollar prices" },
  { pattern: /R\$|\bBRL\b/, jurisdiction: CANONICAL_JURISDICTIONS.BR, label: "Brazilian real prices" },
  { pattern: /₹|\bINR\b/, jurisdiction: CANONICAL_JURISDICTIONS.IN, label: "Indian rupee prices" },
  { pattern: /\bJPY\b|円/, jurisdiction: CANONICAL_JURISDICTIONS.JP, label: "Japanese yen prices" },
  { pattern: /\bCNY\b|\bRMB\b|元(?!素)/, jurisdiction: CANONICAL_JURISDICTIONS.CN, label: "Chinese yuan prices" },
  // The yen sign is also the yuan sign. Rather than picking one and being
  // confidently wrong half the time, it is reported for both markets, and
  // says so - a reviewer can then look at the page.
  { pattern: /[¥￥]/, jurisdiction: CANONICAL_JURISDICTIONS.JP, label: "the ¥ sign, which denotes either yen or yuan" },
  { pattern: /[¥￥]/, jurisdiction: CANONICAL_JURISDICTIONS.CN, label: "the ¥ sign, which denotes either yen or yuan" },
  { pattern: /₩|\bKRW\b|원/, jurisdiction: CANONICAL_JURISDICTIONS.KR, label: "Korean won prices" },
  { pattern: /\bCHF\b|\bFr\.\s?\d/, jurisdiction: CANONICAL_JURISDICTIONS.CH, label: "Swiss franc prices" },
  { pattern: /฿|\bTHB\b/, jurisdiction: CANONICAL_JURISDICTIONS.TH, label: "Thai baht prices" },
  { pattern: /\bSGD\b|\bS\$/, jurisdiction: CANONICAL_JURISDICTIONS.SG, label: "Singapore dollar prices" },
  // `\bR\d` matched "R2" in any product code or room number. A rand price is
  // an R followed by a real amount and nothing alphanumeric after it.
  { pattern: /\bZAR\b|(^|[\s>(])R\s?\d{2,}(?:[.,]\d{2})?(?![\w])/m, jurisdiction: CANONICAL_JURISDICTIONS.ZA, label: "South African rand prices" },
  { pattern: /\bSAR\b|﷼/, jurisdiction: CANONICAL_JURISDICTIONS.SA, label: "Saudi riyal prices" },
  { pattern: /₦|\bNGN\b/, jurisdiction: CANONICAL_JURISDICTIONS.NG, label: "Nigerian naira prices" },
];

/**
 * Jurisdiction-specific legal documents and disclosures. Publishing one of
 * these is a deliberate act of compliance with a particular regime, which
 * makes it among the most reliable signals available.
 */
export const LEGAL_DOCUMENT_MARKETS: Array<{
  pattern: RegExp;
  jurisdiction: CanonicalJurisdiction;
  label: string;
}> = [
  { pattern: /\bimpressum\b/i, jurisdiction: CANONICAL_JURISDICTIONS.EU, label: "an Impressum (German/Austrian disclosure duty)" },
  { pattern: /mentions l[eé]gales/i, jurisdiction: CANONICAL_JURISDICTIONS.EU, label: "mentions légales (French disclosure duty)" },
  { pattern: /do not sell (or share )?my personal (information|data)/i, jurisdiction: CANONICAL_JURISDICTIONS.US_CA, label: "a 'Do Not Sell or Share' link" },
  { pattern: /your california privacy rights/i, jurisdiction: CANONICAL_JURISDICTIONS.US_CA, label: "a California privacy rights notice" },
  { pattern: /\bcookiebeleid\b|\bcookie-richtlinie\b/i, jurisdiction: CANONICAL_JURISDICTIONS.EU, label: "a localised EU cookie policy" },
];

/** Explicit mentions of a regulation by name in the page or its legal documents. */
export const REGULATION_MENTIONS: Array<{ pattern: RegExp; jurisdiction: CanonicalJurisdiction; label: string }> = [
  { pattern: /\bGDPR\b|General Data Protection Regulation|\bDSGVO\b|\bRGPD\b/i, jurisdiction: CANONICAL_JURISDICTIONS.EU, label: "GDPR" },
  { pattern: /\bUK GDPR\b|\bPECR\b|Information Commissioner/i, jurisdiction: CANONICAL_JURISDICTIONS.UK, label: "UK GDPR / PECR / the Information Commissioner" },
  // Case-sensitive, and guarded against a preceding dot or slash: the
  // case-insensitive `\bICO\b` matched the "ico" in every `favicon.ico`
  // link on the web, which put the United Kingdom in scope for essentially
  // every site scanned.
  { pattern: /(?<![./\w])ICO(?!\w)/, jurisdiction: CANONICAL_JURISDICTIONS.UK, label: "the ICO named on the page" },
  { pattern: /\bCCPA\b|\bCPRA\b/i, jurisdiction: CANONICAL_JURISDICTIONS.US_CA, label: "CCPA/CPRA" },
  { pattern: /\bLGPD\b|Lei Geral de Prote/i, jurisdiction: CANONICAL_JURISDICTIONS.BR, label: "LGPD" },
  { pattern: /\bPIPEDA\b|Personal Information Protection and Electronic Documents/i, jurisdiction: CANONICAL_JURISDICTIONS.CA, label: "PIPEDA" },
  { pattern: /\bAPPI\b|個人情報保護法/i, jurisdiction: CANONICAL_JURISDICTIONS.JP, label: "APPI" },
  { pattern: /\bDPDP\b|Digital Personal Data Protection Act/i, jurisdiction: CANONICAL_JURISDICTIONS.IN, label: "the DPDP Act" },
  { pattern: /Privacy Act 1988|Australian Privacy Principles/i, jurisdiction: CANONICAL_JURISDICTIONS.AU, label: "the Australian Privacy Act" },
  { pattern: /\bPIPL\b|个人信息保护法/i, jurisdiction: CANONICAL_JURISDICTIONS.CN, label: "PIPL" },
  { pattern: /\bPIPA\b|개인정보 ?보호법/i, jurisdiction: CANONICAL_JURISDICTIONS.KR, label: "PIPA" },
  { pattern: /\bnFADP\b|revFADP|Datenschutzgesetz|\bFADP\b|\bDSG\b/i, jurisdiction: CANONICAL_JURISDICTIONS.CH, label: "the Swiss FADP" },
  { pattern: /\bLaw ?25\b|Loi ?25|Commission d'acc[eè]s [aà] l'information/i, jurisdiction: CANONICAL_JURISDICTIONS.CA_QC, label: "Quebec Law 25" },
  { pattern: /\bPOPIA\b|Protection of Personal Information Act/i, jurisdiction: CANONICAL_JURISDICTIONS.ZA, label: "POPIA" },
  { pattern: /\bSDAIA\b|Saudi Personal Data Protection/i, jurisdiction: CANONICAL_JURISDICTIONS.SA, label: "the Saudi PDPL" },
  { pattern: /\bNDPA\b|\bNDPR\b|Nigeria Data Protection/i, jurisdiction: CANONICAL_JURISDICTIONS.NG, label: "the Nigeria Data Protection Act" },
  { pattern: /\bPDPC\b|Personal Data Protection Act B\.E\./i, jurisdiction: CANONICAL_JURISDICTIONS.TH, label: "the Thai PDPA" },
];

/**
 * Sector keywords. Sector drives pack applicability for the European
 * Accessibility Act and the Consumer Rights Directive, so a wrong guess
 * changes which rules run - which is why a detected sector is always
 * reported with its evidence rather than applied silently.
 */
export const SECTOR_PATTERNS: Array<{ sector: string; pattern: RegExp; label: string }> = [
  { sector: "e-commerce", pattern: /add to (cart|basket)|shopping (cart|basket)|proceed to checkout|continue to payment/i, label: "cart and checkout controls" },
  { sector: "banking", pattern: /open an account|account balance|\bIBAN\b|sort code|routing number|apply for a (loan|mortgage|credit card)/i, label: "consumer banking language" },
  { sector: "insurance", pattern: /get a quote|policy (coverage|premium)|make a claim|insurance (cover|policy)/i, label: "insurance product language" },
  { sector: "transport", pattern: /book (a )?(flight|ticket|journey|trip)|departure|arrival|passenger|boarding|fare\b/i, label: "passenger transport booking language" },
  { sector: "telecommunications", pattern: /mobile plan|data allowance|broadband|sim (card|only)|monthly minutes/i, label: "telecoms product language" },
  { sector: "media", pattern: /watch (now|online)|stream (now|episodes)|episodes?\b|subtitles|audio description/i, label: "audiovisual media language" },
  { sector: "e-books", pattern: /e-?book|read (a )?sample|kindle|epub/i, label: "e-book retail language" },
  { sector: "health", pattern: /patient|prescription|symptom|medical record|book an appointment with a (doctor|gp)/i, label: "health service language" },
  { sector: "saas", pattern: /free trial|per (user|seat)\/month|start (your )?free trial|api (key|documentation)|pricing plans?/i, label: "software subscription language" },
];

/** Consent management platforms, which are deployed almost exclusively for EU/UK regimes. */
export const CMP_DOMAINS: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /(^|\.)cookiebot\.com$/i, vendor: "Cookiebot" },
  { pattern: /(^|\.)onetrust\.com$/i, vendor: "OneTrust" },
  { pattern: /(^|\.)cookielaw\.org$/i, vendor: "OneTrust" },
  { pattern: /(^|\.)trustarc\.com$/i, vendor: "TrustArc" },
  { pattern: /(^|\.)usercentrics\.eu$/i, vendor: "Usercentrics" },
  { pattern: /(^|\.)cookieyes\.com$/i, vendor: "CookieYes" },
  { pattern: /(^|\.)iubenda\.com$/i, vendor: "iubenda" },
  { pattern: /(^|\.)quantcast\.com$/i, vendor: "Quantcast Choice" },
  { pattern: /(^|\.)didomi\.io$/i, vendor: "Didomi" },
];
