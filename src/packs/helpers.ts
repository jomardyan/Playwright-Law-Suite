import type {
  AutomationLevel,
  Confidence,
  Evidence,
  Finding,
  FindingStatus,
  Rule,
  ScanContext,
  Severity,
} from "../engine/types.js";

export interface RuleDefinition {
  id: string;
  requirement: string;
  severity: Severity;
  confidence: Confidence;
  automationLevel: AutomationLevel;
  legalReference?: string;
  remediation?: string;
  /** Defaults to true - set false only for rules that work from context.source (static analysis) alone. */
  requiresLivePages?: boolean;
  applicable?: (context: ScanContext) => boolean;
  run: (context: ScanContext) => Promise<Finding[]> | Finding[];
}

/** Reduces pack boilerplate; every field still has to be set explicitly. */
export function defineRule(def: RuleDefinition): Rule {
  return {
    id: def.id,
    requirement: def.requirement,
    severity: def.severity,
    confidence: def.confidence,
    automationLevel: def.automationLevel,
    legalReference: def.legalReference,
    remediation: def.remediation,
    requiresLivePages: def.requiresLivePages ?? true,
    applicable: def.applicable ?? (() => true),
    run: def.run,
  };
}

export function buildFinding(
  rule: Rule,
  packId: string,
  regulation: string,
  jurisdiction: string,
  partial: Pick<Finding, "status" | "observedBehavior" | "expectedBehavior"> &
    Partial<Pick<Finding, "affectedUrl" | "affectedElement" | "evidence" | "manualReviewRequired">>
): Finding {
  return {
    ruleId: rule.id,
    packId,
    regulation,
    jurisdiction,
    requirement: rule.requirement,
    status: partial.status,
    severity: rule.severity,
    confidence: rule.confidence,
    automationLevel: rule.automationLevel,
    affectedUrl: partial.affectedUrl,
    affectedElement: partial.affectedElement,
    observedBehavior: partial.observedBehavior,
    expectedBehavior: partial.expectedBehavior,
    evidence: partial.evidence ?? [],
    legalReference: rule.legalReference,
    remediation: rule.remediation,
    manualReviewRequired: partial.manualReviewRequired ?? rule.automationLevel === "manual-review-required",
  };
}

export function notEvaluatedFinding(
  rule: Rule,
  packId: string,
  regulation: string,
  jurisdiction: string,
  reason: string
): Finding {
  return {
    ruleId: rule.id,
    packId,
    regulation,
    jurisdiction,
    requirement: rule.requirement,
    status: "not-evaluated" as FindingStatus,
    severity: rule.severity,
    confidence: rule.confidence,
    automationLevel: rule.automationLevel,
    observedBehavior: reason,
    expectedBehavior: rule.requirement,
    evidence: [],
    legalReference: rule.legalReference,
    remediation: rule.remediation,
    manualReviewRequired: true,
  };
}
