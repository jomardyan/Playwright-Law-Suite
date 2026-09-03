# AGENTS.md - UniVerscan for AI Coding Agents

This file explains how an AI coding agent should apply UniVerscan to a project.
It is instructions for agents, not a substitute for legal, privacy, or
accessibility expertise.

## What UniVerscan is, and is not

UniVerscan is a Playwright-based compliance *scanning* platform. It produces
confirmed technical violations, probable violations, compliance risks,
missing disclosures, inconsistent behavior, and items that require manual
legal review. It never certifies that a website or application is legally
compliant. An agent using this tool must carry that distinction into every
summary, commit message, PR description, or report it produces.

## Workflow

When asked to apply UniVerscan to a project, follow these steps in order.

### Step 1 - Identify the input

Determine whether the task provides a live website (URL), a source
repository, or both. Both is common: scan the repository for static
signals and, if it can be started locally, scan the running application too.

### Step 2 - Determine scope

Work out target markets, target users, business sector, relevant
jurisdictions, and type of application from the request and the repository
(package.json name/description, README, locale files, currency/shipping
config, existing privacy policy). **Do not assume every regulatory pack
applies.** Select jurisdictions based on where customers are, where the
company is, and what the application does - not on every pack this
repository happens to ship.

`universcan autoscan --url <url> --detect-only` proposes a scope from the
live site and prints the evidence for each market. Use it as a **starting
point that you then verify**, never as the answer:

- What it produces is an inference from page markup, not a finding of which
  law applies to the operator. Check its evidence against what you know from
  the request and the repository before adopting it.
- A market it did not detect was not scanned. That is an unknown, not a
  market the site is compliant in - report it that way, and add the market
  with `--jurisdictions` when you have reason to think it applies.
- Markets it lists as "considered, but evidence too thin" are exactly the
  ones to check by hand.
- When it reports the scope inconclusive, do not invent one. Say the scope
  could not be determined automatically and ask, or derive it from the
  repository.
- If the user has already told you the jurisdictions, pass them explicitly.
  Autoscan will report its own inference alongside, which is a useful
  cross-check, but the user's scope is the one that governs.

When a report carries `meta.scopeDetection`, its jurisdictions were inferred.
Say so when you summarize it, rather than presenting an inferred scope as an
established one.

### Step 3 - Inspect the project and its technology

Run `universcan packs` to see available regulatory packs. If scanning a
repository, let UniVerscan's `FrameworkDetector` identify the stack, and
reuse the project's own install/build/start scripts (`npm run dev`,
`npm start`, etc.) rather than inventing new ones.

### Step 4 - Create or select a configuration

Build a `UniVerscanConfig` (see `config/example.universcan.config.json` and
`config/profiles/`) reflecting Step 2's scope. Prefer extending an existing
profile via `"extends"` over writing one from scratch. **Never modify the
built-in regulatory packs or engine to make a failing project pass.**
Project-specific exclusions (`ignoredFindings`, `crawl.excludedRoutes`) must
be added explicitly to the config, with a `reason`, not by editing rule
logic.

`ignoredFindings` is enforced by `src/engine/ExceptionFilter.ts`, and it is
deliberately hard to abuse: an entry with no `reason` is rejected outright,
an entry past its `expires` date stops applying, a suppressed finding is
moved to `report.suppressedFindings` rather than deleted, and a
`not-evaluated` finding can never be suppressed. An agent must not add an
exception on its own initiative - only a human with the authority to accept
that risk can, and the `reason`/`approvedBy` fields must record who did.

### Step 5 - Start the application and verify access

For source mode, only pass `--allow-install`/`--allow-build` (or set
`source.allowInstall`/`source.allowBuild`) when the environment and the user
permit installing dependencies and running a dev server. If the app cannot
be started, UniVerscan runs static analysis only and marks every
browser-dependent rule `not-evaluated` - this is expected and correct
behavior, not a bug to work around.

### Step 6 - Discover routes

Let `SiteDiscovery` find routes via robots.txt-declared sitemaps,
`/sitemap.xml`, or link crawling. Prioritize legally significant journeys:
home, login, registration, checkout, payment, account, cancellation,
subscription management, privacy policy, cookie policy, terms, contact,
newsletter signup.

`crawl.respectRobotsTxt` defaults to true and must stay true unless the user
owns the target or has written permission to scan it in full. Pages excluded
by robots.txt are logged as unscanned; they are never reported as passing.

### Step 7 - Execute applicable regulatory packs

Run `universcan scan --url ... --jurisdictions "..." --packs ...` (or the
programmatic `ScanEngine`). Do not hand-pick which findings to keep before
they are produced - let all applicable rules run.

### Step 8 - Collect evidence

Evidence collection is automatic (screenshots, DOM fragments, request logs,
cookie/storage snapshots, axe-core results, source references). Do not
strip evidence from a report to make it look cleaner; redaction of personal
data/secrets is automatic via `utils/redact.ts` and should not be disabled.

### Step 9 - Separate finding classes

The report already separates findings by `status` (`violation`,
`probable-violation`, `risk`, `missing-disclosure`, `inconsistent`,
`manual-review`, `not-evaluated`, `informational`) and by
`automationLevel`. When summarizing results for a human, preserve these
distinctions - do not collapse them into a single "N issues found" number.

### Step 10 - Produce the report

