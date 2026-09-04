# Changelog

All notable changes to UniVerscan are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

0.5.0 is the first published release. Versions 0.1.0 through 0.4.0 predate
it: they were never tagged or published to any registry, so those entries are
reconstructed from the commit history and recorded for context rather than as
released artifacts.

## [Unreleased]

### Changed

- The landing page has moved to its own repository,
  [universcan-website](https://github.com/jomardyan/universcan-website), so
  this repository is the scanner alone and its dependency tree never resolves
  a web framework.

- The README leads with a quick start and an accurate summary of what the
  scanner ships, rather than an abstract and a table of contents. The
  duplicated container, library and CI sections are merged into one each, and
  the table of contents now lists every section instead of 27 of 40.

### Fixed

- The supported Node floor disagreed with itself: `engines.node` said `>=20`
  while `doctor` still accepted 18, so it reported an environment as healthy
  that npm refuses to install into. Both are 20, and a test pins them
  together.
- The Dockerfile declared `UNIVERSCAN_OUTPUT`, which nothing reads. It
  implied a default output directory the tool does not honour, so a container
  run without `--out` wrote reports inside the container and lost them. The
  variable is gone and the documentation says to pass `--out`.

## [0.5.0] - 2026-09-04

### Added

- Continuous integration for the scanner itself: typecheck, build, the full
  test suite, a smoke check of the built CLI, and a package-tarball check,
  on Node 20 and 22.
- `test/chromium.ts`, which resolves the browser the end-to-end suites need
  from `UNIVERSCAN_CHROMIUM_PATH`, a sandbox path, or Playwright's own
  browser directory. `UNIVERSCAN_REQUIRE_CHROMIUM=1` turns a missing browser
  into a failed suite rather than a silently smaller one.
- Packaging and distribution scaffolding: `action.yml` so the scanner can be
  used as a GitHub Action, a release workflow publishing to npm with
  provenance and to the GitHub container registry, and `prepublishOnly` so a
  published tarball can never carry a stale `dist/`.
- Project documentation: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, this changelog, and a Dependabot configuration.

### Changed

- The compliance-scan workflow now reads its target from a `STAGING_URL`
  repository variable and skips itself when that is unset, instead of
  failing on an empty `--url`.
- Reporting steps in that workflow are skipped when the file they consume
  does not exist, so a scan failure is reported once rather than five times.
- The SARIF upload and JUnit check run are skipped where the token is
  read-only, which is the case on fork and Dependabot pull requests. The
  uploaded report artifact still carries every finding.
- The minimum supported Node version is now 20. Node 18 reached end of life
  in April 2025 and was never exercised by any test run.

### Fixed

- The JUnit check run was missing the `checks: write` permission it requires.
- `--version` no longer reports a hardcoded string that a release bump could
  leave behind. It is read from `package.json`, and `test/version.test.ts`
  pins that, along with the version `action.yml` installs from npm.

## [0.4.0]

### Fixed

- Six classes of false positive found by reading every finding from 16 real
  site scans against the page it was raised about: interstitials and captcha
  walls served with HTTP 200 being scanned as if they were the article,
  trader-identity links not matching bare "About"/"Contact"/"Legal",
  privacy notices labelled "personal data" rather than "privacy",
  measurement session cookies reported as credential exposures, free
  newsletters classified as paid subscriptions, and visually hidden skip
  links reported as focus-indicator violations. 35 findings were withdrawn
  as unfounded on the first pass.
- Autoscan no longer puts the United Kingdom in scope for any site with a
  favicon.
- Around 150 ad-tech domains are now named, with a conservative structural
  tier classifying the rest from tracking markers. These are marked
  `evidence: "inferred"` and reported as `probable-violation`, never as an
  established breach.
- Pre-consent recipient detection is now reproducible: the no-interaction
  visit is repeated and observations unioned, turning a stripe.com result
  that alternated between 43 findings and 0 into a stable 44.

## [0.3.0]

### Added

- An interactive CLI layer: the `init` setup wizard, the `explore` findings
  browser, and live progress output.
- Ten further jurisdictions: China, South Korea, Switzerland, Quebec,
  Thailand, Singapore, South Africa, Saudi Arabia, Nigeria, and ADA Title II.
- Deployment support outside a developer machine: a container image, the
  `doctor` preflight command, configurable browser launch, proxy-consistent
  auxiliary fetches, ESM packaging with a CommonJS diagnostic shim, and CI
  templates for GitLab, Azure Pipelines, Jenkins and CircleCI.

### Changed

- The CLI now fails loudly rather than quietly on bad input.
- Route selection scans the pages that matter rather than whichever ones
  happened to be linked.

### Fixed

- The accessibility and security checks no longer guess; what they cannot
  establish is reported as such.

## [0.2.0]

### Added

- Regulatory packs covering 2025 and 2026 obligations, plus security, AI
  transparency and consumer-rights signal collection.
- CI reporting formats: JUnit, SARIF and Markdown.
- Autoscan mode, which infers the target markets from the site and reports
  the inferred scope with its evidence rather than applying it silently.
- A step-by-step tutorial in the README, running from install to a CI gate.

## [0.1.0]

### Added

- Initial implementation: the Playwright-based scan engine, the rule-pack
  system, cookie, consent, privacy-document, forms, network, accessibility
  and security scanners, and the JSON, HTML, CSV and console reporters.

<!-- 0.1.0 through 0.4.0 were never tagged, so they carry no links. -->

[Unreleased]: https://github.com/jomardyan/Playwright-Law-Suite/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/jomardyan/Playwright-Law-Suite/releases/tag/v0.5.0
