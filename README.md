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
  (axe-core), cookie/consent state comparison, privacy document/disclosure
  scanning, forms/personal-data detection, network/third-party
  intelligence, and source-code mode (framework detection, local app
  startup, static analysis).
- **Regulatory packs** (`src/packs/`): independent, pluggable rule sets, one
  per jurisdiction/regulation. Adding a jurisdiction never requires touching
  the engine - see `AGENTS.md` for the extension steps.
- **Reporters** (`src/reporters/`): JSON, HTML executive dashboard,
  console, and JUnit output.

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

## Included regulatory packs

| Pack | Regulation | Jurisdiction |
| --- | --- | --- |
| `eu-gdpr-eprivacy` | GDPR / ePrivacy Directive | European Union |
| `wcag-accessibility` | WCAG 2.2 | Global |
| `us-ca-ccpa-cpra` | CCPA / CPRA (+ COPPA hook) | United States - California |
| `uk-gdpr-pecr` | UK GDPR / PECR | United Kingdom |
| `au-privacy-dda` | Privacy Act / APPs / DDA | Australia |
| `br-lgpd` | LGPD | Brazil |
| `ca-pipeda` | PIPEDA | Canada |
| `jp-appi` | APPI | Japan |

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
  --format json,html,console \
  --out ./universcan-report
```

Scan using a saved profile (supports `extends` for a shared baseline):

```bash
node dist/cli.js scan --url https://example.com --config config/profiles/eu-ecommerce.json
```

Scan a repository (static analysis only unless install/build is permitted):

```bash
node dist/cli.js scan --repo ../my-app --allow-install --allow-build
```

List built-in regulatory packs:

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

## CI integration

See `.github/workflows/universcan.yml` for a GitHub Actions example: it
fails the build on `critical`/`high` findings while surfacing `manual-review`
items as warnings via the uploaded JSON/HTML/JUnit reports. The same
`ScanEngine` works unmodified from GitLab CI, Azure DevOps, or Jenkins by
invoking `node dist/cli.js scan ...` as a build step.

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

## License

MIT - see [LICENSE](./LICENSE).