Use `writeReports()` / the CLI's `--format` flag to emit JSON, HTML,
console, JUnit, SARIF, Markdown, and/or CSV output. The HTML report's
executive dashboard is the right artifact to hand to a non-technical
stakeholder; it deliberately does not present a single compliance
percentage. See "Reporting results to a human" below for which format suits
which audience.

### Step 11 - Remediate in the application, not the scanner

When asked to fix findings, modify the scanned application's code
(add the missing disclosure, un-check the pre-checked box, gate the
tracking script behind consent, fix the accessibility violation). **Never**
weaken a regulatory rule, lower a severity, or add an ignore rule to make a
finding disappear unless a human with the authority to accept that risk has
explicitly said to.

### Step 12 - Re-scan and compare

After remediation, run UniVerscan again and diff against the previous
report:

```bash
node dist/cli.js diff --baseline ./before/report.json --current ./after/report.json
```

Read the diff carefully before reporting success. A finding that
disappeared was fixed, *or* suppressed by a config exception, *or* on a page
the second scan did not reach - establish which. The diff's
`evaluationRegressions` section lists rules that produced a result before
and report `not-evaluated` now: that is lost coverage, and must never be
summarized as a fix.

## Running the CLI as an agent

An agent has no terminal, so the interactive commands are not for you:

- **Never invoke `init` or `explore`.** Both need a person at a keyboard and
  exit with code 2 when stdin is not a TTY. Write the config file directly,
  and read `report.json` rather than browsing it.
- Diagnostics go to **stderr** and report content to **stdout**, so
  `universcan report --input r.json --format markdown` can be captured
  cleanly. Do not parse the console report; parse `report.json`.
- Progress output is on stderr too. Pass `--quiet` when it would clutter a
  captured log.
- **Exit code 2 means the scan could not run** - bad input, a selection that
  loads no packs, or nothing reachable. It is not a pass and not a finding
  count; do not summarise such a run as "no issues found". Check
  `coverage.pagesScanned` and `coverage.pagesUnreachable` before reporting
  any result.
- Colour is off automatically without a TTY. If something in your harness
  sets `FORCE_COLOR`, pass `--no-color` so escape sequences do not end up in
  text you quote back to a human.

## Agent safety rules

Agents using UniVerscan must never:

- Declare legal compliance solely from automated test results.
- Invent legal requirements that are not backed by a regulatory pack's
  `legalReference`.
- Silently disable, delete, or weaken a failing rule to make a scan pass.
- Modify regulatory pack logic (`src/packs/**`) to make a specific project's
  scan pass, rather than fixing the project or filing an explicit,
  documented exception.
- Treat a page that could not be reached, or a rule that could not run, as
  passed. Both must be reported as `not-evaluated` / `manual-review`.
- Present an autoscan-inferred scope as if it were an established one, or
  treat a market autoscan did not detect as a market the site is compliant
  in. An undetected market is an unscanned market.
- Expose credentials. Authentication secrets come only from environment
  variables (`authentication.usernameEnvVar`/`passwordEnvVar`) and are never
  written into config files, findings, or reports.
- Include personal data in reports beyond what is necessary as evidence;
  `utils/redact.ts` redaction must stay enabled.
- Interpret missing evidence, or a rule that could not be evaluated, as
  evidence of compliance.

When legal interpretation is uncertain, classify the finding
`manual-review` rather than guessing at a verdict.

## Reporting results to a human

Pick the format for the audience:

- `html` - the executive dashboard, for a non-technical stakeholder.
- `markdown` - a CI job summary or a PR comment.
- `sarif` - GitHub code scanning; suppressed findings are uploaded with
  their justification so accepted risks stay visible.
- `csv` - spreadsheet triage across a large finding set.
- `junit` - a test-reporter integration.

Whichever you use, keep the finding classes apart. "N issues found"
collapses confirmed violations, items awaiting legal review, and checks that
could not run into one number that means nothing; every reporter in this
repository separates them, and a summary written by an agent must too.

## Extending UniVerscan

The scanning engine (`src/engine/**`) contains no jurisdiction-specific
logic. To add a new regulatory pack:

1. Create `src/packs/<pack-id>/pack.ts` exporting a `RegulatoryPack`
   (see `src/engine/types.ts` and any existing pack for the shape).
2. Define each `Rule` with `defineRule()` from `src/packs/helpers.ts`,
   setting `severity`, `confidence`, `automationLevel`, `legalReference`,
   and `remediation` explicitly - none of these should be guessed at
   runtime.
3. Register the pack in `src/packs/PackLoader.ts`'s `BUILT_IN_PACKS` list,
   or load it dynamically via `config.customRulesPaths` without touching
   the engine at all.
4. Link every rule to an authoritative source (legislation, a regulator's
   own guidance, or a recognized technical standard) in `legalReference`.
5. Set the pack's `effectiveDate` to the date its obligations actually bite,
   not the date the pack was written. A pack for a regulation that applies
   in the future still runs, so a team sees the work before the deadline -
   but a report must never imply an obligation is already in force.
6. If a rule needs a signal no module collects yet, add the collector to
   `src/modules/` and surface it on `PageContext`, rather than reaching into
   the DOM from inside a rule. Rules run after the crawl has finished, so
   the live `Page` no longer sits on the URL the rule is reasoning about.

This plugin architecture is what makes worldwide coverage additive rather
than a rewrite: adding Country N+1 never requires touching the engine or
any other pack.
