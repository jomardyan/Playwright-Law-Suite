# Security Policy

## Supported versions

UniVerscan is pre-1.0. Fixes land on the latest minor release; there are no
long-term support branches yet.

| Version | Supported |
| ------- | --------- |
| 0.4.x   | Yes       |
| < 0.4   | No        |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it through GitHub's private vulnerability reporting on this
repository: **Security** > **Report a vulnerability**. That opens a private
advisory visible only to the maintainers.

Please include the affected version, what an attacker can achieve, and the
steps or a minimal fixture that reproduces it. You should get an
acknowledgement within a few days. If a fix is warranted, it will be
released with an advisory crediting you unless you would rather not be
named.

## What is in scope

UniVerscan drives a browser against sites you point it at and writes reports
about them, so the interesting boundaries are:

- **Report contents.** Reports embed evidence taken from the scanned site,
  including cookie names and values, request URLs, and response headers.
  A redaction layer (`src/utils/redact.ts`) exists specifically to keep
  credentials out of that output. A case where it fails to redact something
  sensitive is a valid report.
- **Config and pack loading.** A custom rule pack is JavaScript that
  UniVerscan imports and executes. Loading a pack is therefore equivalent to
  running its code, and that is by design. What *is* a valid report is a path
  that loads or executes code the operator did not point at, for example
  through a crafted config file, a report file being re-rendered, or a
  baseline file being diffed.
- **Scan input handling.** A malicious or hostile *target site* should not be
  able to escape the browser context, write outside the output directory, or
  influence UniVerscan's exit code beyond the findings it legitimately
  produces.
- **The published artifacts.** The npm package, the container image, and the
  GitHub Action.

## What is not in scope

- **Findings you disagree with.** A missed violation or a false positive is
  a correctness bug, not a vulnerability. Please open a normal issue, which
  is genuinely welcome: accuracy is the whole point of the tool.
- **Scanning a site you are not authorised to scan.** UniVerscan honours
  `robots.txt` by default and that default exists for a reason. Obtaining
  authorisation for a target is the operator's responsibility.
- **Vulnerabilities in Chromium or Playwright.** Report those upstream. If a
  pinned version leaves users exposed, an issue asking for the bump is
  welcome.
- **A `--no-sandbox` warning when running as root.** This is reported by
  `doctor` on purpose. Run as a non-root user to keep the sandbox on; the
  container image already does.

## A note on what this tool is

UniVerscan reports technical signals about a website. It is not legal advice
and does not certify compliance with any regulation. Its output is evidence
for a human review, and the reports label how each finding was established
precisely so that distinction survives into whatever you do with them.
