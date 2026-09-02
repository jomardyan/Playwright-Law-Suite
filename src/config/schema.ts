import type { Severity } from "../engine/types.js";

export interface AuthenticationConfig {
  method: "none" | "password" | "storage-state" | "custom-script";
  usernameEnvVar?: string;
  passwordEnvVar?: string;
  storageStatePath?: string;
  customScriptPath?: string;
  loginUrl?: string;
}

export interface ConsentSimulationConfig {
  enabled: boolean;
  /** CSS/text selectors tried, in order, to find the reject-all control. */
  rejectSelectors?: string[];
  acceptSelectors?: string[];
  testWithdrawal?: boolean;
  /**
   * Whether to run an extra simulated visit that asserts Global Privacy
   * Control (`Sec-GPC: 1` + `navigator.globalPrivacyControl`). Defaults to
   * true. Turning it off makes every universal-opt-out rule report
   * `not-evaluated`, never a pass.
   */
  probeGlobalPrivacyControl?: boolean;
}

export interface SourceModeConfig {
  repoPath?: string;
  allowInstall?: boolean;
  allowBuild?: boolean;
  startCommandOverride?: string;
  portOverride?: number;
  startupTimeoutMs?: number;
}

export interface IgnoredFinding {
  ruleId: string;
  reason: string;
  approvedBy?: string;
  expires?: string;
}

/**
 * A UniVerscan configuration profile. Profiles can extend a base profile via
 * `extends` (resolved by the config loader) so an organization can maintain a
 * global baseline and layer country-specific requirements on top.
 */
export interface UniVerscanConfig {
  /** Path (relative to this file) or name of a profile this one inherits from. */
  extends?: string;

  target: {
    url?: string;
    repoPath?: string;
  };

  jurisdictions: string[];
  businessSector?: string;
  customerMarkets?: string[];
  companyLocation?: string;

  regulatoryPacks?: string[];

  accessibility: {
    standard: "wcag2a" | "wcag2aa" | "wcag21aa" | "wcag22aa" | "wcag22aaa";
    includeInteractionChecks: boolean;
  };

  authentication?: AuthenticationConfig;

  crawl: {
    depth: number;
    pageLimit: number;
    includedRoutes?: string[];
    excludedRoutes?: string[];
    respectRobotsTxt?: boolean;
  };

  consent: ConsentSimulationConfig;

  languages?: string[];
  viewportProfiles?: Array<{ name: string; width: number; height: number; mobile?: boolean }>;

  source?: SourceModeConfig;

  customRulesPaths?: string[];
  ignoredFindings?: IgnoredFinding[];

  reporting: {
    formats: Array<"json" | "html" | "console" | "junit" | "sarif" | "csv" | "markdown">;
    outputDir: string;
  };

  ci?: {
    failOn: Severity[];
    warnOn: Severity[];
  };
}

export const DEFAULT_CONFIG: UniVerscanConfig = {
  target: {},
  jurisdictions: [],
  regulatoryPacks: [],
  accessibility: {
    standard: "wcag22aa",
    includeInteractionChecks: true,
  },
  crawl: {
    depth: 2,
    pageLimit: 25,
    respectRobotsTxt: true,
  },
  consent: {
    enabled: true,
    testWithdrawal: true,
    probeGlobalPrivacyControl: true,
    acceptSelectors: [
      "text=/accept all/i",
      "text=/allow all/i",
      "text=/i agree/i",
      "#onetrust-accept-btn-handler",
      ".CybotCookiebotDialogBodyButton:has-text('Allow all')",
    ],
    rejectSelectors: [
      "text=/reject all/i",
      "text=/decline all/i",
      "text=/deny all/i",
      "text=/necessary only/i",
      "#onetrust-reject-all-handler",
    ],
  },
  source: {
    allowInstall: false,
    allowBuild: false,
    startupTimeoutMs: 60_000,
  },
  reporting: {
    formats: ["json", "console"],
    outputDir: "./universcan-report",
  },
  ci: {
    failOn: ["critical", "high"],
    warnOn: ["medium", "manual-review"],
  },
};
