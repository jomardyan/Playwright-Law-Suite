import type { UniVerscanConfig } from "../config/schema.js";
import { BrowserManager } from "./BrowserManager.js";
import { SiteDiscovery } from "./SiteDiscovery.js";
import { EvidenceStore } from "./EvidenceStore.js";
import { AccessibilityScanner } from "../modules/accessibility/AccessibilityScanner.js";
import { CookieScanner } from "../modules/cookies/CookieScanner.js";
import { PrivacyDocumentScanner } from "../modules/privacy/PrivacyDocumentScanner.js";
import { FormsScanner } from "../modules/forms/FormsScanner.js";
import { NetworkIntelligence } from "../modules/network/NetworkIntelligence.js";
import { PackLoader } from "../packs/PackLoader.js";
import { notEvaluatedFinding } from "../packs/helpers.js";
import { detectFramework } from "../modules/source/FrameworkDetector.js";
import { startApplication } from "../modules/source/AppRunner.js";
import { runStaticAnalysis } from "../modules/source/StaticAnalyzer.js";
import { logger } from "../utils/logger.js";
import type { CoverageSummary, Finding, PageContext, ScanContext, ScanReport, ThirdPartyServiceRecord } from "./types.js";

function computeRiskIndicators(findings: Finding[], coverage: CoverageSummary, config: UniVerscanConfig) {
  const totalConsideredRules = coverage.rulesEvaluated + coverage.rulesSkippedNotApplicable;
  const violationStatuses = new Set(["violation", "probable-violation", "risk", "missing-disclosure", "inconsistent"]);
  const violationCount = findings.filter((f) => violationStatuses.has(f.status)).length;
  const manualCount = findings.filter((f) => f.manualReviewRequired).length;

  const clip = (n: number) => Math.max(0, Math.min(1, n));

  return {
    automatedTechnicalCoverage: clip(totalConsideredRules === 0 ? 0 : coverage.rulesEvaluated / totalConsideredRules),
    detectedTechnicalConformity: clip(1 - violationCount / Math.max(coverage.rulesEvaluated, 1)),
    unresolvedComplianceRisk: clip(violationCount / Math.max(coverage.rulesEvaluated, 1)),
    manualReviewWorkload: clip(findings.length === 0 ? 0 : manualCount / findings.length),
    scanCompleteness: clip(coverage.pagesScanned === 0 ? 0 : coverage.pagesScanned / Math.max(config.crawl.pageLimit, 1)),
  };
}

export class ScanEngine {
  private readonly packLoader = new PackLoader();

  /** Runs every applicable rule from every loaded pack against a built ScanContext. */
  private async evaluateRules(scanContext: ScanContext): Promise<{ findings: Finding[]; coverage: Omit<CoverageSummary, "pagesScanned" | "manualReviewItems"> }> {
    const packs = await this.packLoader.load(scanContext.config);
    const findings: Finding[] = [];
    let rulesEvaluated = 0;
    let rulesSkippedNotApplicable = 0;
    let rulesNotEvaluated = 0;

    for (const pack of packs) {
      for (const rule of pack.rules) {
        if (!rule.applicable(scanContext)) {
          rulesSkippedNotApplicable += 1;
          continue;
        }
        if (rule.requiresLivePages && scanContext.pages.length === 0) {
          findings.push(
            notEvaluatedFinding(
              rule,
              pack.id,
              pack.regulation,
              pack.jurisdiction,
              "This rule requires a rendered browser page; none was available in this scan (source-only mode with no running application server)."
            )
          );
          rulesNotEvaluated += 1;
          continue;
        }
        try {
          const result = await rule.run(scanContext);
          findings.push(...result);
          rulesEvaluated += 1;
        } catch (error) {
          logger.error(`Rule ${rule.id} threw during execution`, error);
          findings.push(
            notEvaluatedFinding(rule, pack.id, pack.regulation, pack.jurisdiction, `Rule execution failed: ${(error as Error).message}`)
          );
          rulesNotEvaluated += 1;
        }
      }
    }

    return {
      findings,
      coverage: {
        jurisdictionsSelected: scanContext.config.jurisdictions,
        packsLoaded: packs.map((p) => p.id),
        rulesEvaluated,
        rulesSkippedNotApplicable,
        rulesNotEvaluated,
      },
    };
  }

