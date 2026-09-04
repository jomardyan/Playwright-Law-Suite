import CopyButton from "./CopyButton";

const REPO = "https://github.com/jomardyan/Playwright-Law-Suite";
const NPM = "https://www.npmjs.com/package/universcan";

/** Exactly the values `universcan packs` reports, so the page cannot drift. */
const JURISDICTIONS = [
  "European Union",
  "United Kingdom",
  "United States - California",
  "United States - multi-state",
  "United States - public entities",
  "Canada",
  "Canada - Quebec",
  "Brazil",
  "Switzerland",
  "China",
  "South Korea",
  "Japan",
  "Singapore",
  "Thailand",
  "India",
  "Australia",
  "South Africa",
  "Nigeria",
  "Saudi Arabia",
];

const INSTALL = [
  "npm install -g universcan",
  "npx playwright install --with-deps chromium",
  "universcan autoscan --url https://shop.example",
].join("\n");

const DOCKER = [
  "docker run --rm \\",
  '  -v "$PWD/reports:/reports" \\',
  "  ghcr.io/jomardyan/playwright-law-suite:latest \\",
  "  scan --url https://shop.example --out /reports",
].join("\n");

export default function Home() {
  return (
    <main>
      <Hero />
      <Honesty />
      <How />
      <Coverage />
      <Output />
      <Ci />
      <Faq />
      <Closing />
    </main>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="wrap">
        <p className="pill">
          <b>MIT</b> · open source · <b>Node 20+</b>
        </p>
        <h1>Web compliance scanning that shows its evidence.</h1>
        <p className="lede">
          UniVerscan drives a real browser over your site and reports what it
          can actually establish about your GDPR, cookie-consent,
          accessibility, consumer and security obligations - and is explicit
          about everything it cannot.
        </p>

        <div className="code">
          <div className="code-head">
            <span>install</span>
            <CopyButton text={INSTALL} />
          </div>
          <pre>
            <code>
              <span className="prompt">$ </span>npm install -g universcan
              {"\n"}
              <span className="prompt">$ </span>npx playwright install
              --with-deps chromium{"\n"}
              {"\n"}
              <span className="prompt">$ </span>universcan autoscan --url
              https://shop.example
            </code>
          </pre>
        </div>

        <div className="cta-row">
          <a className="btn btn-primary" href="/docs/">
            Get started
          </a>
          <a className="btn" href={REPO} rel="noopener">
            View on GitHub
          </a>
          <a className="btn" href={NPM} rel="noopener">
            npm package
          </a>
        </div>
      </div>
    </section>
  );
}

