import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanReport } from "../engine/types.js";

export function writeJsonReport(report: ScanReport, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, "report.json");
  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}
