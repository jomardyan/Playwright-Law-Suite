import type { RegulatoryPack, Rule } from "../../engine/types.js";
import { buildFinding, defineRule } from "../helpers.js";

const PACK_ID = "eu-ai-act-transparency";
const REGULATION = "EU AI Act (Regulation (EU) 2024/1689) - Article 50 transparency";
const JURISDICTION = "European Union";

const aiInteractionDisclosed = defineRule({
  id: "ai-act-interaction-disclosure",
  requirement:
    "An AI system intended to interact directly with people must be designed so that the person is informed they are interacting with an AI system, unless that is obvious to a reasonably well-informed person.",
  severity: "high",
  confidence: "medium",
  automationLevel: "partially-automated",
  legalReference: "Regulation (EU) 2024/1689 Art. 50(1) (applies from 2 August 2026)",
  remediation:
    "State that the visitor is interacting with an AI system before or at the very start of the conversation, in a clear and distinguishable way, and in a form that itself meets the applicable accessibility requirements.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const report = page.aiInteraction;
      if (!report || report.interactionSignals.length === 0) continue;
      if (report.disclosureSignals.length > 0) continue;
      findings.push(
        buildFinding(aiInteractionDisclosed, PACK_ID, REGULATION, JURISDICTION, {
          status: "probable-violation",
          affectedUrl: page.url,
          affectedElement: report.interactionSignals[0]?.detail,
          observedBehavior: `The page loads an AI-interaction surface (${report.interactionSignals
            .map((s) => s.detail)
            .join("; ")}) but no text disclosing that the visitor is dealing with an AI system was found.`,
          expectedBehavior:
            "The visitor is told they are interacting with an AI system, at the latest at the point of first interaction.",
          evidence: [context.evidence.note("AI interaction detection", report)],
        })
      );
    }
    return findings;
  },
});

const disclosureTiming = defineRule({
  id: "ai-act-disclosure-timing",
  requirement:
    "The AI-interaction disclosure must be given at the latest at the time of the first interaction or exposure, not after the conversation has started.",
  severity: "medium",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Regulation (EU) 2024/1689 Art. 50(1) and 50(5)",
  remediation:
    "Show the disclosure in the widget's opening state, before the visitor sends a first message, rather than inside a transcript, a tooltip, or the terms of service.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const report = page.aiInteraction;
      if (!report || report.interactionSignals.length === 0) continue;
      if (report.disclosureSignals.length === 0) continue;
      findings.push(
        buildFinding(disclosureTiming, PACK_ID, REGULATION, JURISDICTION, {
          status: "manual-review",
          affectedUrl: page.url,
          observedBehavior: `Disclosure-like text was found on the page (${report.disclosureSignals
            .map((s) => s.detail)
            .join("; ")}), but whether it is presented before the first interaction cannot be established by scanning the page.`,
          expectedBehavior:
            "The disclosure is visible before or at the very beginning of the interaction, clearly and distinguishably.",
          evidence: [context.evidence.note("AI disclosure signals", report.disclosureSignals)],
          manualReviewRequired: true,
        })
      );
    }
    return findings;
  },
});

const generatedContentMarking = defineRule({
  id: "ai-act-generated-content-marking",
  requirement:
    "Synthetic audio, image, video, or text content must be marked in a machine-readable format and detectable as artificially generated or manipulated; deep fakes and AI-generated text published to inform the public on matters of public interest must additionally be disclosed to the audience.",
  severity: "medium",
  confidence: "low",
  automationLevel: "evidence-only",
  legalReference: "Regulation (EU) 2024/1689 Art. 50(2) and 50(4)",
  remediation:
    "Apply machine-readable provenance marking (for example C2PA Content Credentials or an equivalent watermark) to generated media, and label deep fakes and public-interest AI-generated text visibly for the audience.",
  run: (context) => {
    const findings = [];
    for (const page of context.pages) {
      const report = page.aiInteraction;
      if (!report || report.generatedContentSignals.length === 0) continue;
      findings.push(
        buildFinding(generatedContentMarking, PACK_ID, REGULATION, JURISDICTION, {
          status: "manual-review",
          affectedUrl: page.url,
          observedBehavior: `The page states that it carries AI-generated content (${report.generatedContentSignals
            .map((s) => s.detail)
            .join("; ")}). Whether that content also carries machine-readable provenance marking cannot be verified from the rendered page.`,
          expectedBehavior:
            "Generated content is both visibly labelled where required and marked machine-readably as artificially generated.",
          evidence: [context.evidence.note("AI-generated content signals", report.generatedContentSignals)],
          manualReviewRequired: true,
        })
      );
    }
    return findings;
  },
});

const systemInventory = defineRule({
  id: "ai-act-system-classification",
  requirement:
    "A deployer must know which AI systems its service exposes and how each is classified under the AI Act, since the obligations that attach to it follow from that classification.",
  severity: "manual-review",
  confidence: "low",
  automationLevel: "manual-review-required",
  legalReference: "Regulation (EU) 2024/1689 Art. 6, Art. 50, Annex III",
  remediation:
    "Maintain an inventory of the AI systems the service exposes to users, record the role held for each (provider or deployer) and its risk classification, and attach the transparency measures that classification requires.",
  run: (context) => {
    const pagesWithAi = context.pages.filter((page) => (page.aiInteraction?.interactionSignals.length ?? 0) > 0);
    if (pagesWithAi.length === 0) return [];
    const detected = Array.from(
      new Set(pagesWithAi.flatMap((page) => page.aiInteraction?.interactionSignals.map((s) => s.detail) ?? []))
    );
    return [
      buildFinding(systemInventory, PACK_ID, REGULATION, JURISDICTION, {
        status: "manual-review",
        affectedUrl: pagesWithAi[0].url,
        observedBehavior: `AI-interaction surfaces were detected on ${pagesWithAi.length} page(s): ${detected.join("; ")}. Their AI Act classification, and whether the operator is provider or deployer for each, is a legal determination.`,
        expectedBehavior:
          "Each AI system exposed to users is inventoried, classified, and covered by the transparency measures its classification requires.",
        evidence: [context.evidence.note("Detected AI interaction surfaces", detected)],
        manualReviewRequired: true,
      }),
    ];
  },
});

export const euAiActPack: RegulatoryPack = {
  id: PACK_ID,
  jurisdiction: JURISDICTION,
  country: "EU",
  regulation: REGULATION,
  authority: "European AI Office and national market surveillance authorities",
  version: "1.0.0",
  effectiveDate: "2026-08-02",
  applicability: (config) =>
    config.jurisdictions.some((j) => /european union|eu\b|eea|ai act/i.test(j)) ||
    (config.customerMarkets ?? []).some((m) => /european union|eu\b|eea/i.test(m)),
  rules: [aiInteractionDisclosed, disclosureTiming, generatedContentMarking, systemInventory] as Rule[],
};
