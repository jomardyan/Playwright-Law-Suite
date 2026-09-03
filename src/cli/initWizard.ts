import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { UniVerscanConfig } from "../config/schema.js";
import { loadConfigFromObject } from "../config/loader.js";
import { PackLoader } from "../packs/PackLoader.js";
import { detectScope } from "../engine/AutoScan.js";
import { CANONICAL_JURISDICTIONS } from "../modules/scope/signals.js";
import type { ScopeDetection } from "../modules/scope/resolveScope.js";
import { PromptSession } from "./prompts.js";
import { Styler, rule, symbolsFor, wrap, type TerminalCapabilities } from "./terminal.js";
import { createProgressReporter } from "./progress.js";

/** The subset of a config the wizard writes. Everything else inherits from the profile. */
export interface WizardResult {
  configPath: string;
  config: Partial<UniVerscanConfig>;
}

const ALL_JURISDICTIONS = [
  CANONICAL_JURISDICTIONS.EU,
  CANONICAL_JURISDICTIONS.UK,
  CANONICAL_JURISDICTIONS.US_CA,
  CANONICAL_JURISDICTIONS.US,
  CANONICAL_JURISDICTIONS.AU,
  CANONICAL_JURISDICTIONS.BR,
  CANONICAL_JURISDICTIONS.CA,
  CANONICAL_JURISDICTIONS.CA_QC,
  CANONICAL_JURISDICTIONS.CH,
  CANONICAL_JURISDICTIONS.JP,
  CANONICAL_JURISDICTIONS.KR,
  CANONICAL_JURISDICTIONS.CN,
  CANONICAL_JURISDICTIONS.IN,
  CANONICAL_JURISDICTIONS.SG,
  CANONICAL_JURISDICTIONS.TH,
  CANONICAL_JURISDICTIONS.ZA,
  CANONICAL_JURISDICTIONS.SA,
  CANONICAL_JURISDICTIONS.NG,
] as const;

const SECTORS = [
  "e-commerce",
  "government",
  "banking",
  "insurance",
  "transport",
  "telecommunications",
  "media",
  "e-books",
  "health",
  "saas",
] as const;

const FORMAT_CHOICES = [
  { value: "json", label: "json", hint: "The machine-readable report. Required for diff and re-render." },
  { value: "html", label: "html", hint: "Executive dashboard to hand to a non-technical stakeholder." },
  { value: "console", label: "console", hint: "Summary printed to the terminal." },
  { value: "markdown", label: "markdown", hint: "CI job summary or pull-request comment." },
  { value: "sarif", label: "sarif", hint: "GitHub code scanning alerts." },
  { value: "junit", label: "junit", hint: "Test-report panel in most CI systems." },
  { value: "csv", label: "csv", hint: "Spreadsheet triage." },
] as const;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function validateUrl(value: string): string | null {
  if (value.trim().length === 0) return "A URL is required.";
  try {
    const parsed = new URL(normalizeUrl(value));
    if (!/^https?:$/.test(parsed.protocol)) return "Only http and https targets can be scanned.";
    return null;
  } catch {
    return "That is not a URL Node can parse.";
  }
}

/**
 * Renders the detected scope compactly for the wizard, so the user sees what
 * autoscan concluded and on what basis before being asked to accept it.
 */
function describeDetection(
  detection: ScopeDetection,
  capabilities: TerminalCapabilities,
  styler: Styler
): string[] {
  const symbols = symbolsFor(capabilities);
  const lines: string[] = [];
  if (detection.inconclusive) {
    lines.push(`  ${styler.yellow(symbols.warning)} No target market could be determined from this site.`);
    return lines;
  }
  for (const market of detection.selected) {
    lines.push(`  ${styler.green(symbols.check)} ${styler.bold(market.jurisdiction)} ${styler.dim(`(${market.confidence} confidence)`)}`);
    for (const signal of market.evidence.slice(0, 3)) {
      lines.push(styler.dim(`      ${symbols.bullet} ${signal.detail}`));
    }
    if (market.evidence.length > 3) {
      lines.push(styler.dim(`      ${symbols.bullet} and ${market.evidence.length - 3} more signal(s)`));
    }
  }
  for (const market of detection.considered) {
    lines.push(
      `  ${styler.yellow(symbols.warning)} ${market.jurisdiction} ${styler.dim("- evidence too thin to select automatically")}`
    );
  }
  return lines;
}

/**
 * The `init` wizard: asks what to scan, proposes a scope by probing the
 * site, lets the user correct it, and writes a config file.
 *
 * The proposal is always presented as a proposal. The user confirms or edits
 * the market list before anything is written, because a scope is a decision
 * about legal exposure and this tool must not make it on someone's behalf.
 */
