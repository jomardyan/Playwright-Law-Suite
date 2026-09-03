import type { Page, BrowserContext } from "playwright";
import type { UniVerscanConfig } from "../config/schema.js";
import type { EvidenceStore } from "./EvidenceStore.js";
import type { AxeViolationSummary, InteractionCheckResult } from "../modules/accessibility/AccessibilityScanner.js";
import type { PrivacyDocument } from "../modules/privacy/PrivacyDocumentScanner.js";
import type { FormRecord } from "../modules/forms/FormsScanner.js";
import type { ConsentFlowResult } from "../modules/cookies/CookieScanner.js";
import type { SecurityHeaderReport } from "../modules/security/SecurityHeaderScanner.js";
import type { AiInteractionReport } from "../modules/ai/AiInteractionDetector.js";
import type { ConsumerJourneyReport } from "../modules/consumer/ConsumerJourneyScanner.js";
import type { ScopeDetection } from "../modules/scope/resolveScope.js";

/**
 * Severity reflects impact if the underlying issue is real.
 * Confidence reflects how sure the automated check is that the issue is real.
 * The two are deliberately independent (e.g. "high severity, medium confidence").
 */
export type Severity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational"
  | "manual-review";

export type Confidence = "high" | "medium" | "low";

/**
 * Declares what a rule is capable of on its own. This is what prevents
 * UniVerscan from presenting automated output as a legal compliance verdict.
 */
export type AutomationLevel =
  | "fully-automated"
  | "partially-automated"
  | "evidence-only"
  | "manual-review-required";

export type FindingStatus =
  | "violation"
  | "probable-violation"
  | "risk"
  | "missing-disclosure"
  | "inconsistent"
  | "manual-review"
  | "not-evaluated"
  | "informational"
  | "pass";

export interface Evidence {
  type:
    | "screenshot"
    | "dom-fragment"
    | "accessibility-result"
    | "request-log"
    | "response-log"
    | "cookie-snapshot"
    | "storage-snapshot"
    | "http-headers"
    | "trace"
    | "console-output"
    | "source-reference"
    | "consent-sequence"
    | "note";
  description: string;
  data?: unknown;
  sourceFile?: string;
  sourceLine?: number;
}

export interface Finding {
  ruleId: string;
  packId: string;
  regulation: string;
  jurisdiction: string;
  requirement: string;
  status: FindingStatus;
  severity: Severity;
  confidence: Confidence;
  automationLevel: AutomationLevel;
  affectedUrl?: string;
  affectedElement?: string;
  observedBehavior: string;
  expectedBehavior: string;
  evidence: Evidence[];
  legalReference?: string;
  remediation?: string;
  manualReviewRequired?: boolean;
}

export interface ThirdPartyServiceRecord {
  domain: string;
  category: string;
  firstObservedOnPage: string;
  firstObservedAt: string;
  consentState: ConsentState;
  requestType: string;
  associatedScript?: string;
}

export type ConsentState =
  | "before-consent"
  | "reject-all"
  | "accept-all"
  | "custom-selection"
  | "withdrawn"
  /**
   * A visit made with a universal opt-out signal asserted (Global Privacy
   * Control: the `Sec-GPC: 1` request header plus
   * `navigator.globalPrivacyControl === true`), with no other consent
   * interaction. Several US state privacy laws treat this signal as a
   * legally binding opt-out request in its own right.
   */
  | "gpc-signal"
  | "unknown";

export interface CapturedState {
  consentState: ConsentState;
  url: string;
  cookies: Array<{ name: string; domain: string; secure: boolean; httpOnly: boolean; sameSite?: string }>;
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  thirdPartyRequests: Array<{ url: string; domain: string; resourceType: string; timestamp: string }>;
}

export interface DiscoveredRoute {
  url: string;
  label?: string;
  priority: number;
  source: "sitemap" | "link-crawl" | "framework-routes" | "config";
}

export interface PageContext {
  page: Page;
  browserContext: BrowserContext;
  url: string;
  route: DiscoveredRoute;
  consentFlow: ConsentFlowResult | null;
  accessibilityViolations: AxeViolationSummary[];
  interactionChecks: InteractionCheckResult[];
  forms: FormRecord[];
  privacyDocuments: PrivacyDocument[];
  /** Main-document transport/response headers, or null when the response was not captured. */
  securityHeaders: SecurityHeaderReport | null;
  /** Signals that the page exposes an AI system the visitor interacts with directly. */
  aiInteraction: AiInteractionReport | null;
  /** Consumer-protection signals: withdrawal controls, order-button labelling, urgency claims. */
  consumerJourney: ConsumerJourneyReport | null;
}