function Honesty() {
  return (
    <section id="why">
      <div className="wrap">
        <p className="eyebrow">Why it is different</p>
        <h2>A scanner that never confuses a breach with a blind spot.</h2>
        <p className="lede">
          The failure mode that discredits compliance tooling is the confident
          false positive. Every UniVerscan finding therefore carries four
          independent fields, so you can tell a proven problem from an
          educated guess before you act on it.
        </p>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Values</th>
                <th>What it tells you</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>status</code>
                </td>
                <td className="dim">
                  <span className="tok-crit">violation</span>,{" "}
                  <span className="tok-high">probable-violation</span>,{" "}
                  <span className="tok-rev">manual-review</span>,{" "}
                  <span className="tok-f">compliant</span>,{" "}
                  <code>not-evaluated</code>
                </td>
                <td className="dim">
                  Whether the rule was satisfied, breached, or could not be
                  decided at all.
                </td>
              </tr>
              <tr>
                <td>
                  <code>severity</code>
                </td>
                <td className="dim">
                  critical, high, medium, low, informational
                </td>
                <td className="dim">
                  How much it matters if the finding is real.
                </td>
              </tr>
              <tr>
                <td>
                  <code>evidence</code>
                </td>
                <td className="dim">
                  <b>observed</b> or <b>inferred</b>
                </td>
                <td className="dim">
                  Whether the scanner saw it happen, or deduced it from a
                  signal such as a hostname or a cookie name.
                </td>
              </tr>
              <tr>
                <td>
                  <code>confidence</code>
                </td>
                <td className="dim">high, medium, low</td>
                <td className="dim">
                  How reliable the check considers its own conclusion.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="callout">
          <strong>A rule that could not run reports `not-evaluated`, never a
          silent pass.</strong>{" "}
          Read the coverage block before the findings: a scan with high
          conformity and a high not-evaluated count has told you very little.
          An unscanned obligation is an unknown, not a clean one.
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how">
      <div className="wrap">
        <p className="eyebrow">How it works</p>
        <h2>Three ways in, one evidence model out.</h2>

        <div className="grid grid-3">
          <div className="card card-accent">
            <h3>Autoscan</h3>
            <p>
              Do not know which markets apply? Autoscan reads the signals the
              site exposes - hreflang, currency, an Impressum, a named
              regulation - and proposes a scope with a confidence score and
              the evidence behind each market.
            </p>
            <p>
              It never applies an inferred scope silently. Add{" "}
              <code>--detect-only</code> to see the verdict and stop.
            </p>
          </div>
          <div className="card">
            <h3>Scan a live site</h3>
            <p>
              Name the jurisdictions yourself and UniVerscan crawls the routes
              that matter, honouring <code>robots.txt</code> by default,
              collecting cookies, trackers, consent behaviour, privacy
              documents, forms, headers and accessibility findings.
            </p>
          </div>
          <div className="card">
            <h3>Scan the source</h3>
            <p>
              Point it at a repository instead of a URL and it analyses the
              application statically, optionally building and starting the app
              to scan what it actually serves.
            </p>
          </div>
        </div>

        <div className="grid grid-4">
          <div className="card">
            <h3>Reproducible</h3>
            <p>
              The no-interaction visit is repeated and observations unioned, so
              a tracker seen intermittently is reported once rather than
              flapping between scans.
            </p>
          </div>
          <div className="card">
            <h3>Evidence stored</h3>
            <p>
              Every finding cites the page it came from, with cookie names,
              request URLs and headers retained as proof - and a redaction
              layer keeping credentials out of the report.
            </p>
          </div>
          <div className="card">
            <h3>Accepted risks</h3>
            <p>
              Record a documented exception and the finding is reported as
              suppressed with its reason, rather than disappearing from the
              output.
            </p>
          </div>
          <div className="card">
            <h3>Regression diffs</h3>
            <p>
              Compare against a baseline report and gate only on what your
              change introduced, instead of on the whole backlog.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Coverage() {
  return (
    <section id="coverage">
      <div className="wrap">
        <p className="eyebrow">Coverage</p>
        <h2>Regulatory packs that load only when they apply.</h2>
        <p className="lede">
          Naming a market loads its pack. Nothing else runs, so the report
          stays about your obligations rather than everyone&apos;s.
        </p>

        <div className="stats">
          <div className="stat">
            <b>24</b>
            <span>regulatory packs</span>
          </div>
          <div className="stat">
            <b>129</b>
            <span>rules</span>
          </div>
          <div className="stat">
            <b>19</b>
            <span>jurisdictions</span>
          </div>
          <div className="stat">
            <b>7</b>
            <span>report formats</span>
          </div>
        </div>

        <div className="grid grid-3">
          <div className="card">
            <h3>Privacy and data protection</h3>
            <p>
              GDPR and the ePrivacy Directive, UK GDPR and PECR, CCPA/CPRA and
              the multi-state universal opt-out, LGPD, PIPEDA, Quebec Law 25,
              the Swiss FADP, PIPL, PIPA, APPI, PDPA, DPDP, POPIA, NDPA and the
              Saudi PDPL.
            </p>
          </div>
          <div className="card">
            <h3>Accessibility</h3>
            <p>
              WCAG 2.0 through 2.2 at A, AA and AAA via axe-core, plus the
              European Accessibility Act and ADA Title II for public entities.
            </p>
          </div>
          <div className="card">
            <h3>Consumer, AI and security</h3>
            <p>
              The Consumer Rights Directive and UCPD/DSA manipulative-design
              signals, EU AI Act transparency duties, and a
              jurisdiction-agnostic data-security baseline.
            </p>
          </div>
        </div>

        <div className="chips" aria-label="Supported jurisdictions">
          {JURISDICTIONS.map((j) => (
            <span className="chip" key={j}>
              {j}
            </span>
          ))}
          <span className="chip chip-global">+ global baseline</span>
        </div>
      </div>
    </section>
  );
}

function Output() {
  return (
    <section id="output">
      <div className="wrap">
        <p className="eyebrow">Output</p>
        <h2>Readable in a terminal, consumable by your pipeline.</h2>

        <div className="code">
          <div className="code-head">universcan scan · console output</div>
          <pre>
            <code>
              <span className="tok-c">Coverage</span>
              {"\n"}
              {"  "}Pages scanned: 2{"\n"}
              {"  "}Rules evaluated: 6{"\n"}
              {"  "}Rules skipped (not applicable): 0{"\n"}
              {"  "}Rules not evaluated: 0{"\n"}
              {"  "}Manual review items: 1{"\n"}
              {"\n"}
              <span className="tok-high">HIGH (3)</span>
              {"\n"}
              {"  "}[eu-consumer-rights/crd-order-button-payment-obligation]{" "}
              <span className="tok-high">probable-violation</span>:{"\n"}
              {"  "}The order control is labelled &quot;Complete your
              order&quot;, which does not{"\n"}
              {"  "}state that placing the order carries an obligation to pay.
              {"\n"}
              {"    "}
              <span className="tok-c">at: https://shop.example/</span>
              {"\n"}
              {"\n"}
              <span className="tok-med">MEDIUM (2)</span>
              {"\n"}
              {"  "}[eu-consumer-rights/ucpd-dsa-manipulative-design-signals]{" "}
              <span className="tok-rev">manual-review</span>:{"\n"}
              {"  "}Urgency or scarcity claims were found: Only 2 left. Whether
              each{"\n"}
              {"  "}claim is factually accurate cannot be determined by
              scanning.{"\n"}
              {"    "}
              <span className="tok-c">at: https://shop.example/</span>
            </code>
          </pre>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <h3>Seven formats</h3>
            <p>
              <code>console</code> for a human, <code>html</code> for a
              stakeholder, <code>json</code> for a script,{" "}
              <code>sarif</code> for GitHub code scanning,{" "}
              <code>junit</code> for a test reporter, <code>markdown</code>{" "}
              for a job summary and <code>csv</code> for triage.
            </p>
          </div>
          <div className="card">
            <h3>Exit codes a pipeline can branch on</h3>
            <p>
              <code>0</code> no findings at your gate.{" "}
              <code>1</code> findings reached <code>--fail-on</code> - a
              compliance result. <code>2</code> the scan could not run - an
              infrastructure result, and pointedly not a clean bill of health.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Ci() {
  return (
    <section id="ci">
      <div className="wrap">
        <p className="eyebrow">Continuous integration</p>
        <h2>Gate the build, or just watch the trend.</h2>

        <div className="grid grid-2">
          <div>
            <h3 style={{ marginTop: "1.5rem" }}>GitHub Action</h3>
            <div className="code">
              <div className="code-head">.github/workflows/compliance.yml</div>
              <pre>
                <code>
                  <span className="tok-f">- uses</span>:
                  jomardyan/Playwright-Law-Suite@v0.5.0{"\n"}
                  {"  "}
                  <span className="tok-f">with</span>:{"\n"}
                  {"    "}
                  <span className="tok-f">url</span>:{" "}
                  <span className="tok-s">https://staging.shop.example</span>
                  {"\n"}
                  {"    "}
                  <span className="tok-f">jurisdictions</span>:{" "}
                  <span className="tok-s">
                    &quot;European Union,United Kingdom&quot;
                  </span>
                  {"\n"}
                  {"    "}
                  <span className="tok-f">fail-on</span>:{" "}
                  <span className="tok-s">critical,high</span>
                </code>
              </pre>
            </div>
            <p style={{ color: "var(--text-dim)", fontSize: "0.94rem" }}>
              Outputs a <code>sarif</code> path you can hand straight to{" "}
              <code>upload-sarif</code>, so findings land as alerts on your
              Security tab.
            </p>
          </div>

          <div>
            <h3 style={{ marginTop: "1.5rem" }}>Container</h3>
            <div className="code">
              <div className="code-head">
                <span>any pipeline with docker</span>
                <CopyButton text={DOCKER} />
              </div>
              <pre>
                <code>
                  <span className="prompt">$ </span>docker run --rm \{"\n"}
                  {"  "}-v &quot;$PWD/reports:/reports&quot; \{"\n"}
                  {"  "}ghcr.io/jomardyan/playwright-law-suite:latest \{"\n"}
                  {"  "}scan --url{" "}
                  <span className="tok-s">https://shop.example</span> \{"\n"}
                  {"  "}--out /reports
                </code>
              </pre>
            </div>
            <p style={{ color: "var(--text-dim)", fontSize: "0.94rem" }}>
              Chromium and its system libraries are already in the image, which
              is the awkward part under GitLab CI, Azure Pipelines and Jenkins.
              Worked configurations for all four ship in the repository.
            </p>
          </div>
        </div>

        <div className="callout">
          <strong>Gate on regressions, not on the backlog.</strong> Pass a
          previous <code>report.json</code> as <code>--baseline</code> with{" "}
          <code>--fail-on-new</code>, and only findings your change introduced
          fail the build. Everything else still appears in every report.
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section id="start">
      <div className="wrap">
        <p className="eyebrow">Get started</p>
        <h2>One command to a first report.</h2>
        <p className="lede">
          Run <code>universcan doctor</code> first and it tells you whether the
          environment can scan at all - Node, browser, sandbox, proxy, TLS
          trust, write permissions - so an environment fault is never mistaken
          for a finding.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href="/docs/">
            Read the getting-started guide
          </a>
          <a className="btn" href={`${REPO}#readme`} rel="noopener">
            Full documentation
          </a>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq">
      <div className="wrap">
        <p className="eyebrow">Questions</p>
        <h2>The obvious objections.</h2>

        <div className="faq">
          <details>
            <summary>Does passing a scan mean we are compliant?</summary>
            <div className="answer">
              <p>
                No, and the tool is built to never imply it. Compliance depends
                on facts a scanner cannot see - whether a lawful basis exists,
                whether a disclosure is adequate for its audience, whether a
                scarcity claim is true. UniVerscan automates what can be tested
                objectively, collects evidence where it can only partly be
                automated, and flags the rest for a person.
              </p>
              <p>
                This is why there is no score and no certificate in the output.
              </p>
            </div>
          </details>

          <details>
            <summary>How does it avoid the usual false positives?</summary>
            <div className="answer">
              <p>
                By separating what it saw from what it deduced, and by being
                willing to say it does not know. A cookie called{" "}
                <code>analytics_session_id</code> is reported as a probable
                issue needing review, not a credential leak, because the name
                is the only evidence. A tracker matched from a hostname pattern
                is marked <code>inferred</code>.
              </p>
              <p>
                Accuracy work is driven by scanning real sites and reading every
                finding against the page that produced it. One such pass across
                16 public sites withdrew 35 findings as unfounded.
              </p>
            </div>
          </details>

          <details>
            <summary>Will it fail our build on day one?</summary>
            <div className="answer">
              <p>
                Only if you ask it to. Run without <code>--fail-on</code>{" "}
                matching anything and it reports without gating. The usual
                adoption path is to record the current state as a baseline and
                gate with <code>--fail-on-new</code>, so the build fails on
                what a change introduced rather than on a backlog nobody has
                triaged yet.
              </p>
            </div>
          </details>

          <details>
            <summary>Is it going to hammer our site, or someone else&apos;s?</summary>
            <div className="answer">
              <p>
                It honours <code>robots.txt</code> by default, following the
                group addressed to <code>universcan</code> and falling back to{" "}
                <code>*</code>, with standard longest-match precedence. Crawl
                scope, page limits and navigation timeouts are all configurable.
              </p>
              <p>
                Obtaining authorisation to scan a target is the operator&apos;s
                responsibility, and that default exists for a reason.
              </p>
            </div>
          </details>

          <details>
            <summary>What does it do with the evidence it collects?</summary>
            <div className="answer">
              <p>
                Writes it into the report you asked for, and nothing else. There
                is no telemetry, no account and no service behind it - it is a
                CLI that runs a browser on your machine or your runner.
              </p>
              <p>
                Reports do embed cookie names, request URLs and headers as
                proof, so treat them as you would any artefact from production.
                A redaction layer exists to keep credentials out of them.
              </p>
            </div>
          </details>

          <details>
            <summary>Why Playwright rather than a headless HTTP client?</summary>
            <div className="answer">
              <p>
                Because most of what matters only happens in a real browser.
                Consent banners are JavaScript, trackers fire after load,
                third-party requests depend on what the page decides to do, and
                focus indicators require actually pressing Tab. An HTTP client
                sees the markup and misses the behaviour.
              </p>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
