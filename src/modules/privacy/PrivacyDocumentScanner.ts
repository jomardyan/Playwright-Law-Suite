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
}

const DOCUMENT_LINK_PATTERNS: Array<{ label: PrivacyDocument["label"]; pattern: RegExp }> = [
  { label: "privacy-policy", pattern: /privacy (policy|notice)/i },
  { label: "cookie-policy", pattern: /cookie (policy|notice)/i },
  { label: "terms", pattern: /terms (and conditions|of (use|service))|terms$/i },
  { label: "do-not-sell", pattern: /do not sell|do not share|opt-?out of sale/i },
  { label: "data-rights", pattern: /your (privacy )?rights|data subject rights|manage your data/i },
  { label: "accessibility-statement", pattern: /accessibility statement/i },
];

/**
 * GDPR-oriented disclosure categories. Presence of matching keywords in a
 * privacy document is evidence the topic is *addressed*, not that the legal
 * substance is correct - hence the deliberately hedged status values.
 */
const GDPR_DISCLOSURE_KEYWORDS: Record<string, string[]> = {
  "controller-identity": ["data controller", "controller of your data", "we are the controller"],
  "controller-contact": ["contact us at", "contact our", "data protection contact"],
  "dpo-information": ["data protection officer", "dpo"],
  "processing-purposes": ["purpose of processing", "why we process", "we use your data to"],
  "legal-bases": ["legal basis", "legitimate interest", "legal grounds for processing"],
  recipients: ["we share your data with", "third parties", "recipients of your data"],
  "international-transfers": ["international transfer", "outside the eea", "standard contractual clauses"],
  "retention-periods": ["retention period", "how long we keep", "we retain your data for"],
  "data-subject-rights": ["right to access", "right to erasure", "right to object", "right to rectification"],
  "supervisory-authority": ["supervisory authority", "data protection authority", "lodge a complaint"],
  "consent-withdrawal": ["withdraw your consent", "withdraw consent at any time"],
  "automated-decision-making": ["automated decision-making", "profiling"],
};

function evaluateKeywords(text: string, keywordMap: Record<string, string[]>): DisclosureCategoryResult[] {
  const lower = text.toLowerCase();
  return Object.entries(keywordMap).map(([category, keywords]) => {
    const matched = keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
    return {
      category,
      status: matched.length > 0 ? "detected" : "missing",
      matchedKeywords: matched,
    } as DisclosureCategoryResult;
  });
}

/**
 * Locates privacy-relevant documents linked from the page and performs a
 * keyword-based disclosure scan. This never asserts legal correctness -
 * only whether the expected topic appears to be addressed in the text.
 */
export class PrivacyDocumentScanner {
  async findDocuments(page: Page): Promise<PrivacyDocument[]> {
    const links = await page
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((el) => ({ href: (el as HTMLAnchorElement).href, text: el.textContent ?? "" }))
      )
      .catch(() => [] as Array<{ href: string; text: string }>);

    const documents: PrivacyDocument[] = [];
    for (const { label, pattern } of DOCUMENT_LINK_PATTERNS) {
      const match = links.find((link) => pattern.test(link.text) || pattern.test(link.href));
      documents.push({
        label,
        url: match?.href ?? null,
        textLength: 0,
        disclosures: [],
      });
    }
    return documents;
  }

  async analyzeDocument(page: Page, document: PrivacyDocument): Promise<PrivacyDocument> {
    if (!document.url) return document;
    try {
      const docPage = await page.context().newPage();
      await docPage.goto(document.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const text = (await docPage.locator("body").innerText().catch(() => "")) ?? "";
      await docPage.close();
      const disclosures = document.label === "privacy-policy" ? evaluateKeywords(text, GDPR_DISCLOSURE_KEYWORDS) : [];
      return { ...document, textLength: text.length, disclosures };
    } catch {
      return document;
    }
  }
}
