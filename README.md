# UniVerscan

**Universal Playwright Web Compliance Scanner**

UniVerscan is a modular web compliance scanning framework built around
Playwright. It analyzes websites and web application source code against
configurable legal, regulatory, accessibility, privacy, cookie, consumer
protection, and technical compliance requirements across multiple
jurisdictions.

**New here?** Jump to the [Tutorial](#tutorial) for a walkthrough from a
first scan to a CI gate.

## Contents

- [What this tool is - and is not](#what-this-tool-is---and-is-not)
- [Core architecture](#core-architecture)
- [Operating modes](#operating-modes)
- [Consent and privacy-signal states](#consent-and-privacy-signal-states)
- [Accepted risks (`ignoredFindings`)](#accepted-risks-ignoredfindings)
- [Included regulatory packs](#included-regulatory-packs)
- [**Tutorial**](#tutorial)
  - [Step 1 - Install and build](#step-1---install-and-build)
  - [Step 2 - Run your first scan](#step-2---run-your-first-scan)
  - [Step 3 - Understand a finding](#step-3---understand-a-finding)
  - [Step 4 - Narrow the scan to your actual obligations](#step-4---narrow-the-scan-to-your-actual-obligations)
  - [Step 5 - Fix something, then prove you fixed it](#step-5---fix-something-then-prove-you-fixed-it)
  - [Step 6 - Record a risk you cannot fix yet](#step-6---record-a-risk-you-cannot-fix-yet)
  - [Step 7 - Gate CI on regressions, not on the backlog](#step-7---gate-ci-on-regressions-not-on-the-backlog)
  - [Scanning a repository instead of a URL](#scanning-a-repository-instead-of-a-url)
  - [Writing your own rule pack](#writing-your-own-rule-pack)
  - [Using the framework as a library](#using-the-framework-as-a-library)
- [Command reference](#command-reference)
- [Configuration reference](#configuration-reference)
- [CI integration](#ci-integration)
- [Crawl scope and robots.txt](#crawl-scope-and-robotstxt)
- [For AI coding agents](#for-ai-coding-agents)
- [Development](#development)

## What this tool is - and is not

UniVerscan does **not** claim a website is legally compliant because
automated tests pass. Instead it identifies, with reproducible evidence:

- confirmed technical violations
- probable compliance violations
- compliance risks
- missing disclosures
- inconsistent behavior
- items requiring manual legal review
- rules that could not be evaluated automatically (reported as
  `not-evaluated`, never as a silent pass)

Its purpose is to automate everything that can be tested objectively,
collect evidence for what can only be partially automated, and clearly flag
what needs a human - a lawyer, an accessibility specialist, a data
protection professional.

## Core architecture

- **Engine** (`src/engine/`): browser lifecycle, site discovery, evidence
  collection, and the rule-execution loop. Contains **no** jurisdiction-specific
  legal logic.
- **Modules** (`src/modules/`): reusable signal collectors - accessibility
  (axe-core), cookie/consent state comparison including a Global Privacy
  Control probe, privacy document/disclosure scanning, forms/personal-data
  detection, network/third-party intelligence, transport and response-header
  security, AI-interaction detection, consumer-journey signals (withdrawal
  controls, order-button labelling, urgency claims), and source-code mode
  (framework detection, local app startup, static analysis).
- **Regulatory packs** (`src/packs/`): independent, pluggable rule sets, one
  per jurisdiction/regulation. Adding a jurisdiction never requires touching
  the engine - see `AGENTS.md` for the extension steps.
- **Reporters** (`src/reporters/`): JSON, HTML executive dashboard, console,
  JUnit, SARIF 2.1.0 (GitHub code scanning), Markdown (CI job summaries and
  PR comments), and CSV (spreadsheet triage).

Every finding carries a `severity`, an independent `confidence`, an
`automationLevel` (`fully-automated` / `partially-automated` /
`evidence-only` / `manual-review-required`), evidence, a legal reference,
and remediation guidance. Nothing is presented as a legal verdict.

## Operating modes

1. **Live website mode** - input is a URL; Playwright drives a real browser
   against the rendered DOM, network traffic, cookies/storage, forms,
   consent flows, and linked privacy documents.
2. **Source-code mode** - input is a repository. UniVerscan detects the
   framework, and - only when explicitly permitted via
   `source.allowInstall`/`allowBuild` - installs and starts it locally so
   the same live-mode pipeline can run against `localhost`.
3. **Static analysis mode** - used when the app cannot be started. Regex-based
   scanning over source files detects tracking scripts, cookie/storage
   writes, missing accessibility attributes, insecure resource references,
   and the presence/absence of a privacy policy reference. Every static
   finding is `evidence-only`: it flags a signal, not a confirmed runtime
   behavior.

## Consent and privacy-signal states

Live mode visits the site as several independent simulated visitors, each in
its own browser context so no cookie or storage state leaks between them:

| State | What the visitor does |
| --- | --- |
| `before-consent` | Loads the page and touches nothing. |
| `gpc-signal` | Asserts Global Privacy Control - the `Sec-GPC: 1` request header **and** `navigator.globalPrivacyControl === true` - and takes no other action. |
| `reject-all` | Clicks the reject control on the consent banner. |
| `accept-all` | Clicks the accept control. |
| `withdrawn` | Accepts, then withdraws consent through the site's own preference centre. |

Comparing these states is what turns "a tracker fired" into evidence about
*when* it fired and *whether the site honoured what the visitor asked for*.
Disabling the GPC probe (`consent.probeGlobalPrivacyControl: false`) makes
the universal-opt-out rules report `not-evaluated`; it never makes them pass.

## Accepted risks (`ignoredFindings`)

A risk a human has explicitly accepted is recorded in the config, never by
editing a rule:

```jsonc
"ignoredFindings": [
  {
    "ruleId": "security-response-headers",
    "reason": "Headers are applied at the CDN edge, which is not in front of this staging origin.",
    "approvedBy": "security-team@example.com",
    "expires": "2027-01-01"
  }
]
```

The engine enforces three properties that keep an exception honest:

- An entry with no `reason` is **rejected** and the finding is reported
  normally - an exception cannot be a silent rule disable.
- An entry past its `expires` date stops applying on its own.
- A suppressed finding is **moved**, not deleted: it appears under
  `suppressedFindings` in the JSON, in its own section of the HTML, Markdown
  and CSV reports, and in SARIF as a `suppressions` entry carrying the
  justification. A `not-evaluated` finding is never suppressible, because an
  exception may accept a known risk but may not hide a gap in the scan.

## Included regulatory packs

| Pack | Regulation | Jurisdiction | Applies from |
| --- | --- | --- | --- |
| `eu-gdpr-eprivacy` | GDPR / ePrivacy Directive | European Union | 2018-05-25 |
| `eu-accessibility-act` | European Accessibility Act (Dir. (EU) 2019/882) / EN 301 549 | European Union | 2025-06-28 |
| `eu-ai-act-transparency` | AI Act (Reg. (EU) 2024/1689) Art. 50 transparency | European Union | 2026-08-02 |
| `eu-consumer-rights` | Consumer Rights Directive (incl. the Art. 11a withdrawal function) / UCPD / DSA Art. 25 | European Union | 2026-06-19 |
| `wcag-accessibility` | WCAG 2.2 | Global | 2023-10-05 |
| `global-data-security` | Security of processing (transport, headers, cookie attributes) | Global | 2018-05-25 |
| `us-ca-ccpa-cpra` | CCPA / CPRA (+ COPPA hook) | United States - California | 2023-01-01 |
| `us-state-privacy` | US state privacy laws - universal opt-out (GPC) handling | United States - multi-state | 2026-01-01 |
| `uk-gdpr-pecr` | UK GDPR / PECR | United Kingdom | 2021-01-01 |
| `au-privacy-dda` | Privacy Act / APPs / DDA | Australia | 2014-03-12 |
| `br-lgpd` | LGPD | Brazil | 2020-09-18 |
| `ca-pipeda` | PIPEDA | Canada | 2001-01-01 |
| `jp-appi` | APPI | Japan | 2022-04-01 |
| `in-dpdp` | DPDP Act 2023 + DPDP Rules 2025 | India | 2027-05-13 |

The `Applies from` column is the date the pack's obligations bite, not the
date the pack was written. A pack whose date is in the future still runs, so
a team can see the work ahead of a deadline rather than after it.

This is an extensible starting library, not a claim that every law in every
country is fully implemented - see `src/packs/helpers.ts` and `AGENTS.md`
for how to add a pack. Run `universcan packs` to list what is registered.

## Tutorial

A walkthrough from a first scan to a CI gate. It uses a small e-commerce
page as the running example; substitute your own URL at any point.

### Step 1 - Install and build

```bash
git clone https://github.com/jomardyan/Playwright-Law-Suite.git
cd Playwright-Law-Suite
npm install
npm run build
npx playwright install --with-deps chromium   # first time only
```

Check the install by listing the regulatory packs and the dates their
obligations apply from:

```bash
node dist/cli.js packs
```

### Step 2 - Run your first scan

Start broad, with a single pack, so the output stays readable:

```bash
node dist/cli.js scan \
  --url https://shop.example \
  --jurisdictions "European Union" \
  --sector e-commerce \
  --packs eu-consumer-rights \
  --format console,json \
  --out ./universcan-report
```

The console report opens with coverage, then risk indicators, then findings
grouped by severity:

```text
Coverage
  Pages scanned: 2
  Rules evaluated: 6
  Rules skipped (not applicable): 0
  Rules not evaluated: 0
  Manual review items: 1
  Suppressed by documented exception: 0

HIGH (3)
  [eu-consumer-rights/crd-order-button-payment-obligation] probable-violation:
  The order control is labelled "Complete your order", which does not state
  that placing the order carries an obligation to pay.
    at: https://shop.example/

  [eu-consumer-rights/crd-no-pre-checked-additional-payments] violation:
  A consent checkbox labelled "Marketing consent" is pre-ticked on page load.
    at: https://shop.example/

MEDIUM (2)
  [eu-consumer-rights/ucpd-dsa-manipulative-design-signals] manual-review:
  Urgency or scarcity claims were found on the page: Only 2 left. Whether
  each claim is factually accurate cannot be determined by scanning.
    at: https://shop.example/
```

**Read the coverage block first.** `Rules not evaluated` is the number that
matters most: those checks could not run, and they are not passes. A scan
with high conformity and high `not evaluated` has told you very little.

### Step 3 - Understand a finding

Every finding in `report.json` carries four independent fields that are
easy to conflate:

```jsonc
{
  "ruleId": "crd-no-pre-checked-additional-payments",
  "status": "violation",            // what was concluded
  "severity": "high",               // impact IF the issue is real
  "confidence": "high",             // how sure the check is that it IS real
  "automationLevel": "fully-automated", // what the check can establish alone
  "requirement": "Express consent must be obtained for any additional payment or optional extra; a pre-ticked box does not constitute consent.",
  "observedBehavior": "A consent checkbox labelled \"Marketing consent\" is pre-ticked on page load.",
  "expectedBehavior": "Optional consent and add-on checkboxes are unchecked by default.",
  "affectedUrl": "https://shop.example/",
  "affectedElement": "form[0] checkbox: Marketing consent",
  "evidence": [
    { "type": "dom-fragment", "description": "Pre-checked consent control", "data": "Marketing consent" }
  ],
  "legalReference": "Directive 2011/83/EU Art. 22; Directive 2005/29/EC Annex I point 29",
  "remediation": "Ship every optional add-on, newsletter, or marketing checkbox unchecked, and require an affirmative action.",
  "manualReviewRequired": false
}
```

`severity` and `confidence` are deliberately separate: "high severity,
low confidence" is a real and useful combination, and averaging the two into
one score would destroy the distinction.

`status` tells you what kind of thing you are holding:

| Status | Means |
| --- | --- |
| `violation` | A confirmed technical failure. Fix it. |
| `probable-violation` | Strong evidence, but a human should confirm the context. |
| `risk` | Not a breach on its own; raises the chance of one. |
| `missing-disclosure` | Something legally required was not found. |
| `inconsistent` | The site behaves differently than it says it does. |
| `manual-review` | Only a person can decide. The scan collected the evidence. |
| `not-evaluated` | **The check could not run. This is never a pass.** |

`automationLevel` says what the rule can establish by itself, from
`fully-automated` down to `manual-review-required`. Use it to decide how
much weight a finding carries before anyone has looked at it.

### Step 4 - Narrow the scan to your actual obligations

Command-line flags are fine for exploring; real use belongs in a config
file. Create `universcan.config.json` in your project:

```jsonc
{
  "extends": "global-baseline",
  "target": { "url": "https://shop.example" },

  // Drive pack selection from where your customers actually are.
  "jurisdictions": ["European Union", "United Kingdom"],
  "customerMarkets": ["European Union", "United Kingdom"],
  "businessSector": "e-commerce",

  "crawl": { "depth": 3, "pageLimit": 40 },
  "reporting": {
    "formats": ["json", "html", "markdown"],
    "outputDir": "./universcan-report"
  }
}
```

```bash
node dist/cli.js scan --config universcan.config.json
```

Two things to get right here:

- **Do not select every jurisdiction.** Packs load from `jurisdictions` and
  `customerMarkets`; naming markets you do not serve produces findings you
  do not owe. Omit `regulatoryPacks` entirely and let applicability decide,
  or pin an explicit list when you want a narrow run.
- **`extends` composes.** Keep organisation-wide defaults in one profile and
  layer per-market files on top, rather than copying a config per project.
  See `config/profiles/` for the bundled examples.

Open `universcan-report/report.html` for the executive dashboard. It is the
artifact to hand to a non-technical stakeholder, and it deliberately shows
no single compliance percentage.

### Step 5 - Fix something, then prove you fixed it

Keep the first report as a baseline, apply the remediation the finding asked
for (here: ship the marketing checkbox unchecked, relabel the order button),
then compare:

```bash
cp -r universcan-report universcan-baseline

# ... make the fix in your application ...

node dist/cli.js scan --config universcan.config.json
node dist/cli.js diff \
  --baseline ./universcan-baseline/report.json \
  --current  ./universcan-report/report.json
```

```text
New: 0 · Resolved: 2 · Changed: 0 · Unchanged: 3

## Resolved findings (2)

A finding disappears when it is fixed, when it is suppressed by a config
exception, or when the page it was found on was not reached this time.
Confirm which before reporting it as fixed.

- `crd-no-pre-checked-additional-payments` [high/violation] https://shop.example/
- `crd-order-button-payment-obligation` [high/probable-violation] https://shop.example/
```

Check the **Rules that stopped being evaluated** section before you call the
round a success. A rule that no longer runs has lost you coverage; it has
not fixed anything, and the diff refuses to count it as a fix.

### Step 6 - Record a risk you cannot fix yet

Some findings are real but cannot be resolved this quarter. Record the
accepted risk in the config - never by editing a rule:

```jsonc
"ignoredFindings": [
  {
    "ruleId": "security-response-headers",
    "reason": "Headers are applied at the CDN edge, which is not in front of this staging origin.",
    "approvedBy": "security-team@example.com",
    "expires": "2027-01-01"
  }
]
```

The finding moves to `report.suppressedFindings` and keeps appearing - in
its own HTML section, in the Markdown and CSV output, and in SARIF as a
`suppressions` entry with the justification attached. It is recorded, not
erased. An entry with no `reason` is rejected outright, and one past its
`expires` date stops applying on its own.

### Step 7 - Gate CI on regressions, not on the backlog

A first scan of an existing site finds a backlog. Failing every build on it
helps nobody, so gate on what the current change introduced:

```bash
node dist/cli.js scan \
  --config universcan.config.json \
  --format json,markdown,sarif \
  --baseline ./universcan-baseline/report.json \
  --fail-on-new \
  --fail-on critical,high
```

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` a usage or
input error. With `--fail-on-new`, only findings absent from the baseline
count toward the gate; everything else still appears in every report.

`.github/workflows/universcan.yml` wires this up: SARIF to code scanning,
the Markdown report into the job summary, and a pull-request job that diffs
against the default branch's last report. Nothing in it is
GitHub-specific beyond those two upload steps - the same CLI runs unchanged
under GitLab CI, Azure DevOps, or Jenkins.

### Scanning a repository instead of a URL

Source mode takes a repo path. By default it runs **static analysis only**,
which needs no permission and starts nothing:

```bash
node dist/cli.js scan --repo ../my-app --format console,json
```

Every static finding is `evidence-only` - it flags a signal in the source,
not a confirmed runtime behavior - and every browser-dependent rule reports
`not-evaluated`. That is correct behavior, not a gap to work around.

To get the full pipeline, let UniVerscan install and start the app so it can
drive a real browser against `localhost`:

```bash
node dist/cli.js scan --repo ../my-app --allow-install --allow-build
```

Pass those two flags only when you are willing to have dependencies
installed and a dev server started. UniVerscan reuses the project's own
scripts (`npm run dev`, `npm start`) rather than inventing a command; when
both `--url` and `--repo` are given, it scans the repository and merges the
static findings into the live results, reporting mode `combined`.

### Writing your own rule pack

The engine holds no jurisdiction-specific logic, so a house rule or a
regulation this repository does not ship is additive - you never touch the
engine or another pack.

Create `packs/acme.mjs` next to your config (compiled JS or `.mjs`; a `.ts`
file needs building first). Import the helpers from the package when
UniVerscan is a dependency, or from `dist/index.js` when you are working in
a clone of this repository:

```js
import { defineRule, buildFinding } from "universcan";
// In a clone: from "/path/to/Playwright-Law-Suite/dist/index.js"

const PACK_ID = "acme-internal";

const noStagingBanner = defineRule({
  id: "acme-no-staging-banner",
  requirement: "Production pages must not display the internal staging banner.",
  severity: "medium",
  confidence: "high",
  automationLevel: "fully-automated",
  legalReference: "ACME internal release policy RP-14",
  remediation: "Remove the staging banner before promoting the build.",
  run: (context) =>
    context.pages
      .filter((page) => page.consumerJourney?.urgencyClaims.some((c) => /staging/i.test(c)))
      .map((page) =>
        buildFinding(noStagingBanner, PACK_ID, "ACME internal policy", "Internal", {
          status: "violation",
          affectedUrl: page.url,
          observedBehavior: "The staging banner is visible on a production page.",
          expectedBehavior: "No staging banner on production.",
        })
      ),
});

export const pack = {
  id: PACK_ID,
  jurisdiction: "Internal",
  country: "Internal",
  regulation: "ACME internal policy",
  authority: "ACME platform team",
  version: "1.0.0",
  effectiveDate: "2026-01-01",
  applicability: () => true,   // or gate on config.businessSector, markets, ...
  rules: [noStagingBanner],
};
```

Point the config at it - relative paths resolve against the config file, and
a bare specifier is treated as an installed package:

```jsonc
{
  "customRulesPaths": ["./packs/acme.mjs"],
  "jurisdictions": ["European Union"]
}
```

The module must export the pack as `pack` or as the default export. Four
conventions keep a custom pack trustworthy:

1. Set `severity`, `confidence`, `automationLevel`, `legalReference`, and
   `remediation` explicitly. `defineRule` will not guess them for you.
2. Set `requiresLivePages: false` only if the rule works from
   `context.source` alone. Otherwise the engine reports it `not-evaluated`
   when no browser page exists, which is what you want.
3. Return `status: "manual-review"` when the answer needs a human, rather
   than guessing at a verdict.
4. If your rule needs a signal no module collects, add a collector under
   `src/modules/` and surface it on `PageContext`. Rules run after the crawl
   finishes, so the live `Page` no longer sits on the URL a rule is
   reasoning about.

### Using the framework as a library

```ts
import { ScanEngine, loadConfigFromObject, writeReports, diffReports } from "universcan";

const config = loadConfigFromObject({
  target: { url: "https://shop.example" },
  jurisdictions: ["European Union"],
  businessSector: "e-commerce",
  reporting: { formats: ["json", "html"], outputDir: "./universcan-report" },
});

const report = await new ScanEngine().run(config);
writeReports(report, config);

// Findings are plain data - filter, route, or escalate them however you like.
const blocking = report.findings.filter(
  (f) => f.status === "violation" && (f.severity === "critical" || f.severity === "high")
);
const needsALawyer = report.findings.filter((f) => f.manualReviewRequired);

console.log(`${blocking.length} to fix, ${needsALawyer.length} for legal review`);
console.log(`${report.coverage.rulesNotEvaluated} rule(s) could not run - not passes`);
```

`ScanEngine` also exposes `runLive()` and `runSource()` directly when you
already know the mode. `diffReports(baseline, current)` gives you the same
comparison the `diff` command prints, as a structured object.

## Command reference

| Command | Purpose |
| --- | --- |
| `scan` | Scan a URL and/or a repository and write reports. |
| `diff` | Compare two `report.json` files. |
| `report` | Re-render an existing `report.json` (currently `markdown`). |
| `packs` | List built-in packs, versions, and effective dates. |

Key `scan` options:

| Option | Purpose |
| --- | --- |
| `--url <url>` | Live website to scan. |
| `--repo <path>` | Repository to scan (source/static mode). |
| `--config <path>` | Config file (JSON or YAML), supports `extends`. |
| `--jurisdictions <list>` | Comma-separated, e.g. `"European Union,United Kingdom"`. |
| `--packs <list>` | Restrict to specific pack ids. |
| `--sector <sector>` | Business sector, used by pack applicability. |
| `--accessibility-standard <s>` | `wcag2a` … `wcag22aaa`. |
| `--format <list>` | `json,html,console,junit,sarif,markdown,csv`. |
| `--out <dir>` | Output directory. |
| `--allow-install` / `--allow-build` | Permit dependency install / app startup in source mode. |
| `--baseline <path>` | Compare against a previous `report.json`. |
| `--fail-on-new` | Gate only on findings absent from the baseline. |
| `--fail-on <list>` | Severities that cause exit code 1. |

## Configuration reference

Tutorial Step 4 covers writing a config; this section is the reference.
`config/example.universcan.config.json` is a fully populated file, and
`config/profiles/` holds the bundled profiles. `extends` resolves either a
path relative to the current file or a bare profile name under
`config/profiles/`, so an organization can keep one baseline and layer
country- or sector-specific files on top.

| Key | Purpose |
| --- | --- |
| `target.url` / `target.repoPath` | What to scan. Both may be set. |
| `jurisdictions`, `customerMarkets`, `companyLocation`, `businessSector` | Drive which packs apply. |
| `regulatoryPacks` | Pin an explicit pack allowlist instead of letting applicability decide. |
| `accessibility.standard` | `wcag2a` … `wcag22aaa`. |
| `accessibility.includeInteractionChecks` | Run the keyboard/focus checks axe cannot do. |
| `crawl.depth`, `crawl.pageLimit` | Crawl bounds. |
| `crawl.includedRoutes` / `excludedRoutes` | Regex filters on the path. |
| `crawl.respectRobotsTxt` | Honour robots.txt (default `true`; see below). |
| `consent.enabled`, `acceptSelectors`, `rejectSelectors`, `testWithdrawal` | Consent-banner simulation. |
| `consent.probeGlobalPrivacyControl` | Run the GPC visit (default `true`). |
| `authentication` | `none`, `password`, `storage-state`, or `custom-script`. Credentials come from env vars only. |
| `source.allowInstall` / `allowBuild` | Permit dependency install / app startup in source mode. |
| `customRulesPaths` | Load your own packs; relative paths resolve against the config file. |
| `ignoredFindings` | Documented accepted risks (see above). |
| `reporting.formats`, `reporting.outputDir` | What to write and where. |
| `ci.failOn`, `ci.warnOn` | Severities that fail or warn. |

Authentication secrets are read from the environment only
(`authentication.usernameEnvVar` / `passwordEnvVar`) and are never written
into a config file, a finding, or a report.

Bundled profiles:

| Profile | Scope |
| --- | --- |
| `global-baseline` | Shared defaults every other profile extends. |
| `eu-digital-compliance` | GDPR, EAA/EN 301 549, AI Act transparency, consumer rights, WCAG 2.2 AA, and transport security for an EU consumer service. |
| `eu-ecommerce` | GDPR/ePrivacy focused EU e-commerce scan. |
| `us-multistate-privacy` | CCPA/CPRA plus the multi-state universal opt-out (GPC) pack. |
| `us-ca-consumer` | California-only consumer scan. |
| `global-multi-market` | Every jurisdiction pack, for a service sold worldwide. |

## CI integration

Tutorial Step 7 covers the gating strategy.
`.github/workflows/universcan.yml` is a working GitHub Actions example: it
fails on `critical`/`high` findings, surfaces `manual-review` items as
warnings, writes the Markdown report into the job summary, uploads SARIF to
code scanning, and runs a second job that diffs the pull request against the
default branch's last report.

Nothing about the scanner is GitHub-specific. Under GitLab CI, Azure
DevOps, or Jenkins, invoke `node dist/cli.js scan ...` as a build step and
consume whichever format that platform understands - `junit` for a test
report, `markdown` for a job summary, `csv` for triage.

## Crawl scope and robots.txt

`crawl.respectRobotsTxt` defaults to `true`: UniVerscan fetches
`/robots.txt`, honours the group addressed to `universcan` (falling back to
`*`), follows the standard longest-match Allow/Disallow precedence, and
picks up any `Sitemap:` declarations to widen discovery. Pages excluded this
way are logged as **unscanned, not compliant** - they never silently count
as passes. Set it to `false` only for a target you own or have written
permission to scan in full.

## For AI coding agents

See [`AGENTS.md`](./AGENTS.md) for the step-by-step workflow and the safety
rules agents must follow when applying UniVerscan to a project (never treat
an inaccessible page as passed, never weaken a rule to make a scan pass,
never present automated output as a legal compliance verdict).

## Development

```bash
npm run typecheck
npm test
npm run dev -- scan --url https://example.com
```

The end-to-end tests drive a real Chromium against a local fixture server
and are skipped automatically when no browser is available, so the unit
suite still runs in a browser-less environment.

## License

MIT - see [LICENSE](./LICENSE).