  private buildReport(
    config: UniVerscanConfig,
    mode: ScanReport["meta"]["mode"],
    target: ScanReport["meta"]["target"],
    findings: Finding[],
    thirdPartyServices: ThirdPartyServiceRecord[],
    coverage: CoverageSummary,
    packIds: Array<{ id: string; regulation: string; version: string }>
  ): ScanReport {
    return {
      meta: {
        tool: "UniVerscan",
        generatedAt: new Date().toISOString(),
        mode,
        target,
        jurisdictions: config.jurisdictions,
        packs: packIds,
      },
      findings,
      thirdPartyServices,
      coverage,
      riskIndicators: computeRiskIndicators(findings, coverage, config),
    };
  }

  /** Live website mode: input is a URL. */
  async runLive(config: UniVerscanConfig): Promise<ScanReport> {
    if (!config.target.url) throw new Error("config.target.url is required for live mode");
    const evidence = new EvidenceStore(config.reporting.outputDir);
    const browserManager = new BrowserManager();
    await browserManager.launch();

    const authContext = await browserManager.newAuthenticatedContext(config.authentication);
    const page = await authContext.newPage();
    const discovery = new SiteDiscovery();
    const routes = await discovery.discover(config.target.url, page, config);
    logger.info(`Discovered ${routes.length} route(s) to scan`);

    const accessibilityScanner = new AccessibilityScanner();
    const formsScanner = new FormsScanner();
    const privacyScanner = new PrivacyDocumentScanner();
    const cookieScanner = new CookieScanner(browserManager, config.consent);
    const networkIntel = new NetworkIntelligence();

    const pages: PageContext[] = [];
    let thirdPartyServices: ThirdPartyServiceRecord[] = [];

    for (const [index, route] of routes.entries()) {
      logger.info(`Scanning ${route.url}`);
      await page.goto(route.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error) => {
        logger.warn(`Failed to navigate to ${route.url}`, error);
      });

      const accessibilityViolations = await accessibilityScanner.run(page, config.accessibility.standard).catch((error) => {
        logger.warn(`Accessibility scan failed for ${route.url}`, error);
        return [];
      });
      const interactionChecks = config.accessibility.includeInteractionChecks
        ? await accessibilityScanner.runInteractionChecks(page).catch(() => [])
        : [];
      const forms = await formsScanner.scan(page).catch(() => []);
      const rawDocuments = await privacyScanner.findDocuments(page).catch(() => []);
      const privacyDocuments = await Promise.all(rawDocuments.map((doc) => privacyScanner.analyzeDocument(page, doc)));

      // The consent banner is normally a site-wide component set on first load,
      // so the full multi-state consent flow is only run once (against the
      // primary/base route) rather than once per discovered page.
      let consentFlow: PageContext["consentFlow"] = null;
      if (config.consent.enabled && index === 0) {
        consentFlow = await cookieScanner.runConsentFlow(route.url).catch((error) => {
          logger.warn(`Consent flow simulation failed for ${route.url}`, error);
          return null;
        });
        if (consentFlow) {
          thirdPartyServices = networkIntel.merge([thirdPartyServices, networkIntel.build(route.url, consentFlow.states)]);
        }
      }

      pages.push({
        page,
        browserContext: authContext,
        url: route.url,
        route,
        consentFlow,
        accessibilityViolations,
        interactionChecks,
        forms,
        privacyDocuments,
      });
    }

