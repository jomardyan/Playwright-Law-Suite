#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScanEngine } from "./engine/ScanEngine.js";
import { loadConfig, loadConfigFromObject } from "./config/loader.js";
import { PackLoader } from "./packs/PackLoader.js";
import { writeReports, renderMarkdownReport } from "./reporters/index.js";
import { diffReports, renderDiffMarkdown } from "./engine/ReportDiff.js";
import { detectScope } from "./engine/AutoScan.js";
import { currentCapabilities, renderTable, Styler, rule, symbolsFor } from "./cli/terminal.js";
import { createProgressReporter } from "./cli/progress.js";
import { runInitWizard } from "./cli/initWizard.js";
import { exploreReport } from "./cli/explore.js";
import { NonInteractiveError } from "./cli/prompts.js";
import { explainError, validateScope, type ScopeProblem } from "./cli/diagnostics.js";
import { overallStatus, runDoctor } from "./cli/doctor.js";
import type { ScopeDetection } from "./modules/scope/resolveScope.js";
import { logger } from "./utils/logger.js";
import type { UniVerscanConfig } from "./config/schema.js";
import type { ScanReport, Severity } from "./engine/types.js";

const program = new Command();

program
  .name("universcan")
  .description("Universal Playwright Web Compliance Scanner")
  .version("0.4.0")
  .option("--no-color", "Disable coloured output (NO_COLOR is also honoured)")
  .option("--quiet", "Suppress live progress output", false);

/**
 * Terminal capabilities for this invocation, with the global flags applied.
 * Resolved once so every command renders consistently.
 */
function capabilitiesFor(): ReturnType<typeof currentCapabilities> {
  const globals = program.opts<{ color?: boolean }>();
  const base = currentCapabilities();
  // commander maps --no-color to color:false.
  return globals.color === false ? { ...base, color: false } : base;
}

function isQuiet(): boolean {
  return program.opts<{ quiet?: boolean }>().quiet === true;
}

program.addHelpText(
  "after",
  `
Getting started:
  universcan doctor                        check this environment can run a scan
  universcan init                          set a project up interactively
  universcan autoscan --url https://x.com  detect the target's markets, then scan
  universcan packs                         list the regulatory packs and their dates

Typical use:
  universcan scan --url https://shop.example --jurisdictions "European Union" --sector e-commerce
  universcan scan --config universcan.config.json --format json,html,markdown
  universcan explore --input ./universcan-report/report.json
  universcan diff --baseline ./before/report.json --current ./after/report.json

In CI:
  universcan scan --config universcan.config.json --format json,sarif,markdown \\
    --baseline ./baseline/report.json --fail-on-new --fail-on critical,high

Exit codes:
  0  no findings at the fail-on severities
  1  findings at or above --fail-on
  2  the scan could not run (bad input, no packs selected, nothing reachable)

UniVerscan reports evidence and manual-review items. It does not certify legal compliance.
`
);

function splitList(value?: string): string[] | undefined {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : undefined;
}

/** Reads a report.json written by a previous scan, or logs why it could not. */
function readReport(path: string): ScanReport | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ScanReport;
    if (!Array.isArray(parsed.findings)) {
      logger.error(`${path} does not look like a UniVerscan report (no 'findings' array).`);
      return null;
    }
    // Reports written before suppression support have no such array; default
    // it so a diff against an older baseline still works.
    parsed.suppressedFindings = parsed.suppressedFindings ?? [];
    return parsed;
  } catch (error) {
    logger.error(`Could not read report at ${path}`, error);
    return null;
  }
}

/**
 * Checks the resolved scope before a browser is launched and prints anything
 * wrong with it. Returns false when the scan must not proceed.
 *
 * Catching this here matters more than it looks: a mistyped pack id loads no
 * rules at all, and without this the scan would run, find nothing, and exit
 * zero - a clean bill of health for a check that never happened.
 */
