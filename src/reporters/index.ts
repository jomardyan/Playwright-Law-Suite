import type { UniVerscanConfig } from "../config/schema.js";
import type { ScanReport } from "../engine/types.js";
import { writeJsonReport } from "./JsonReporter.js";
import { writeHtmlReport } from "./HtmlReporter.js";
import { writeJUnitReport } from "./JUnitReporter.js";
import { writeSarifReport } from "./SarifReporter.js";
import { writeMarkdownReport, renderMarkdownReport } from "./MarkdownReporter.js";
import { writeCsvReport, renderCsvReport } from "./CsvReporter.js";
import { printConsoleReport } from "./ConsoleReporter.js";
import { logger } from "../utils/logger.js";

export {
  writeJsonReport,
  writeHtmlReport,
  writeJUnitReport,
  writeSarifReport,
  writeMarkdownReport,
  renderMarkdownReport,
  writeCsvReport,
  renderCsvReport,
  printConsoleReport,
};

/** Writes every reporting format requested in config.reporting.formats. Returns the file paths written. */
export function writeReports(report: ScanReport, config: UniVerscanConfig): string[] {
  const written: string[] = [];
  for (const format of config.reporting.formats) {
    switch (format) {
      case "json":
        written.push(writeJsonReport(report, config.reporting.outputDir));
        break;
      case "html":
        written.push(writeHtmlReport(report, config.reporting.outputDir));
        break;
      case "junit":
        written.push(writeJUnitReport(report, config.reporting.outputDir, config.ci?.failOn ?? ["critical", "high"]));
        break;
      case "sarif":
        written.push(writeSarifReport(report, config.reporting.outputDir));
        break;
      case "markdown":
        written.push(writeMarkdownReport(report, config.reporting.outputDir));
        break;
      case "csv":
        written.push(writeCsvReport(report, config.reporting.outputDir));
        break;
      case "console":
        printConsoleReport(report);
        break;
      default:
        logger.warn(`Unknown reporting format '${format}'; skipping.`);
    }
  }
  return written;
}