export interface SourceModeContext {
  repoPath: string;
  framework: string | null;
  localUrl: string | null;
  staticFindings: Finding[];
}

/**
 * The full context a Rule sees when it runs. Not every field is populated in
 * every mode: source-only scans have no `pages`, static-only repos have no
 * `source.localUrl`, etc. Rules must check for what they need and downgrade
 * to `not-evaluated` when a prerequisite is absent.
 */
export interface ScanContext {
  config: UniVerscanConfig;
  mode: "live" | "source" | "combined";
  pages: PageContext[];
  source?: SourceModeContext;
  thirdPartyServices: ThirdPartyServiceRecord[];
  evidence: EvidenceStore;
  startedAt: string;
}

/**
 * Progress sink the engine reports into during a scan. Declared here, not in
 * the CLI, so the engine depends on the contract rather than on a terminal:
 * a library consumer or a GUI can supply its own.
 */
export interface ScanProgress {
  start(phase: string, total?: number): void;
  step(label: string): void;
  finish(summary?: string): void;
  warn(message: string): void;
  stop(): void;
}

export interface Rule {
  id: string;
  requirement: string;
  severity: Severity;
  confidence: Confidence;
  automationLevel: AutomationLevel;
  legalReference?: string;
  remediation?: string;
  /**
   * Whether this rule depends on rendered browser pages (accessibility tree,
   * DOM, network capture, ...). Defaults to true. When a scan has no `pages`
   * (source-only mode with no running server), the engine reports such rules
   * as "not-evaluated" instead of calling run() and getting a silent empty
   * result, per the requirement that inaccessible/unrunnable checks must
   * never read as a pass.
   */
  requiresLivePages: boolean;
  /** Return false to skip this rule entirely for the current scan context. */
  applicable(context: ScanContext): boolean;
  run(context: ScanContext): Promise<Finding[]> | Finding[];
}

export interface RegulatoryPack {
  id: string;
  jurisdiction: string;
  country: string;
  regulation: string;
  authority: string;
  version: string;
  effectiveDate: string;
  sectorRestrictions?: string[];
  /** Whether this pack applies at all given the scan configuration. */
  applicability(config: UniVerscanConfig): boolean;
  rules: Rule[];
}

/**
 * A route that was discovered but could not be scanned. Kept in the report
 * rather than dropped: a page nobody could load is an unknown, and must not
 * read as either a pass or a failure.
 */
export interface UnreachablePage {
  url: string;
  /** Navigation error, or the HTTP status that made the page unusable. */
  reason: string;
  httpStatus: number | null;
}

export interface CoverageSummary {
  jurisdictionsSelected: string[];
  packsLoaded: string[];
  rulesEvaluated: number;
  rulesSkippedNotApplicable: number;
  rulesNotEvaluated: number;
  /** Pages that actually loaded and were handed to the rules. */
  pagesScanned: number;
  /** Pages that were discovered but could not be loaded. Never counted as scanned. */
  pagesUnreachable: number;
  manualReviewItems: number;
  /** Findings moved out of `findings` by an explicit, documented config exception. */
  findingsSuppressedByException: number;
}

/**
 * A finding that matched an accepted-risk exception in
 * `config.ignoredFindings`. Suppressed findings are never deleted: they are
 * moved to their own section of the report, together with the reason and
 * approver recorded in the config, so the accepted risk stays auditable.
 */
export interface SuppressedFinding {
  finding: Finding;
  reason: string;
  approvedBy?: string;
  expires?: string;
}

export interface ScanReport {
  meta: {
    tool: "UniVerscan";
    generatedAt: string;
    mode: "live" | "source" | "combined";
    target: { url?: string; repoPath?: string };
    jurisdictions: string[];
    packs: Array<{ id: string; regulation: string; version: string }>;
    /**
     * Present only for an autoscan. Records that the jurisdictions above
     * were inferred rather than supplied, together with the evidence for
     * each one, so a reader can tell a declared scope from a guessed one.
     */
    scopeDetection?: ScopeDetection;
  };
  findings: Finding[];
  /** Findings withheld from `findings` by a documented exception in the config. */
  suppressedFindings: SuppressedFinding[];
  /** Routes that could not be loaded, and why. */
  unreachablePages: UnreachablePage[];
  thirdPartyServices: ThirdPartyServiceRecord[];
  coverage: CoverageSummary;
  riskIndicators: {
    automatedTechnicalCoverage: number;
    detectedTechnicalConformity: number;
    unresolvedComplianceRisk: number;
    manualReviewWorkload: number;
    scanCompleteness: number;
  };
}