async function preflight(config: UniVerscanConfig): Promise<boolean> {
  const loader = new PackLoader();
  const allPacks = loader.listBuiltIn();
  const applicable = await loader.load(config);
  const problems = validateScope(config, allPacks, applicable);
  if (problems.length === 0) return true;

  const capabilities = capabilitiesFor();
  const styler = new Styler(capabilities);
  const symbols = symbolsFor(capabilities);
  for (const problem of problems) {
    const marker = problem.severity === "error" ? styler.red(symbols.cross) : styler.yellow(symbols.warning);
    process.stderr.write(`${marker} ${problem.message}\n`);
    if (problem.hint) process.stderr.write(`  ${styler.dim(problem.hint)}\n`);
  }
  return !problems.some((problem: ScopeProblem) => problem.severity === "error");
}

/** Prints what a reader can usefully do next with the report just written. */
function printNextSteps(report: ScanReport, config: UniVerscanConfig, written: string[]): void {
  const capabilities = capabilitiesFor();
  const styler = new Styler(capabilities);
  const symbols = symbolsFor(capabilities);
  if (written.length === 0) return;

  const lines: string[] = [];
  const json = written.find((path) => path.endsWith(".json"));
  const html = written.find((path) => path.endsWith(".html"));
  if (json && report.findings.length > 0) {
    lines.push(`browse the findings   ${styler.bold(`universcan explore --input ${json}`)}`);
  }
  if (html) lines.push(`open the dashboard    ${styler.bold(html)}`);
  if (json) {
    lines.push(`compare a later scan  ${styler.bold(`universcan scan --config ... --baseline ${json} --fail-on-new`)}`);
  }
  if (report.coverage.manualReviewItems > 0) {
    lines.push(
      `${styler.magenta(String(report.coverage.manualReviewItems))} item(s) need a person to decide; the scan only collected the evidence.`
    );
  }
  if (lines.length === 0) return;

  process.stderr.write(`\n${styler.dim("Next:")}\n`);
  for (const line of lines) process.stderr.write(`  ${styler.dim(symbols.arrow)} ${line}\n`);
  process.stderr.write("\n");
}

/**
 * Baseline comparison, warn/fail counting, and exit code. Shared by `scan`
 * and `autoscan` so the two gate on identical rules.
 */
function finishScan(
  report: ScanReport,
  config: UniVerscanConfig,
  options: { baseline?: string; failOnNew?: boolean }
): void {
  const violationStatuses = new Set(["violation", "probable-violation", "risk", "missing-disclosure", "inconsistent"]);
  const failOnSeverities = config.ci?.failOn ?? ["critical", "high"];
  const warnOnSeverities = config.ci?.warnOn ?? [];

  // With --baseline, the gate can be narrowed to findings this change
  // introduced. Pre-existing findings still appear in every report; they are
  // just not treated as this run's regression.
  let gatedFindings = report.findings;
  if (options.baseline) {
    const baseline = readReport(resolve(options.baseline));
    if (!baseline) {
      process.exitCode = 2;
      return;
    }
    const diff = diffReports(baseline, report);
    console.log(renderDiffMarkdown(diff));
    if (options.failOnNew) {
      gatedFindings = diff.newFindings.map((entry) => entry.finding);
      logger.info(`--fail-on-new: gating on ${gatedFindings.length} new finding(s) only.`);
    }
  } else if (options.failOnNew) {
    logger.warn("--fail-on-new has no effect without --baseline; gating on all findings.");
  }

  const blockingCount = gatedFindings.filter(
    (f) => violationStatuses.has(f.status) && failOnSeverities.includes(f.severity)
  ).length;
  const warningCount = gatedFindings.filter(
    (f) => violationStatuses.has(f.status) && warnOnSeverities.includes(f.severity)
  ).length;

  if (report.coverage.rulesNotEvaluated > 0) {
    logger.warn(
      `${report.coverage.rulesNotEvaluated} rule(s) could not be evaluated in this scan. They are reported as 'not-evaluated', not as passes.`
    );
  }

  // A scan that reached nothing established nothing. Exiting zero would let
  // an unreachable staging host read as a clean build, which is the most
  // expensive way this tool could mislead someone.
  if (report.coverage.pagesScanned === 0 && (report.coverage.pagesUnreachable ?? 0) > 0) {
    logger.error(
      `No page could be loaded (${report.coverage.pagesUnreachable} unreachable). This scan established nothing; it is not a pass.`
    );
    process.exitCode = 2;
    return;
  }
  if (warningCount > 0) {
    logger.warn(`Scan found ${warningCount} finding(s) at the configured warn-on severities: ${warnOnSeverities.join(", ")}`);
  }
  if (blockingCount > 0) {
    logger.error(`Scan found ${blockingCount} finding(s) at or above the configured fail-on severities: ${failOnSeverities.join(", ")}`);
    process.exitCode = 1;
  }
}

