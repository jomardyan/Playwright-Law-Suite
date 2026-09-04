# UniVerscan

[![CI](https://github.com/jomardyan/Playwright-Law-Suite/actions/workflows/ci.yml/badge.svg)](https://github.com/jomardyan/Playwright-Law-Suite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/universcan.svg)](https://www.npmjs.com/package/universcan)
[![node](https://img.shields.io/node/v/universcan.svg)](https://www.npmjs.com/package/universcan)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

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
  - [Step 1 - Install](#step-1---install)
  - [Step 2 - Run your first scan](#step-2---run-your-first-scan)
  - [Step 3 - Understand a finding](#step-3---understand-a-finding)
  - [Step 4 - Narrow the scan to your actual obligations](#step-4---narrow-the-scan-to-your-actual-obligations)
  - [Step 5 - Fix something, then prove you fixed it](#step-5---fix-something-then-prove-you-fixed-it)
  - [Step 6 - Record a risk you cannot fix yet](#step-6---record-a-risk-you-cannot-fix-yet)
  - [Step 7 - Gate CI on regressions, not on the backlog](#step-7---gate-ci-on-regressions-not-on-the-backlog)
  - [Autoscan: scanning without knowing the scope](#autoscan-scanning-without-knowing-the-scope)
  - [Scanning a repository instead of a URL](#scanning-a-repository-instead-of-a-url)
  - [Writing your own rule pack](#writing-your-own-rule-pack)
  - [Using the framework as a library](#using-the-framework-as-a-library)
- [Running it in your environment](#running-it-in-your-environment)
- [Interactive use](#interactive-use)
  - [When something is wrong](#when-something-is-wrong)
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

1. **Autoscan mode** - input is a URL and nothing else. UniVerscan probes
   the site first to work out which markets it serves and what kind of
   service it is, selects the matching regulatory packs, and then runs a
   normal live scan. The inferred scope is reported with the evidence behind
   every market it selected, and every market it considered and rejected.
   See [Autoscan](#autoscan-scanning-without-knowing-the-scope).
2. **Live website mode** - input is a URL; Playwright drives a real browser
   against the rendered DOM, network traffic, cookies/storage, forms,
   consent flows, and linked privacy documents.
3. **Source-code mode** - input is a repository. UniVerscan detects the
   framework, and - only when explicitly permitted via
   `source.allowInstall`/`allowBuild` - installs and starts it locally so
   the same live-mode pipeline can run against `localhost`.
4. **Static analysis mode** - used when the app cannot be started. Regex-based
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

The no-interaction visit is made more than once (`consent.beforeConsentVisits`,
default 2) and the observations are unioned, because a site does not load the
same trackers on every request: two consecutive scans of one site observed 36
third-party services before consent and then 3, so the same page produced 43
pre-consent findings and then none. Each finding says which visits saw the
recipient, so a quiet result can be told apart from a lucky one.

Each state records outbound requests **and** what was written to the device:
cookies, `localStorage` and `sessionStorage`. Both halves matter, because a
site running analytics through a server-side tag writes `_ga` and `_fbp`
without ever making a request to a tracker's domain - and Art. 5(3) ePrivacy
governs the storing of information on the terminal equipment, not who the
request went to. The visitor's own consent record is deliberately excluded:
that cookie exists because the site implemented consent.

Consent controls are looked for across every frame of the page, not only the
main document, because most consent platforms render their banner in an
iframe. Whether banner markup was present at all is recorded separately from
whether a control was identified in it, so "this site has no consent
mechanism" and "this scanner could not read this banner" stay different
findings.

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

| Pack | Regulation | Jurisdiction |
| --- | --- | --- |
| `eu-gdpr-eprivacy` | GDPR / ePrivacy Directive | European Union |
| `eu-accessibility-act` | European Accessibility Act / EN 301 549 | European Union |
| `eu-ai-act-transparency` | AI Act Art. 50 transparency | European Union |
| `eu-consumer-rights` | Consumer Rights Directive / UCPD / DSA Art. 25 | European Union |
| `uk-gdpr-pecr` | UK GDPR / PECR | United Kingdom |
| `ch-fadp` | revised Federal Act on Data Protection | Switzerland |
| `us-ca-ccpa-cpra` | CCPA / CPRA (+ COPPA hook) | United States - California |
| `us-state-privacy` | State comprehensive privacy laws (universal opt-out) | United States - multi-state |
| `us-ada-title-ii` | ADA Title II web rule (28 CFR Part 35, Subpart H) | United States - public entities |
| `ca-pipeda` | PIPEDA | Canada |
| `ca-qc-law25` | Quebec Law 25 | Canada - Quebec |
| `br-lgpd` | LGPD | Brazil |
| `au-privacy-dda` | Privacy Act / APPs / DDA | Australia |
| `jp-appi` | APPI | Japan |
| `kr-pipa` | PIPA | South Korea |
| `cn-pipl` | PIPL | China |
| `in-dpdp` | DPDP Act 2023 and Rules 2025 | India |
| `sg-pdpa` | PDPA 2012 | Singapore |
| `th-pdpa` | PDPA B.E. 2562 | Thailand |
| `za-popia` | POPIA | South Africa |
| `sa-pdpl` | PDPL | Saudi Arabia |
| `ng-ndpa` | Nigeria Data Protection Act 2023 | Nigeria |
| `wcag-accessibility` | WCAG 2.2 | Global |
| `global-data-security` | Security of processing (cross-regime) | Global |

Packs are not interchangeable templates. Where a regime genuinely differs,
the pack differs:

- **Switzerland** uses the FDPIC's tiered cookie model - only advertising and
  profiling cookies need opt-in, so `ch-fadp` does not report analytics the
  way an EU pack would.
- **Singapore** has no ePrivacy-style cookie rule, so `sg-pdpa` checks the
  notification obligation rather than demanding a consent banner.
- **Quebec** requires confidentiality *by default*, so `ca-qc-law25` treats
  tracking that is live on arrival as a failure in itself.
- **China** requires *separate* consent for several purposes, so a single
  bundled "accept all" fails `cn-pipl` even where it would satisfy the GDPR.
- **ADA Title II** adopts WCAG 2.1 AA specifically, so `us-ada-title-ii`
  excludes 2.2-only criteria, and applies only to public-sector targets.

This is an extensible starting library, not a claim that every law in every
country is fully implemented - see `src/packs/helpers.ts` and `AGENTS.md`
for how to add a pack. Run `universcan packs` to list what is registered.

## Tutorial

A walkthrough from a first scan to a CI gate. It uses a small e-commerce
page as the running example; substitute your own URL at any point.

### Step 1 - Install

Install the CLI and the browser it drives:

```bash
npm install -g universcan
npx playwright install --with-deps chromium   # first time only
```

Or run it without installing anything:

```bash
npx universcan scan --url https://shop.example --jurisdictions "European Union"
```

Node 20 or newer is required.

Check the install by listing the regulatory packs and the dates their
obligations apply from:

```bash
universcan packs
```

Then confirm the environment can actually run a scan. This separates an
environment fault from a real finding, and is worth running before the first
scan on any new machine:

```bash
universcan doctor
```

<details>
<summary>Running from source instead</summary>

```bash
git clone https://github.com/jomardyan/Playwright-Law-Suite.git
cd Playwright-Law-Suite
npm install
npm run build
npx playwright install --with-deps chromium
node dist/cli.js packs
```

Every `universcan` command below then becomes `node dist/cli.js`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full development setup.

</details>

In a hurry? `node dist/cli.js init` walks you through the whole of Steps 2-4
interactively - it probes the site, proposes a scope, shows which packs that
scope loads, and writes the config file. See
[Interactive use](#interactive-use).

### Step 2 - Run your first scan

> Don't know which jurisdictions apply? Skip to
> [Autoscan](#autoscan-scanning-without-knowing-the-scope) and let the tool
> propose a scope, then come back here.


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

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` the scan
could not run (bad input, no packs selected, or nothing reachable). With `--fail-on-new`, only findings absent from the baseline
count toward the gate; everything else still appears in every report.

`.github/workflows/universcan.yml` wires this up: SARIF to code scanning,
the Markdown report into the job summary, and a pull-request job that diffs
against the default branch's last report. It reads its target from a
`STAGING_URL` repository variable and skips itself when that is unset, so a
clone does not fail on an empty `--url`. Nothing in it is
GitHub-specific beyond those two upload steps - the same CLI runs unchanged
under GitLab CI, Azure DevOps, or Jenkins.

### Autoscan: scanning without knowing the scope

Choosing jurisdictions is the hardest part of the first scan, and getting it
wrong is quiet: name too few markets and the packs that mattered never run.
Autoscan proposes the scope for you.

```bash
node dist/cli.js autoscan --url https://shop.example
```

It loads the homepage plus the usual legal and pricing paths, reads the
market signals each one exposes, and prints what it concluded before it
scans anything:

```text
Autoscan - detected scope
=========================
Markets selected for scanning:
  European Union  [high confidence, score 17]
      - an hreflang alternate for "de-DE"  (hreflang, https://shop.example/)
      - <html lang="de-DE">  (html-lang, https://shop.example/)
      - euro prices  (currency, https://shop.example/)
      - an Impressum (German/Austrian disclosure duty)  (legal-document, https://shop.example/)
      - GDPR named on the page  (regulation-mention, https://shop.example/privacy)
  United Kingdom  [medium confidence, score 5]
      - an hreflang alternate for "en-GB"  (hreflang, https://shop.example/)

Sector: e-commerce
      - cart and checkout controls

Jurisdictions applied: European Union, United Kingdom

Note: Scope was inferred from what the site exposes, not from any record of
where the operator does business. Confirm it before relying on the result: a
market that was not detected was not scanned, and an unscanned market is an
unknown rather than a clean one.
```

Use `--detect-only` to see that block and stop, without scanning:

```bash
node dist/cli.js autoscan --url https://shop.example --detect-only
```

**What it reads.** Only what the page already exposes - no geolocation
lookups and no third-party enrichment. Signals are weighted by how
deliberate they are:

| Signal | Weight | Why |
| --- | ---: | --- |
| `hreflang` alternate with a region | 5 | The site naming its own target markets. |
| Jurisdiction-specific legal document | 4 | An Impressum or a "Do Not Sell" link is an act of compliance with one regime. |
| Country-code TLD | 4 | A deliberate, paid-for choice. |
| A regulation named outright | 3 | "GDPR", "LGPD", "CCPA" in the page or its policies. |
| `<html lang>` with a region | 3 | `de-DE` names a market; `de` alone does not. |
| Currency | 2 | Euro and pound map cleanly; a bare `$` is never mapped. |
| Consent platform loaded | 2 | CMPs are deployed predominantly for EU/UK regimes. |
| `<html lang>`, language only | 1 | A weak proxy - German is spoken in three markets. |

Repeated signals of the same kind count once: three euro prices are one
observation, not three. A market needs a score of **4** to be scanned
against, so one declaration-grade signal is enough and two weak content
signals are not.

**Three properties worth knowing**, because they are what keep an inferred
scope honest:

1. **A near-miss market is reported, not dropped.** Anything scoring 2-3
   appears under "considered, but evidence too thin to scan against", so you
   can add it with `--jurisdictions` if it applies. It is never silently
   discarded.
2. **No signal means inconclusive, not clean.** If nothing clears the bar,
   autoscan says so and runs only the jurisdiction-agnostic rules. It does
   not invent a scope.
3. **An explicit scope always wins.** Pass `--jurisdictions` or `--sector`
   and detection still runs and is still reported, but your values are the
   ones used. A stated scope is a decision someone made; an inferred one is
   a guess.

The inferred scope is written into `report.json` as `meta.scopeDetection`
and rendered in the HTML, Markdown, and console reports, so a reader can
always tell a scope someone chose from a scope the tool guessed.

Once you are happy with what it found, freeze it into a config file and use
`scan` from then on - a committed scope does not drift when the site's
markup changes:

```bash
node dist/cli.js autoscan --url https://shop.example --detect-only
# copy the detected jurisdictions into universcan.config.json, then:
node dist/cli.js scan --config universcan.config.json
```

Autoscan needs a URL. A repository exposes no market signals to probe, so
`--repo` is not accepted.

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

## Interactive use

The CLI is built for CI first, so every interactive affordance degrades
rather than breaking. Colour, Unicode glyphs, spinners and prompts all
switch off automatically when there is no terminal to render them, and the
plain output is what a pipeline log actually wants.

### `init` - set a project up

```bash
node dist/cli.js init
```

Asks what to scan, offers to probe the site for its target markets, lets you
accept or correct the proposal, then shows exactly which packs the resulting
scope loads **before** it writes anything:

```text
Proposed scope
  ✓ European Union (high confidence)
      • an hreflang alternate for "de-DE"
      • euro prices
      • and 3 more signal(s)
  ✓ United Kingdom (medium confidence)
      • an hreflang alternate for "en-GB"

  This was inferred from the site, not from any record of where the business
  operates. A market that was not detected was not scanned, and an unscanned
  market is an unknown rather than a clean one.

❯ Use these 2 market(s)? [Y/n]
```

Answer `n` and you get the full market list to pick from by hand. Scope is a
decision about legal exposure, so the wizard always proposes and never
decides.

`--url` skips the first question, `--no-detect` goes straight to manual
selection, and `--yes` accepts every default for scripted setup.

### `explore` - browse a report

```bash
node dist/cli.js explore --input ./universcan-report/report.json
```

A scan of a real site produces more findings than fit on a screen. This
pages through them and filters by status, severity or pack, searches free
text, and opens any finding with its evidence, legal reference and
remediation:

```text
─── 36 of 36 finding(s) ──────────────────────────────────────────────────
  filters: none
   #  SEVERITY  STATUS              RULE                         WHERE
  ────────────────────────────────────────────────────────────────────────
   1  critical  missing-disclosure  gdpr-privacy-policy-present  /
   5  high      probable-violation  crd-withdrawal-function-...  /

  showing 1-15 of 36   • [n]ext [p]rev [number] open
                       • [s]tatus [v]severity [k]pack [/]search [c]lear  • [q]uit
```

Commands are a single key plus Enter, so it works over a slow SSH session
and needs no raw-mode terminal handling.

### Live progress

`scan` and `autoscan` show a spinner with a page counter while they work,
and a per-step line when there is no TTY. Progress is written to **stderr**,
never stdout, so piping a report to a file or another process gives you the
report and nothing else:

```bash
node dist/cli.js report --input report.json --format markdown > summary.md   # clean
```

`--quiet` suppresses progress entirely.

### When something is wrong

Failures name the problem and the fix, rather than a stack trace:

```text
x No regulatory pack is called 'eu-gdpr'.
  Did you mean 'eu-gdpr-eprivacy'? Run 'universcan packs' for the full list.

! 'Germany' matched no jurisdiction-specific pack, so no rules for that market will run.
  Use 'European Union' instead - that is the pack covering Germany.
```

These checks run **before** the browser launches, so a selection that would
scan nothing fails in a second rather than after a full crawl. That matters
more than it sounds: a mistyped pack id used to load no rules at all, find
nothing, and exit zero - a clean bill of health for a check that never ran.

Two things the CLI now refuses to let pass quietly:

- **A page that could not be loaded is never scanned.** Handing a blank
  error document to the rules manufactured confirmed violations out of
  nothing ("no privacy policy link found" on a page that does not exist).
  Unreachable routes are listed in their own report section, counted in
  `coverage.pagesUnreachable`, and the rules that needed them report
  `not-evaluated`.
- **A scan that reached nothing exits 2, not 0.** An unreachable staging
  host must not read as a green build.

Set `UNIVERSCAN_DEBUG=1` for the full stack trace behind any message.

### Controlling the output

| Setting | Effect |
| --- | --- |
| `--no-color` | Plain text, even on a terminal. |
| `NO_COLOR=1` | Same, via the [no-color.org](https://no-color.org) convention. |
| `FORCE_COLOR=1` | Keep colour when piping, for a log viewer that renders it. |
| `TERM=dumb` | Disables colour, Unicode and prompts. |
| `CI` set | Never interactive, whatever else is true. |
| `--quiet` | No progress output. |
| `packs --plain` | Tab-separated pack list for scripting. |
| `UNIVERSCAN_DEBUG=1` | Full stack traces instead of summarised errors. |

Width is read from the terminal and clamped to a sane range, so tables and
wrapped text fit an 80-column window and a 200-column one alike.

Anything that needs a person degrades with an explanation rather than
hanging: `init` and `explore` exit with code 2 and point at the
non-interactive alternative when stdin is not a terminal.

## Running it in your environment

Start with the preflight - it checks Node, the browser, the sandbox, proxy,
TLS trust, write permissions and pack selection, and says what to do about
anything wrong:

```bash
universcan doctor
```

```text
  + Node.js              v20.11.0
  + Platform             linux x64
  ! Browser sandbox      Running as root, so --no-sandbox will be added automatically.
    Running the scan as a non-root user keeps the sandbox on. In Docker, add a USER line.
  ! Proxy                A proxy is set in the environment but not in the config, so browser
                         traffic will bypass it.
    Set browser.proxy.server to the same value so the scan sees the network your users do.
  + Browser              chromium launches and renders.
```

Exit code `0` clean, `2` when something must be fixed first.

### Containers

`Dockerfile` builds on Playwright's own image, which already carries the
browser and its system libraries - the part that is genuinely painful to
reproduce. Two things matter:

- **Pin the image tag to the resolved Playwright version**, not the caret
  range. A driver newer than the image's browser builds fine and then fails
  to launch. Check with `node -p "require('playwright/package.json').version"`.
- **Run as a non-root user.** Chromium's setuid sandbox cannot start as uid
  0. UniVerscan detects root and adds `--no-sandbox` automatically, logging
  that it did, so a container works out of the box - but the sandbox is a
  real protection, and the shipped `Dockerfile` uses `USER pwuser` to keep
  it. `UNIVERSCAN_NO_SANDBOX=0` opts out of the automatic flag.

```bash
docker build -t universcan .
docker run --rm -v "$PWD/reports:/reports" universcan \
  scan --url https://shop.example --jurisdictions "European Union" --out /reports
```

### CI systems

`.github/workflows/universcan.yml` is the worked GitHub example.
`examples/ci/` has equivalents for **GitLab CI**, **Azure Pipelines**,
**Jenkins** and **CircleCI**. All four follow the same shape: run `doctor`
first so an environment fault is not mistaken for a finding, then scan, then
publish `report.junit.xml` and the HTML artifact.

Exit codes are what a pipeline should branch on:

| Code | Meaning |
| ---: | --- |
| `0` | No findings at the fail-on severities. |
| `1` | Findings at or above `--fail-on`. A compliance result. |
| `2` | The scan could not run - bad input, no packs selected, nothing reachable. An infrastructure result, not a clean bill of health. |

### Browsers, proxies and TLS

Everything about the browser is configurable, because some environment
always cannot run the default:

```jsonc
{
  "browser": {
    "engine": "chromium",              // or firefox / webkit
    "channel": "msedge",               // use a system browser instead of a download
    "executablePath": "/opt/chromium", // or set UNIVERSCAN_CHROMIUM_PATH
    "headless": true,
    "args": ["--disable-gpu"],         // e.g. --no-sandbox, added for you as root
    "launchTimeoutMs": 60000,
    "navigationTimeoutMs": 30000,
    "proxy": {
      "server": "http://proxy.corp:8080",
      "bypass": "*.internal",
      "usernameEnvVar": "PROXY_USER",  // credentials come from the environment,
      "passwordEnvVar": "PROXY_PASS"   // never from the config file
    }
  }
}
```

robots.txt and sitemap fetches go through the **browser's** network stack,
not Node's `fetch`, so they inherit the proxy and TLS settings above. Without
that the crawler and the scanner would see different networks behind a
corporate proxy.

For a TLS-intercepting proxy, add your root certificate with
`NODE_EXTRA_CA_CERTS=/path/to/root.pem`. Do **not** reach for
`NODE_TLS_REJECT_UNAUTHORIZED=0` - `doctor` reports it as a failure, because
a scanner that ignores certificates cannot report on transport security. If
you set `browser.ignoreHTTPSErrors` anyway, the transport rules downgrade
themselves to `not-evaluated` rather than reporting a pass they cannot
justify.

### Using it as a library

The package is ESM-only, and says so precisely: `require()` throws a message
telling you to use a dynamic import, rather than Node's opaque
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

```js
import { ScanEngine, loadConfig } from "universcan";        // ESM
const { ScanEngine } = await import("universcan");           // from CommonJS
```

Requires **Node 18 or newer** (global `fetch`, `AbortSignal.timeout`); an
even-numbered LTS line is recommended and `doctor` warns otherwise.

## Command reference

| Command | Purpose |
| --- | --- |
| `doctor` | Check this environment can run a scan: Node, browser, sandbox, proxy, TLS, permissions, packs. |
| `init` | Interactive setup: proposes a scope, then writes a config file. |
| `explore` | Browse a report interactively: page, filter, search, open a finding. |
| `autoscan` | Detect the target's markets and sector, then scan against them. |
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

`autoscan` accepts the same options plus `--detect-only` (print the inferred
scope and exit without scanning). It requires `--url`.

Global options, valid on every command:

| Option | Purpose |
| --- | --- |
| `--no-color` | Disable coloured output. |
| `--quiet` | Suppress live progress. |

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
| `crawl.depth`, `crawl.pageLimit` | Crawl bounds. `depth` is how many link levels the crawl follows past the entry page; `pageLimit` caps the total, keeping the highest-priority routes. |
| `crawl.includedRoutes` / `excludedRoutes` | Regex filters on the path. |
| `crawl.respectRobotsTxt` | Honour robots.txt (default `true`; see below). |
| `consent.enabled`, `acceptSelectors`, `rejectSelectors`, `testWithdrawal` | Consent-banner simulation. The shipped selector lists cover the major consent platforms and the wording they use in the languages the packs address; set your own only to add a control they miss. |
| `consent.withdrawalSelectors` | How to reopen the consent choice after granting it (the "as easy to withdraw as to give" route). Defaults to the built-in list. |
| `consent.settleMs` | How long to let a page settle before a consent state is captured (default `1500`). Raise it for a site whose banner is injected late. |
| `consent.beforeConsentVisits` | How many independent no-interaction visits the pre-consent result rests on (default `2`, clamped 1-5). Their observations are unioned. Set it to `1` for a faster, less reproducible scan. |
| `consent.probeGlobalPrivacyControl` | Run the GPC visit (default `true`). |
| `authentication` | `none`, `password`, `storage-state`, or `custom-script`. Credentials come from env vars only. |
| `source.allowInstall` / `allowBuild` | Permit dependency install / app startup in source mode. |
| `customRulesPaths` | Load your own packs; relative paths resolve against the config file. |
| `ignoredFindings` | Documented accepted risks (see above). |
| `browser.*` | Engine, channel, executable, headless, args, timeouts, proxy, TLS. See above. |
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
| `apac-privacy` | China, South Korea, Japan, Singapore, Thailand, India and Australia. |
| `global-multi-market` | Every jurisdiction pack, for a service sold worldwide. |

## CI integration

### As a GitHub Action

The quickest way to gate a repository. It installs the scanner, installs the
matching Chromium, runs the scan, and writes the Markdown report into the job
summary:

```yaml
- uses: jomardyan/Playwright-Law-Suite@v0.5.0
  with:
    url: https://staging.shop.example
    jurisdictions: "European Union,United Kingdom"
    fail-on: critical,high
```

Feeding the findings into code scanning, so they appear as alerts on the
Security tab rather than only in the log:

```yaml
- uses: jomardyan/Playwright-Law-Suite@v0.5.0
  id: scan
  continue-on-error: true
  with:
    url: https://staging.shop.example
    config: config/profiles/eu-ecommerce.json
    format: json,markdown,sarif
    fail-on: critical,high

- uses: github/codeql-action/upload-sarif@v4
  if: steps.scan.outputs.sarif != ''
  with:
    sarif_file: ${{ steps.scan.outputs.sarif }}
    category: universcan
```

Inputs mirror the CLI flags: `url`, `repo`, `config`, `jurisdictions`,
`packs`, `sector`, `accessibility-standard`, `format`, `out`, `fail-on`,
`baseline`, `fail-on-new`, plus `autoscan` to infer the scope and `summary`
to control the job-summary output. Outputs are `exit-code`, `report-dir`,
`report-json` and `sarif`.

Two things to know:

- `security-events: write` is required for the SARIF upload, and a pull
  request from a fork or from Dependabot runs with a read-only token that
  cannot write code-scanning results.
- Leaving `fail-on` empty does not disable gating. The flag is then omitted
  and the scanner falls back to `ci.failOn` from the config, which itself
  defaults to `critical,high`. To report without gating, set `ci.failOn` to
  an empty list in a config file.

### As a container

```bash
docker run --rm -v "$PWD/reports:/reports" \
  ghcr.io/jomardyan/playwright-law-suite:latest \
  scan --url https://shop.example --jurisdictions "European Union" --out /reports
```

The image is built on Playwright's own base, so Chromium and every system
library it needs are already present, and it runs as a non-root user so the
browser sandbox stays on. Useful under GitLab CI, Azure Pipelines and Jenkins,
where a Node toolchain plus a browser download is the awkward part.

### As a CLI in any pipeline

Tutorial Step 7 covers the gating strategy.
`.github/workflows/universcan.yml` is a working GitHub Actions example: it
fails on `critical`/`high` findings, surfaces `manual-review` items as
warnings, writes the Markdown report into the job summary, uploads SARIF to
code scanning, and runs a second job that diffs the pull request against the
default branch's last report.

Point it at a deployment before it can do any of that: set a `STAGING_URL`
repository variable under **Settings > Secrets and variables > Actions >
Variables**. Until it is set, every scan job skips and the run says so in
its summary. Two further conditions are worth knowing when adapting the
file:

- A pull request from a fork, and one opened by Dependabot, runs with a
  read-only token. Neither can write code-scanning results or check runs, so
  the SARIF upload and the JUnit check run are skipped there; the uploaded
  report artifact still carries every finding.
- The diff job needs a baseline. The first scan to complete on the default
  branch becomes it, so the job reports that it has nothing to compare
  against until then.

`.github/workflows/ci.yml` is separate and is not an example: it builds,
typechecks and tests UniVerscan itself on Node 20 and 22.

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

Discovery reads `/sitemap.xml` (following a `<sitemapindex>` into the
sitemaps it points at), then crawls links from the entry page to
`crawl.depth` levels. Routes are canonicalised before they are counted - the
fragment is dropped and campaign parameters (`utm_*`, `gclid`, `fbclid`, ...)
are stripped - so one page does not consume several slots in `pageLimit`.
Non-page files (PDFs, images, archives, fonts) are excluded: handing one to
the rule engine yields a document with no links, no forms and no banner,
which reads as a failing page rather than as a file. If the entry URL
redirects to another origin - `example.com` to `www.example.com` - that
origin is added to the scan scope and the redirect is logged.

A response is only handed to the rules if it is actually the page that was
requested. A bot-management challenge, a captcha wall or a geo-block served
with **HTTP 200** carries none of the site's content, and every "this page is
missing X" rule fires against it: on a real scan, three routes of one news
site returned a captcha and were each reported as having no privacy notice
and no mechanism to bypass repeated content. Those responses are recorded in
`unreachablePages` with the reason, exactly as a 404 is - **unscanned, not
compliant**. A route whose own `rel=canonical` points at a page already
scanned is skipped as the same page reached by another URL.

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
