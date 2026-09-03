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
  /**
   * Selectors tried, in order, to reopen the consent choice after it was
   * given - the "as easy to withdraw as to give" route. Defaults to
   * `DEFAULT_WITHDRAWAL_SELECTORS` in the cookie scanner.
   */
  withdrawalSelectors?: string[];
  testWithdrawal?: boolean;
  /**
   * Milliseconds to let a page settle before a consent state is captured.
   * A banner injected by a tag manager needs longer than the default on a
   * slow site; too short a wait reports controls that exist as missing.
   */
  settleMs?: number;
  /**
   * Whether to run an extra simulated visit that asserts Global Privacy
   * Control (`Sec-GPC: 1` + `navigator.globalPrivacyControl`). Defaults to
   * true. Turning it off makes every universal-opt-out rule report
   * `not-evaluated`, never a pass.
   */
  probeGlobalPrivacyControl?: boolean;
}

/**
 * How the browser is launched. Every field exists because some environment
 * cannot run the default: containers need sandbox flags, corporate networks
 * need a proxy, locked-down hosts need a system browser rather than a
 * downloaded one.
 */
export interface BrowserConfig {
  /** Playwright engine. Chromium is the only one axe-core is validated against. */
  engine?: "chromium" | "firefox" | "webkit";
  /** Branded channel, e.g. "chrome" or "msedge", to use a system install. */
  channel?: string;
  /** Absolute path to a browser binary, for hosts that cannot download one. */
  executablePath?: string;
  headless?: boolean;
  /**
   * Extra launch arguments. The usual reason is `--no-sandbox`, which
   * Chromium requires when running as root in a container.
   */
  args?: string[];
  /** Milliseconds to wait for the browser to start. */
  launchTimeoutMs?: number;
  /** Milliseconds to wait for each page navigation. */
  navigationTimeoutMs?: number;
  proxy?: {
    /** e.g. "http://proxy.corp:8080" or "socks5://proxy:1080". */
    server: string;
    /** Comma-separated hosts that bypass the proxy. */
    bypass?: string;
    usernameEnvVar?: string;
    passwordEnvVar?: string;
  };
  /**
   * Accept TLS certificates that fail verification. Off by default and
   * deliberately awkward to reach: a scanner that ignores certificate errors
   * cannot report on transport security honestly, so enabling it downgrades
   * the transport rules to `not-evaluated` rather than passing them.
   */
  ignoreHTTPSErrors?: boolean;
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

  browser?: BrowserConfig;

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
      // CMP-specific handles first: they are unambiguous, and cheaper than a
      // text scan of the whole document.
      "#onetrust-accept-btn-handler",
      "#accept-recommended-btn-handler",
      "#CybotCookiebotDialogBodyButtonAccept",
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
      "#CybotCookiebotDialogBodyLevelButtonAccept",
      "[data-testid='uc-accept-all-button']",
      "#didomi-notice-agree-button",
      ".qc-cmp2-summary-buttons button[mode='primary']",
      ".cky-btn-accept",
      ".osano-cm-accept-all",
      ".cmplz-accept",
      ".cc-allow",
      ".iubenda-cs-accept-btn",
      "#truste-consent-button",
      ".cm-btn-success",
      ".cm-btn-accept-all",
      "#axeptio_btn_acceptAll",
      "button[aria-label='Accept all' i]",
      "button[title='Accept all' i]",
      // Text matching, restricted to controls, in the languages of the
      // markets this scanner ships packs for. An English-only heuristic
      // reported every localised banner as having no accept control, which
      // in turn silenced the reject-control rule that keys off it.
      "button:text-matches('accept all|allow all|accept cookies|i accept|i agree|agree and continue|got it|ok, got it', 'i')",
      "a:text-matches('accept all|allow all|i accept|i agree', 'i')",
      "button:text-matches('alle akzeptieren|alle zulassen|akzeptieren|einverstanden|zustimmen', 'i')",
      "button:text-matches('tout accepter|accepter tout|j.accepte|accepter et continuer', 'i')",
      "button:text-matches('aceptar todo|aceptar todas|acepto|aceitar tudo|aceito', 'i')",
      "button:text-matches('accetta tutt|accetto|acconsento', 'i')",
      "button:text-matches('alles accepteren|accepteer alle|akkoord', 'i')",
      "button:text-matches('zaakceptuj wszystk|akceptuj|zgadzam się', 'i')",
      "button:text-matches('godkänn alla|acceptera alla|godkend alle|godta alle|hyväksy kaikki', 'i')",
      "button:text-matches('すべて同意|同意する|全部接受|接受所有|모두 동의|동의합니다', 'i')",
    ],
    rejectSelectors: [
      "#onetrust-reject-all-handler",
      ".ot-pc-refuse-all-handler",
      "#CybotCookiebotDialogBodyButtonDecline",
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
      "[data-testid='uc-deny-all-button']",
      "#didomi-notice-disagree-button",
      ".qc-cmp2-summary-buttons button[mode='secondary']",
      ".cky-btn-reject",
      ".osano-cm-deny-all",
      ".cmplz-deny",
      ".cc-deny",
      ".iubenda-cs-reject-btn",
      "#truste-consent-required",
      ".cm-btn-decline",
      "#axeptio_btn_dismiss",
      "button[aria-label='Reject all' i]",
      "button[title='Reject all' i]",
      "button:text-matches('reject all|decline all|deny all|refuse all|necessary only|only necessary|essential only|continue without accepting|do not accept', 'i')",
      "a:text-matches('reject all|decline all|continue without accepting', 'i')",
      "button:text-matches('alle ablehnen|ablehnen|nur notwendige|nur erforderliche|weiter ohne', 'i')",
      "button:text-matches('tout refuser|refuser tout|je refuse|continuer sans accepter|uniquement (les )?n.cessaires', 'i')",
      "button:text-matches('rechazar todo|rechazar todas|solo (las )?necesarias|recusar tudo|apenas necess', 'i')",
      "button:text-matches('rifiuta tutt|solo necessari|continua senza accettare', 'i')",
      "button:text-matches('alles weigeren|weiger alle|alleen noodzakelijke', 'i')",
      "button:text-matches('odrzuć wszystk|odrzuć|tylko niezbędne', 'i')",
      "button:text-matches('neka alla|avvisa alla|afvis alle|avslå alle|hylkää kaikki', 'i')",
      "button:text-matches('すべて拒否|拒否する|全部拒绝|拒绝所有|모두 거부|거부합니다', 'i')",
    ],
  },
  browser: {
    engine: "chromium",
    headless: true,
    args: [],
    launchTimeoutMs: 60_000,
    navigationTimeoutMs: 30_000,
    ignoreHTTPSErrors: false,
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