/** Renders the inferred scope, its evidence, and its caveats for the terminal. */
function renderScopeDetection(detection: ScopeDetection, config: UniVerscanConfig): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Autoscan - detected scope");
  lines.push("=========================");

  if (detection.inconclusive) {
    lines.push("No target market could be determined from this site.");
  } else {
    lines.push("Markets selected for scanning:");
    for (const market of detection.selected) {
      lines.push(`  ${market.jurisdiction}  [${market.confidence} confidence, score ${market.score}]`);
      for (const signal of market.evidence) {
        lines.push(`      - ${signal.detail}  (${signal.kind}, ${signal.observedAt})`);
      }
    }
  }

  if (detection.considered.length > 0) {
    lines.push("");
    lines.push("Considered, but evidence too thin to scan against:");
    for (const market of detection.considered) {
      lines.push(`  ${market.jurisdiction}  [score ${market.score}]`);
      for (const signal of market.evidence) {
        lines.push(`      - ${signal.detail}  (${signal.kind})`);
      }
    }
  }

  lines.push("");
  lines.push(`Sector: ${config.businessSector ?? "(not determined)"}`);
  if (detection.sectorEvidence.length > 0) {
    for (const evidence of detection.sectorEvidence) lines.push(`      - ${evidence}`);
  }

  lines.push("");
  lines.push(`Jurisdictions applied: ${config.jurisdictions.join(", ") || "(none)"}`);
  lines.push("");
  for (const note of detection.notes) lines.push(`Note: ${note}`);
  lines.push("");
  return lines.join("\n");
}

program
  .command("scan")
  .description("Scan a live website and/or a source repository for compliance findings")
  .option("--url <url>", "URL of the live website to scan")
  .option("--repo <path>", "Path to the application source repository")
  .option("--config <path>", "Path to a UniVerscan config file (JSON or YAML)")
  .option("--jurisdictions <list>", "Comma-separated jurisdictions, e.g. 'European Union,United Kingdom'")
  .option("--packs <list>", "Comma-separated regulatory pack ids to restrict the scan to")
  .option("--sector <sector>", "Business sector, e.g. 'e-commerce'")
  .option("--accessibility-standard <standard>", "wcag2a | wcag2aa | wcag21aa | wcag22aa | wcag22aaa")
  .option("--format <list>", "Comma-separated report formats: json,html,console,junit,sarif,markdown,csv")
  .option("--out <dir>", "Output directory for reports (default: ./universcan-report, or reporting.outputDir from --config)")
  .option("--allow-install", "Permit installing dependencies in source mode", false)
  .option("--allow-build", "Permit building/starting the application in source mode", false)
  .option("--fail-on <list>", "Comma-separated severities that cause a non-zero exit code")
  .option("--baseline <path>", "Path to a previous report.json; prints what changed since that scan")
  .option("--fail-on-new", "Only fail on findings that are new relative to --baseline", false)
  .addHelpText(
    "after",
    `
Examples:
  $ universcan scan --url https://shop.example --jurisdictions "European Union"
  $ universcan scan --repo ../my-app --allow-install --allow-build
  $ universcan scan --config universcan.config.json --format json,html,sarif
  $ universcan scan --config c.json --baseline ./prev/report.json --fail-on-new
`
  )
  .action(async (options) => {
    let config: UniVerscanConfig;
    if (options.config) {
      config = loadConfig(resolve(options.config));
    } else {
      config = loadConfigFromObject({});
    }

    if (options.url) config.target.url = options.url;
    if (options.repo) config.target.repoPath = resolve(options.repo);
    const jurisdictions = splitList(options.jurisdictions);
    if (jurisdictions) config.jurisdictions = jurisdictions;
    const packs = splitList(options.packs);
    if (packs) config.regulatoryPacks = packs;
    if (options.sector) config.businessSector = options.sector;
    if (options.accessibilityStandard) config.accessibility.standard = options.accessibilityStandard;
    const formats = splitList(options.format);
    if (formats) config.reporting.formats = formats as UniVerscanConfig["reporting"]["formats"];
    if (options.out) config.reporting.outputDir = resolve(options.out);
    if (options.allowInstall) config.source = { ...config.source, allowInstall: true };
    if (options.allowBuild) config.source = { ...config.source, allowBuild: true };
    const failOn = splitList(options.failOn) as Severity[] | undefined;
    if (failOn) config.ci = { ...config.ci, failOn, warnOn: config.ci?.warnOn ?? [] };

    if (!config.target.url && !config.target.repoPath) {
      logger.error("Provide --url and/or --repo (or set target in --config).");
      process.exitCode = 2;
      return;
    }

    if (!(await preflight(config))) {
      process.exitCode = 2;
      return;
    }

    const progress = createProgressReporter(capabilitiesFor(), { quiet: isQuiet() });
    const engine = new ScanEngine(progress);
    let report: ScanReport;
    try {
      report = await engine.run(config);
    } finally {
      // Always clear the spinner line, including on a thrown scan.
      progress.stop();
    }
    const written = writeReports(report, config);
    if (written.length > 0) {
      logger.info(`Report(s) written: ${written.join(", ")}`);
    }

    finishScan(report, config, options);
    printNextSteps(report, config, written);
  });