    const scanContext: ScanContext = {
      config,
      mode: "live",
      pages,
      thirdPartyServices,
      evidence,
      startedAt: new Date().toISOString(),
    };

    const { findings, coverage: partialCoverage } = await this.evaluateRules(scanContext);
    const coverage: CoverageSummary = {
      ...partialCoverage,
      pagesScanned: pages.length,
      manualReviewItems: findings.filter((f) => f.manualReviewRequired).length,
    };

    await authContext.close();
    await browserManager.close();

    const packIds = await this.packLoader.load(config).then((packs) =>
      packs.map((p) => ({ id: p.id, regulation: p.regulation, version: p.version }))
    );

    return this.buildReport(config, "live", { url: config.target.url }, findings, thirdPartyServices, coverage, packIds);
  }

  /**
   * Source-code / static-analysis mode: input is a repository. Attempts to
   * detect the framework and start the app locally (when config.source
   * allows installing/building); if that succeeds, runs the full live-mode
   * pipeline against the local URL and merges static findings on top. If it
   * cannot start the app, runs static analysis only and every browser-only
   * rule is reported as not-evaluated rather than silently skipped.
   */
  async runSource(config: UniVerscanConfig): Promise<ScanReport> {
    if (!config.target.repoPath) throw new Error("config.target.repoPath is required for source mode");
    const repoPath = config.target.repoPath;

    const framework = await detectFramework(repoPath);
    logger.info(`Detected framework: ${framework.name} (${framework.confidence} confidence)`);

    const staticFindings = await runStaticAnalysis(repoPath);
    logger.info(`Static analysis produced ${staticFindings.length} finding(s)`);

    let localUrl: string | null = null;
    let stopFn: (() => Promise<void>) | null = null;
    if (config.source?.allowInstall || config.source?.allowBuild) {
      const started = await startApplication(repoPath, framework, config.source).catch((error) => {
        logger.warn("Could not start the application locally", error);
        return null;
      });
      if (started) {
        localUrl = started.url;
        stopFn = started.stop;
      }
    } else {
      logger.info("source.allowInstall/allowBuild are false; skipping local app startup (static analysis only)");
    }

    let report: ScanReport;
    if (localUrl) {
      const liveConfig: UniVerscanConfig = { ...config, target: { ...config.target, url: localUrl } };
      report = await this.runLive(liveConfig);
      report.findings = [...staticFindings, ...report.findings];
      report.meta.mode = "combined";
      report.meta.target = { repoPath, url: localUrl };
    } else {
      const evidence = new EvidenceStore(config.reporting.outputDir);
      const scanContext: ScanContext = {
        config,
        mode: "source",
        pages: [],
        thirdPartyServices: [],
        evidence,
        source: { repoPath, framework: framework.name, localUrl: null, staticFindings },
        startedAt: new Date().toISOString(),
      };
      const { findings, coverage: partialCoverage } = await this.evaluateRules(scanContext);
      const coverage: CoverageSummary = {
        ...partialCoverage,
        pagesScanned: 0,
        manualReviewItems: [...staticFindings, ...findings].filter((f) => f.manualReviewRequired).length,
      };
      const packIds = await this.packLoader.load(config).then((packs) =>
        packs.map((p) => ({ id: p.id, regulation: p.regulation, version: p.version }))
      );
      report = this.buildReport(config, "source", { repoPath }, [...staticFindings, ...findings], [], coverage, packIds);
    }

    if (stopFn) await stopFn();
    return report;
  }

  async run(config: UniVerscanConfig): Promise<ScanReport> {
    if (config.target.url && config.target.repoPath) {
      // Both provided: prefer source mode, which will itself drive a live
      // scan against the locally started app when possible.
      return this.runSource(config);
    }
    if (config.target.repoPath) return this.runSource(config);
    if (config.target.url) return this.runLive(config);
    throw new Error("config.target.url or config.target.repoPath must be set");
  }
}
