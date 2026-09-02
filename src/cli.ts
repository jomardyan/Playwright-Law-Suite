#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { ScanEngine } from "./engine/ScanEngine.js";
import { loadConfig, loadConfigFromObject } from "./config/loader.js";
import { PackLoader } from "./packs/PackLoader.js";
import { writeReports } from "./reporters/index.js";
import { logger } from "./utils/logger.js";
import type { UniVerscanConfig } from "./config/schema.js";
import type { Severity } from "./engine/types.js";

const program = new Command();

program.name("universcan").description("Universal Playwright Web Compliance Scanner").version("0.1.0");

function splitList(value?: string): string[] | undefined {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : undefined;
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
  .option("--format <list>", "Comma-separated report formats: json,html,console,junit")
  .option("--out <dir>", "Output directory for reports", "./universcan-report")
  .option("--allow-install", "Permit installing dependencies in source mode", false)
  .option("--allow-build", "Permit building/starting the application in source mode", false)
  .option("--fail-on <list>", "Comma-separated severities that cause a non-zero exit code")
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

    const engine = new ScanEngine();
    const report = await engine.run(config);
    const written = writeReports(report, config);
    if (written.length > 0) {
      logger.info(`Report(s) written: ${written.join(", ")}`);
    }

    const violationStatuses = new Set(["violation", "probable-violation", "risk", "missing-disclosure", "inconsistent"]);
    const failOnSeverities = config.ci?.failOn ?? ["critical", "high"];
    const hasBlockingFinding = report.findings.some(
      (f) => violationStatuses.has(f.status) && failOnSeverities.includes(f.severity)
    );
    if (hasBlockingFinding) {
      logger.error(`Scan found findings at or above the configured fail-on severities: ${failOnSeverities.join(", ")}`);
      process.exitCode = 1;
    }
  });

program
  .command("packs")
  .description("List built-in regulatory packs")
  .action(() => {
    const loader = new PackLoader();
    for (const pack of loader.listBuiltIn()) {
      console.log(`${pack.id}\t${pack.regulation}\t${pack.jurisdiction}\tv${pack.version}\t${pack.rules.length} rule(s)`);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  logger.error("UniVerscan CLI failed", error);
  process.exitCode = 1;
});