program
  .command("autoscan")
  .description(
    "Detect which markets a site serves, then scan against them. Inferred scope is reported with its evidence, never applied silently."
  )
  .option("--url <url>", "URL of the live website to scan")
  .option("--config <path>", "Path to a UniVerscan config file (JSON or YAML)")
  .option("--jurisdictions <list>", "Override detection with an explicit list; detection still runs and is reported")
  .option("--sector <sector>", "Override the detected business sector")
  .option("--packs <list>", "Comma-separated regulatory pack ids to restrict the scan to")
  .option("--accessibility-standard <standard>", "wcag2a | wcag2aa | wcag21aa | wcag22aa | wcag22aaa")
  .option("--format <list>", "Comma-separated report formats: json,html,console,junit,sarif,markdown,csv")
  .option("--out <dir>", "Output directory for reports (default: ./universcan-report, or reporting.outputDir from --config)")
  .option("--detect-only", "Print the detected scope and exit without scanning", false)
  .option("--fail-on <list>", "Comma-separated severities that cause a non-zero exit code")
  .option("--baseline <path>", "Path to a previous report.json; prints what changed since that scan")
  .option("--fail-on-new", "Only fail on findings that are new relative to --baseline", false)
  .addHelpText(
    "after",
    `
Examples:
  $ universcan autoscan --url https://shop.example
  $ universcan autoscan --url https://shop.example --detect-only
  $ universcan autoscan --url https://shop.example --sector banking
`
  )
  .action(async (options) => {
    const config = options.config ? loadConfig(resolve(options.config)) : loadConfigFromObject({});
    if (options.url) config.target.url = options.url;
    const jurisdictions = splitList(options.jurisdictions);
    if (jurisdictions) config.jurisdictions = jurisdictions;
    const packs = splitList(options.packs);
    if (packs) config.regulatoryPacks = packs;
    if (options.sector) config.businessSector = options.sector;
    if (options.accessibilityStandard) config.accessibility.standard = options.accessibilityStandard;
    const formats = splitList(options.format);
    if (formats) config.reporting.formats = formats as UniVerscanConfig["reporting"]["formats"];
    if (options.out) config.reporting.outputDir = resolve(options.out);
    const failOn = splitList(options.failOn) as Severity[] | undefined;
    if (failOn) config.ci = { ...config.ci, failOn, warnOn: config.ci?.warnOn ?? [] };

    if (!config.target.url) {
      logger.error("autoscan needs --url: a repository exposes no market signals to probe.");
      process.exitCode = 2;
      return;
    }

    // Detection is run here rather than via ScanEngine.runAuto() so the
    // inferred scope is printed before the scan starts, not buried under the
    // console report. The report is annotated identically either way.
    const { detection, config: resolved } = await detectScope(config);
    console.log(renderScopeDetection(detection, resolved));
    if (options.detectOnly) return;

    if (!(await preflight(resolved))) {
      process.exitCode = 2;
      return;
    }

    const progress = createProgressReporter(capabilitiesFor(), { quiet: isQuiet() });
    let report: ScanReport;
    try {
      report = await new ScanEngine(progress).run(resolved);
    } finally {
      progress.stop();
    }
    report.meta.scopeDetection = detection;
    const written = writeReports(report, resolved);
    if (written.length > 0) logger.info(`Report(s) written: ${written.join(", ")}`);
    finishScan(report, resolved, options);
    printNextSteps(report, resolved, written);
  });

