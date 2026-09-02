export { ScanEngine } from "./engine/ScanEngine.js";
export { loadConfig, loadConfigFromObject } from "./config/loader.js";
export { DEFAULT_CONFIG } from "./config/schema.js";
export type { UniVerscanConfig } from "./config/schema.js";
export { PackLoader } from "./packs/PackLoader.js";
export { defineRule, buildFinding, notEvaluatedFinding } from "./packs/helpers.js";
export {
  writeReports,
  writeJsonReport,
  writeHtmlReport,
  writeJUnitReport,
  writeSarifReport,
  writeMarkdownReport,
  renderMarkdownReport,
  writeCsvReport,
  renderCsvReport,
  printConsoleReport,
} from "./reporters/index.js";
export { applyExceptions } from "./engine/ExceptionFilter.js";
export { detectScope } from "./engine/AutoScan.js";
export { ScopeDetector, ccTldOf, parseLanguageTag } from "./modules/scope/ScopeDetector.js";
export { resolveScope } from "./modules/scope/resolveScope.js";
export type { ScopeDetection, DetectedMarket, ScopeConfidence } from "./modules/scope/resolveScope.js";
export type { ScopeSignal, CanonicalJurisdiction } from "./modules/scope/signals.js";
export { CANONICAL_JURISDICTIONS } from "./modules/scope/signals.js";
export { diffReports, renderDiffMarkdown, findingKey } from "./engine/ReportDiff.js";
export type { ReportDiff } from "./engine/ReportDiff.js";
export { parseRobotsTxt, isAllowedByRobots } from "./utils/robots.js";
export type {
  Finding,
  Rule,
  RegulatoryPack,
  ScanContext,
  ScanReport,
  Severity,
  Confidence,
  AutomationLevel,
  FindingStatus,
  ThirdPartyServiceRecord,
  CoverageSummary,
  SuppressedFinding,
  ConsentState,
  Evidence,
} from "./engine/types.js";
