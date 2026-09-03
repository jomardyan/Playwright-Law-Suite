import { describe, expect, it } from "vitest";
import { analyzeDisclosureText, matchDocumentLinks, type LinkCandidate } from "../src/modules/privacy/PrivacyDocumentScanner.js";

const link = (text: string, href: string): LinkCandidate => ({ text, href });

function urlFor(label: string, links: LinkCandidate[]): string | null {
  return matchDocumentLinks(links).find((doc) => doc.label === label)?.url ?? null;
}

describe("matchDocumentLinks", () => {
  it("finds a notice linked by href when the link text is only 'Privacy'", () => {
    // The overwhelmingly common real-world footer. Missing it turned into a
    // critical "no privacy policy" finding on sites that publish one.
    expect(urlFor("privacy-policy", [link("Privacy", "https://example.com/privacy-policy")])).toBe(
      "https://example.com/privacy-policy"
    );
    expect(urlFor("privacy-policy", [link("Legal", "https://example.com/legal/privacy_policy")])).toBe(
      "https://example.com/legal/privacy_policy"
    );
    expect(urlFor("privacy-policy", [link("Read our policy", "https://example.com/privacy/")])).toBe(
      "https://example.com/privacy/"
    );
  });

  it("finds notices in the languages of the markets the packs cover", () => {
    const cases: Array<[string, string]> = [
      ["Datenschutzerklärung", "https://example.de/datenschutz"],
      ["Politique de confidentialité", "https://example.fr/vie-privee"],
      ["Política de privacidad", "https://example.es/legal/1"],
      ["Informativa sulla privacy", "https://example.it/legal/2"],
      ["Privacyverklaring", "https://example.nl/legal/3"],
      ["Polityka prywatności", "https://example.pl/legal/4"],
      ["プライバシーポリシー", "https://example.jp/legal/5"],
      ["개인정보처리방침", "https://example.kr/legal/6"],
      ["隐私政策", "https://example.cn/legal/7"],
    ];
    for (const [text, href] of cases) {
      expect(urlFor("privacy-policy", [link(text, href)]), text).toBe(href);
    }
  });

  it("prefers the document over a control with similar wording", () => {
    const found = urlFor("privacy-policy", [
      link("Privacy settings", "https://example.com/privacy-settings"),
      link("Privacy Policy", "https://example.com/privacy-policy"),
    ]);
    expect(found).toBe("https://example.com/privacy-policy");
  });

  it("does not mistake a consent control for the published notice", () => {
    expect(urlFor("privacy-policy", [link("Cookie preferences", "https://example.com/cookie-preferences")])).toBeNull();
    expect(urlFor("cookie-policy", [link("Cookie settings", "https://example.com/cookie-settings")])).toBeNull();
  });

  it("ignores marketing pages that merely talk about privacy", () => {
    expect(urlFor("privacy-policy", [link("Our privacy blog", "https://example.com/blog/privacy-matters")])).toBeNull();
  });

  it("ignores links that open no document", () => {
    expect(urlFor("privacy-policy", [link("Privacy Policy", "javascript:void(0)")])).toBeNull();
    expect(urlFor("privacy-policy", [link("Privacy Policy", "mailto:privacy@example.com")])).toBeNull();
  });

  it("separates cookie, terms and accessibility documents from the privacy notice", () => {
    const links = [
      link("Privacy Policy", "https://example.com/privacy"),
      link("Cookie Policy", "https://example.com/cookies"),
      link("Terms of Service", "https://example.com/terms"),
      link("Accessibility Statement", "https://example.com/accessibility"),
      link("Do Not Sell or Share My Personal Information", "https://example.com/do-not-sell"),
    ];
    const documents = matchDocumentLinks(links);
    expect(documents.find((d) => d.label === "cookie-policy")?.url).toBe("https://example.com/cookies");
    expect(documents.find((d) => d.label === "terms")?.url).toBe("https://example.com/terms");
    expect(documents.find((d) => d.label === "accessibility-statement")?.url).toBe("https://example.com/accessibility");
    expect(documents.find((d) => d.label === "do-not-sell")?.url).toBe("https://example.com/do-not-sell");
  });

  it("reports no URL when nothing matches, rather than picking the first link", () => {
    const documents = matchDocumentLinks([link("Home", "https://example.com/"), link("Shop", "https://example.com/shop")]);
    expect(documents.every((doc) => doc.url === null)).toBe(true);
  });

  it("keeps the link text as evidence for the document it chose", () => {
    const documents = matchDocumentLinks([link("Datenschutzerklärung", "https://example.de/datenschutz")]);
    expect(documents.find((d) => d.label === "privacy-policy")?.linkText).toBe("Datenschutzerklärung");
  });
});

describe("analyzeDisclosureText", () => {
  const statusOf = (text: string, category: string) =>
    analyzeDisclosureText(text).find((entry) => entry.category === category)?.status;

  it("detects a topic from wording that only appears when it is addressed", () => {
    expect(statusOf("We are the data controller for your information.", "controller-identity")).toBe("detected");
    expect(statusOf("Our legal basis is legitimate interest.", "legal-bases")).toBe("detected");
    expect(statusOf("You have the right to erasure at any time.", "data-subject-rights")).toBe("detected");
    expect(statusOf("You may lodge a complaint with the supervisory authority.", "supervisory-authority")).toBe("detected");
    expect(statusOf("You can withdraw your consent at any time.", "consent-withdrawal")).toBe("detected");
    expect(statusOf("We keep your data for 24 months; see our retention period.", "retention-periods")).toBe("detected");
  });

  it("detects topics in a notice that is not written in English", () => {
    const german =
      "Verantwortliche Stelle ist die Beispiel GmbH. Rechtsgrundlage ist Art. 6 DSGVO. Sie haben ein Recht auf Auskunft und ein Recht auf Löschung. Beschwerde bei der Aufsichtsbehörde ist möglich. Die Speicherdauer beträgt 24 Monate.";
    expect(statusOf(german, "controller-identity")).toBe("detected");
    expect(statusOf(german, "legal-bases")).toBe("detected");
    expect(statusOf(german, "data-subject-rights")).toBe("detected");
    expect(statusOf(german, "supervisory-authority")).toBe("detected");
    expect(statusOf(german, "retention-periods")).toBe("detected");
  });

  it("marks incidental wording as potentially incomplete rather than as coverage", () => {
    // "we never share your data with third parties" is not a recipients
    // disclosure, but it is not silence on the topic either.
    expect(statusOf("We never share your data with third parties.", "recipients")).toBe("potentially-incomplete");
    expect(statusOf("Questions? Email hello@example.com.", "controller-contact")).toBe("potentially-incomplete");
  });

  it("promotes a contact to detected when it is identified as the privacy route", () => {
    expect(statusOf("For privacy questions write to privacy@example.com.", "controller-contact")).toBe("detected");
  });

  it("reports a topic the notice never touches as missing", () => {
    const text = "This is a short page about our products.";
    expect(statusOf(text, "international-transfers")).toBe("missing");
    expect(statusOf(text, "dpo-information")).toBe("missing");
  });

  it("does not fire on a word that merely contains a keyword's letters", () => {
    // `text.includes("dpo")` matched anything with those three letters in it.
    expect(statusOf("Our endpoints are documented at /api.", "dpo-information")).toBe("missing");
  });
});