export async function runInitWizard(options: {
  capabilities: TerminalCapabilities;
  targetPath: string;
  url?: string;
  assumeYes?: boolean;
  skipDetection?: boolean;
}): Promise<WizardResult | null> {
  const { capabilities } = options;
  const styler = new Styler(capabilities);
  const symbols = symbolsFor(capabilities);
  const session = new PromptSession(capabilities, options.assumeYes);

  try {
    session.write("");
    session.write(rule(capabilities, styler, "UniVerscan setup"));
    for (const line of wrap(
      "This builds a universcan.config.json for a project. It can probe the site to propose which markets it serves; you confirm or correct that before anything is written.",
      capabilities.width
    )) {
      session.write(styler.dim(line));
    }
    session.write("");

    const url = normalizeUrl(
      options.url ?? (await session.text("What URL should be scanned?", { validate: validateUrl }))
    );

    // --- Scope: propose, then confirm ---
    let jurisdictions: string[] = [];
    let sector: string | undefined;
    let detection: ScopeDetection | null = null;

    const shouldDetect =
      !options.skipDetection &&
      (await session.confirm("Probe the site now to propose the target markets?", true));

    if (shouldDetect) {
      const progress = createProgressReporter(capabilities);
      progress.start("Probing site for market signals");
      try {
        const outcome = await detectScope(loadConfigFromObject({ target: { url } }));
        detection = outcome.detection;
        jurisdictions = [...outcome.detection.jurisdictions];
        sector = outcome.config.businessSector;
        progress.finish(
          detection.inconclusive ? "no market determined" : `${detection.selected.length} market(s) proposed`
        );
      } catch (error) {
        progress.stop();
        session.write(`  ${styler.red(symbols.cross)} Could not probe the site: ${(error as Error).message}`);
        session.write(styler.dim("  Falling back to choosing the markets by hand."));
      }
    }

    if (detection) {
      session.write("");
      session.write(styler.bold("Proposed scope"));
      for (const line of describeDetection(detection, capabilities, styler)) session.write(line);
      session.write("");
      for (const line of wrap(
        "This was inferred from the site, not from any record of where the business operates. A market that was not detected was not scanned, and an unscanned market is an unknown rather than a clean one.",
        capabilities.width,
        "  "
      )) {
        session.write(styler.dim(line));
      }
      session.write("");
    }

    const acceptProposal =
      jurisdictions.length > 0 && (await session.confirm(`Use these ${jurisdictions.length} market(s)?`, true));

    if (!acceptProposal) {
      const preselected = ALL_JURISDICTIONS.map((jurisdiction, index) =>
        jurisdictions.includes(jurisdiction) ? index : -1
      ).filter((index) => index >= 0);

      jurisdictions = await session.multiSelect(
        "Which markets does this service target?",
        ALL_JURISDICTIONS.map((jurisdiction) => ({ value: jurisdiction as string, label: jurisdiction })),
        preselected
      );
    }

    if (jurisdictions.length === 0) {
      session.write("");
      session.write(
        `  ${styler.yellow(symbols.warning)} No market selected. Only jurisdiction-agnostic rules (accessibility) will run.`
      );
    }

    // --- Sector ---
    const sectorChoices = [
      { value: "", label: "(not sure / not listed)", hint: "Sector-gated packs apply their default behavior." },
      ...SECTORS.map((value) => ({ value: value as string, label: value })),
    ];
    const defaultSectorIndex = sector ? Math.max(0, sectorChoices.findIndex((c) => c.value === sector)) : 0;
    const chosenSector = await session.select(
      sector
        ? `Business sector? ${styler.dim(`(detected: ${sector})`)}`
        : "Business sector? It decides whether the Accessibility Act and Consumer Rights packs apply.",
      sectorChoices,
      defaultSectorIndex
    );

    // --- Output formats ---
    const formats = await session.multiSelect(
      "Which report formats?",
      FORMAT_CHOICES.map((choice) => ({ value: choice.value as string, label: choice.label, hint: choice.hint })),
      [0, 1, 2]
    );

    // --- Crawl bounds ---
    const pageLimit = Number.parseInt(
      await session.text("How many pages at most?", {
        defaultValue: "25",
        validate: (value) => (/^\d+$/.test(value) && Number.parseInt(value, 10) > 0 ? null : "Enter a positive whole number."),
      }),
      10
    );

    const config: Partial<UniVerscanConfig> = {
      extends: "global-baseline",
      target: { url },
      jurisdictions,
      customerMarkets: jurisdictions,
      ...(chosenSector ? { businessSector: chosenSector } : {}),
      crawl: { depth: 3, pageLimit, respectRobotsTxt: true },
      reporting: {
        formats: (formats.length > 0 ? formats : ["json", "console"]) as UniVerscanConfig["reporting"]["formats"],
        outputDir: "./universcan-report",
      },
    };

    // --- Show which packs this scope actually loads, before writing ---
    const packs = await new PackLoader().load(loadConfigFromObject(config));
    session.write("");
    session.write(styler.bold(`Packs this configuration loads (${packs.length})`));
    for (const pack of packs) {
      session.write(
        `  ${styler.green(symbols.check)} ${pack.id} ${styler.dim(`- ${pack.regulation} (${pack.rules.length} rule(s), effective ${pack.effectiveDate})`)}`
      );
    }
    if (packs.length === 0) {
      session.write(`  ${styler.yellow(symbols.warning)} None. This configuration would scan nothing.`);
    }
    session.write("");

    // --- Write ---
    const configPath = resolve(options.targetPath);
    if (existsSync(configPath)) {
      const overwrite = await session.confirm(`${configPath} already exists. Overwrite it?`, false);
      if (!overwrite) {
        session.write(styler.dim("Nothing written."));
        return null;
      }
    }

    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    session.write(`${styler.green(symbols.check)} Wrote ${styler.bold(configPath)}`);
    session.write("");
    session.write(styler.dim(`Run the scan with:  universcan scan --config ${options.targetPath}`));
    session.write("");

    return { configPath, config };
  } finally {
    session.close();
  }
}
