# UniVerscan

**Universal Playwright Web Compliance Scanner**

UniVerscan is a modular web compliance scanning framework built around
Playwright. It analyzes websites and web application source code against
configurable legal, regulatory, accessibility, privacy, cookie, consumer
protection, and technical compliance requirements across multiple
jurisdictions.

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

## Installation

```bash
npm install
npm run build
npx playwright install --with-deps chromium   # first time only
```

## Usage

Scan a live website:

```bash
node dist/cli.js scan \
  --url https://example.com \
  --jurisdictions "European Union" \
  --format json,html,sarif,markdown,console \
  --out ./universcan-report
```

Report formats: `json`, `html`, `console`, `junit`, `sarif` (GitHub code
scanning), `markdown` (CI job summary or PR comment), `csv` (spreadsheet
triage).

Scan using a saved profile (supports `extends` for a shared baseline):

```bash
node dist/cli.js scan --url https://example.com --config config/profiles/eu-ecommerce.json
```

Scan a repository (static analysis only unless install/build is permitted):

```bash
node dist/cli.js scan --repo ../my-app --allow-install --allow-build
```

Verify a remediation round by comparing against the previous report:

```bash
# During a scan - prints the comparison and, with --fail-on-new, gates CI
# on the findings this change introduced rather than on the whole backlog.
node dist/cli.js scan --url https://example.com \
  --baseline ./previous/report.json --fail-on-new

# Or compare two reports that already exist.
node dist/cli.js diff --baseline ./before/report.json --current ./after/report.json
```

The diff separates new, resolved, and reclassified findings, and reports
separately on **rules that stopped being evaluated** - a rule that no longer
runs is a loss of coverage, not a fix, and is never counted as one.

Re-render an existing report without re-scanning:

```bash
node dist/cli.js report --input ./universcan-report/report.json --format markdown
```

List built-in regulatory packs and the dates their obligations apply from:

```bash
node dist/cli.js packs
```

Programmatic use:

```ts
import { ScanEngine, loadConfigFromObject, writeReports } from "universcan";

const config = loadConfigFromObject({
  target: { url: "https://example.com" },
  jurisdictions: ["European Union"],
});
const report = await new ScanEngine().run(config);
writeReports(report, config);
```

## Configuration

See `config/example.universcan.config.json` and `config/profiles/`. Config
files support `extends` so an organization can maintain a global baseline
(`config/profiles/global-baseline.json`) and layer country/sector-specific
requirements on top.

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

See `.github/workflows/universcan.yml` for a GitHub Actions example. It
fails the build on `critical`/`high` findings while surfacing
`manual-review` items as warnings, writes the Markdown report into the job
summary, uploads the SARIF report to GitHub code scanning, and runs a second
job that diffs the pull request against the default branch's last report so
only newly introduced findings gate the merge.

The same `ScanEngine` works unmodified from GitLab CI, Azure DevOps, or
Jenkins by invoking `node dist/cli.js scan ...` as a build step; `--format
sarif` and `--format markdown` are equally useful there.

### Crawl scope and robots.txt

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
