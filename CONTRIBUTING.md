# Contributing to UniVerscan

Thanks for considering a contribution. This document covers what you need to
run the project locally and what a change has to satisfy before it can be
merged.

## Getting set up

```bash
git clone https://github.com/jomardyan/Playwright-Law-Suite.git
cd Playwright-Law-Suite
npm install
npx playwright install --with-deps chromium
npm run build
node dist/cli.js doctor
```

`doctor` is the fastest way to tell an environment problem from a real
finding. Run it first whenever something behaves unexpectedly.

Node 20 or newer is required. Both 20 and 22 are exercised in CI.

## The checks a change has to pass

```bash
npm run typecheck   # tsc over src/ and test/
npm run build       # tsc to dist/
npm test            # vitest, 378 tests
```

Or all three at once with `make check`.

CI runs the same three on Node 20 and 22, then smoke-checks the built CLI
and the package tarball. Run them locally before opening a pull request:
one validated push is worth more than three speculative ones.

### The end-to-end suites need a browser

Six suites (`test/e2e.*.test.ts`) launch a real Chromium against a local
fixture server. `test/chromium.ts` finds it in one of three places, in
order: `UNIVERSCAN_CHROMIUM_PATH`, `/opt/pw-browsers/chromium`, or
Playwright's own browser directory.

Without a browser those suites **skip themselves**, and the suite still
reports success on the remainder. That is deliberate for local work, but it
means a green run is not automatically a complete one. To make a missing
browser a hard failure instead, which is what CI does:

```bash
UNIVERSCAN_REQUIRE_CHROMIUM=1 npm test
```

Use that before pushing anything that touches scanning behaviour.

## Writing a rule

A rule states a finding with four independent fields, and the distinction
between them is the whole point of the project:

- **status** - `violation`, `probable-violation`, `manual-review`,
  `compliant`, or `not-evaluated`
- **severity** - how much it matters if it is real
- **evidence** - `observed` or `inferred`
- **confidence** - how sure the check is

The rule that governs everything else: **never report as established what
was only inferred.** If a check cannot distinguish a breach from a lawful
arrangement it did not observe, it reports `probable-violation` or
`manual-review` and says what it saw. A cookie's name is not proof of what
it carries. A missing link is not proof a notice does not exist.

False positives are the failure mode that discredits a compliance scanner,
so a change that adds a finding is expected to come with a test that pins
down the case it must *not* fire on.

Rule packs live in `src/packs/<jurisdiction>/pack.ts`. `src/packs/helpers.ts`
and `src/packs/commonRules.ts` carry the shared building blocks. Custom packs
can be loaded from outside the repository via `customRulesPaths`; see the
README for that.

## Pull requests

- Keep a change focused on one thing.
- Explain **why** in the commit message, not just what. If a finding was
  wrong, say which site exposed it and how you checked.
- Add or update tests in the same commit as the behaviour change.
- Update the README when you change a flag, a config key, or an exit code.
- Add a `CHANGELOG.md` entry under `## Unreleased`.

## Reporting a bug

A scanner bug report is much more useful with the target attached. Please
include the URL or a minimal HTML fixture that reproduces it, the finding
you got, the finding you expected, and the output of
`node dist/cli.js doctor`. Redact anything confidential first: reports can
contain cookie names and request URLs from the site you scanned.

For anything security-sensitive, follow [SECURITY.md](SECURITY.md) instead
of opening a public issue.