program
  .command("diff")
  .description("Compare two report.json files to verify a remediation round: what is new, fixed, changed, or no longer evaluated")
  .requiredOption("--baseline <path>", "Path to the earlier report.json")
  .requiredOption("--current <path>", "Path to the later report.json")
  .option("--fail-on-new", "Exit non-zero when the current report contains findings the baseline did not", false)
  .action((options) => {
    const baseline = readReport(resolve(options.baseline));
    const current = readReport(resolve(options.current));
    if (!baseline || !current) {
      process.exitCode = 2;
      return;
    }
    const diff = diffReports(baseline, current);
    console.log(renderDiffMarkdown(diff));
    if (options.failOnNew && diff.newFindings.length > 0) {
      logger.error(`${diff.newFindings.length} new finding(s) relative to the baseline.`);
      process.exitCode = 1;
    }
  });

program
  .command("report")
  .description("Re-render an existing report.json in another format without re-scanning")
  .requiredOption("--input <path>", "Path to a report.json")
  .option("--format <format>", "markdown (default)", "markdown")
  .action((options) => {
    const report = readReport(resolve(options.input));
    if (!report) {
      process.exitCode = 2;
      return;
    }
    if (options.format !== "markdown") {
      logger.error(`Unsupported re-render format '${options.format}'. Supported: markdown.`);
      process.exitCode = 2;
      return;
    }
    console.log(renderMarkdownReport(report));
  });

program
  .command("doctor")
  .description("Check that this environment can run a scan: Node, browser, sandbox, proxy, TLS, permissions, packs")
  .option("--config <path>", "Check against a specific configuration")
  .option("--skip-browser", "Skip the browser launch probe (faster, but proves less)", false)
  .action(async (options) => {
    const config = options.config ? loadConfig(resolve(options.config)) : loadConfigFromObject({});
    const capabilities = capabilitiesFor();
    const styler = new Styler(capabilities);
    const symbols = symbolsFor(capabilities);

    console.log("");
    console.log(rule(capabilities, styler, "UniVerscan environment check"));
    console.log("");

    const results = await runDoctor(config, { skipBrowser: options.skipBrowser });
    for (const result of results) {
      const marker =
        result.status === "ok"
          ? styler.green(symbols.check)
          : result.status === "warn"
            ? styler.yellow(symbols.warning)
            : styler.red(symbols.cross);
      console.log(`  ${marker} ${styler.bold(result.name.padEnd(20))} ${result.detail}`);
      if (result.hint) console.log(`    ${styler.dim(result.hint)}`);
    }

    const status = overallStatus(results);
    console.log("");
    if (status === "fail") {
      console.log(`  ${styler.red(symbols.cross)} This environment cannot run a scan yet. Fix the items above.`);
      process.exitCode = 2;
    } else if (status === "warn") {
      console.log(`  ${styler.yellow(symbols.warning)} A scan will run, but read the warnings above first.`);
    } else {
      console.log(`  ${styler.green(symbols.check)} Ready to scan.`);
    }
    console.log("");
  });

