# Example: scanning a live website

This walks through scanning a live EU-facing e-commerce site end to end.

## 1. Install and build

```bash
npm install
npm run build
npx playwright install --with-deps chromium
```

## 2. Pick or write a configuration

Use the bundled EU e-commerce profile directly, or copy it and adjust
`crawl.includedRoutes` / `businessSector` for your site:

```bash
cat config/profiles/eu-ecommerce.json
```

## 3. Run the scan

```bash
node dist/cli.js scan \
  --url https://example.com \
  --config config/profiles/eu-ecommerce.json \
  --format json,html,console \
  --out ./universcan-report
```

## 4. Read the results

- `universcan-report/report.html` - executive dashboard: risk indicators,
  findings by severity, and the third-party service inventory. Open it in
  a browser; it has no external dependencies.
- `universcan-report/report.json` - the full machine-readable report,
  suitable for feeding into another tool or a ticketing system.
- The console output printed the same summary during the run.

## 5. Interpret findings responsibly

Every finding has a `status`. Treat them differently:

- `violation` / `probable-violation` - fix these; they were confirmed or
  strongly indicated by an automated, reproducible check.
- `missing-disclosure` / `inconsistent` / `risk` - review and typically fix,
  but confirm context first (the check flagged a real technical signal).
- `manual-review` - a human (legal, privacy, or accessibility professional)
  needs to look at this; automation could not resolve it either way.
- `not-evaluated` - the check could not run at all (e.g. a page failed to
  load, or a rule required a running server that wasn't available). This is
  **not** a pass.

Do not summarize a scan as "compliant" because there were zero `violation`
findings - check `manualReviewItems` and `rulesNotEvaluated` in the coverage
summary first.

## 6. Wire it into CI

See `.github/workflows/universcan.yml` for a working GitHub Actions example
that fails the build on `critical`/`high` findings.