program
  .command("init")
  .description("Interactive setup: proposes a scope by probing the site, then writes a config file")
  .option("--url <url>", "Skip the first question and use this URL")
  .option("--out <path>", "Where to write the config", "./universcan.config.json")
  .option("--no-detect", "Do not probe the site; choose the markets by hand")
  .option("--yes", "Accept every default without asking (for scripted setup)", false)
  .action(async (options) => {
    try {
      const result = await runInitWizard({
        capabilities: capabilitiesFor(),
        targetPath: options.out,
        url: options.url,
        assumeYes: options.yes,
        skipDetection: options.detect === false,
      });
      if (!result) process.exitCode = 1;
    } catch (error) {
      if (error instanceof NonInteractiveError) {
        logger.error(error.message);
        process.exitCode = 2;
        return;
      }
      throw error;
    }
  });

program
  .command("explore")
  .description("Browse a report interactively: page, filter by status/severity/pack, search, and open a finding")
  .requiredOption("--input <path>", "Path to a report.json")
  .action(async (options) => {
    const capabilities = capabilitiesFor();
    if (!capabilities.interactive) {
      logger.error(
        "explore needs an interactive terminal. Use 'universcan report --input <path> --format markdown' for a non-interactive view."
      );
      process.exitCode = 2;
      return;
    }
    const report = readReport(resolve(options.input));
    if (!report) {
      process.exitCode = 2;
      return;
    }
    if (report.findings.length === 0) {
      const styler = new Styler(capabilities);
      console.log(`${styler.green(symbolsFor(capabilities).check)} This report contains no findings to browse.`);
      return;
    }
    await exploreReport(report, capabilities);
  });

program
  .command("packs")
  .description("List built-in regulatory packs")
  .option("--plain", "Tab-separated output for scripting", false)
  .action((options) => {
    const loader = new PackLoader();
    const packs = loader.listBuiltIn();

    if (options.plain) {
      for (const pack of packs) {
        console.log(
          `${pack.id}\t${pack.regulation}\t${pack.jurisdiction}\tv${pack.version}\t${pack.effectiveDate}\t${pack.rules.length}`
        );
      }
      return;
    }

    const capabilities = capabilitiesFor();
    const styler = new Styler(capabilities);
    const rows = packs.map((pack) => [
      pack.id,
      pack.regulation,
      pack.jurisdiction,
      pack.effectiveDate,
      String(pack.rules.length),
    ]);
    console.log("");
    console.log(rule(capabilities, styler, `${packs.length} built-in regulatory packs`));
    console.log("");
    for (const line of renderTable(
      [
        { header: "PACK", maxShare: 0.2 },
        { header: "REGULATION", maxShare: 0.42 },
        { header: "JURISDICTION", maxShare: 0.2 },
        { header: "EFFECTIVE" },
        { header: "RULES", align: "right" },
      ],
      rows,
      capabilities,
      styler
    )) {
      console.log(`  ${line}`);
    }
    console.log("");
    console.log(
      styler.dim(
        `  ${packs.reduce((sum, pack) => sum + pack.rules.length, 0)} rules total. A pack loads only when its jurisdiction is in scope.`
      )
    );
    console.log("");
  });

program.parseAsync(process.argv).catch((error) => {
  const capabilities = capabilitiesFor();
  const styler = new Styler(capabilities);
  const symbols = symbolsFor(capabilities);

  const explained = explainError(error);
  if (explained) {
    process.stderr.write(`${styler.red(symbols.cross)} ${explained.message}\n`);
    if (explained.hint) process.stderr.write(`  ${styler.dim(explained.hint)}\n`);
    // The stack is still available, just not in the reader's face.
    logger.debug("Underlying error", error);
  } else {
    process.stderr.write(`${styler.red(symbols.cross)} ${(error as Error).message ?? String(error)}\n`);
    process.stderr.write(
      `  ${styler.dim("Re-run with UNIVERSCAN_DEBUG=1 for the full stack trace, or open an issue with it.")}\n`
    );
    logger.debug("Underlying error", error);
  }
  process.exitCode = 1;
});
