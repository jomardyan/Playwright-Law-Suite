import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Getting started",
  description:
    "Install UniVerscan, run a first scan, read a finding, narrow the scope to your " +
    "real obligations, and gate CI on regressions rather than the whole backlog.",
  alternates: { canonical: "/docs/" },
};

const REPO = "https://github.com/jomardyan/Playwright-Law-Suite";

export default function Docs() {
  return (
    <main className="doc">
      <div className="wrap">
        <p className="doc-back">
          <a href="/">← universcan.lolisoft.eu</a>
        </p>
        <h1>Getting started</h1>
        <p className="lede">
          From an empty terminal to a CI gate. Every command here is the real
          CLI; the{" "}
          <a href={`${REPO}#readme`} rel="noopener">
            full README
          </a>{" "}
          goes further into rule packs, the library API and configuration.
        </p>

        <h2>1. Install</h2>
        <p>
          UniVerscan needs Node 20 or newer and a Chromium build for Playwright
          to drive.
        </p>
        <div className="code">
          <div className="code-head">shell</div>
          <pre>
            <code>
              <span className="prompt">$ </span>npm install -g universcan
              {"\n"}
              <span className="prompt">$ </span>npx playwright install
              --with-deps chromium
            </code>
          </pre>
        </div>
        <p>
          Or run it without installing anything:{" "}
          <code>npx universcan scan --url https://shop.example</code>. Prefer a
          container?{" "}
          <code>ghcr.io/jomardyan/playwright-law-suite:latest</code> already
          carries the browser.
        </p>
        <p>
          Then confirm the environment can actually scan. This separates an
          environment fault from a real finding, and is worth running once on
          any new machine:
        </p>
        <div className="code">
          <div className="code-head">shell</div>
          <pre>
            <code>
              <span className="prompt">$ </span>universcan doctor
            </code>
          </pre>
        </div>

        <h2>2. Let it work out the scope</h2>
        <p>
          Choosing jurisdictions is the hardest part of a first scan, and
          getting it wrong is quiet: name too few markets and the packs that
          mattered never run, so the report comes back clean because nothing
          looked.
        </p>
        <div className="code">
          <div className="code-head">shell</div>
          <pre>
            <code>
              <span className="prompt">$ </span>universcan autoscan --url
              https://shop.example
            </code>
          </pre>
        </div>
        <p>
          Autoscan loads the homepage plus the usual legal and pricing paths,
          reads the market signals each exposes, and prints what it concluded{" "}
          <strong>before</strong> it scans anything:
        </p>
        <div className="code">
          <div className="code-head">autoscan · detected scope</div>
          <pre>
            <code>
              <span className="tok-c">Markets selected for scanning:</span>
              {"\n"}
              {"  "}European Union{"  "}
              <span className="tok-f">[high confidence, score 17]</span>
              {"\n"}
              {"      "}- an hreflang alternate for &quot;de-DE&quot;{"\n"}
              {"      "}- euro prices{"\n"}
              {"      "}- an Impressum (German/Austrian disclosure duty){"\n"}
              {"      "}- GDPR named on the page{"\n"}
              {"  "}United Kingdom{"  "}
              <span className="tok-f">[medium confidence, score 5]</span>
              {"\n"}
              {"      "}- an hreflang alternate for &quot;en-GB&quot;
            </code>
          </pre>
        </div>
        <p>
          Add <code>--detect-only</code> to see that block and stop without
          scanning. An inferred scope is never applied silently: a market that
          was not detected was not scanned, and an unscanned market is an
          unknown rather than a clean one.
        </p>

        <h2>3. Or name the scope yourself</h2>
        <p>
          Start narrow, with one pack, so the output stays readable while you
          learn to read it.
        </p>
        <div className="code">
          <div className="code-head">shell</div>
          <pre>
            <code>
              <span className="prompt">$ </span>universcan scan \{"\n"}
              {"  "}--url <span className="tok-s">https://shop.example</span> \
              {"\n"}
              {"  "}--jurisdictions{" "}
              <span className="tok-s">&quot;European Union&quot;</span> \{"\n"}
              {"  "}--sector <span className="tok-s">e-commerce</span> \{"\n"}
              {"  "}--packs{" "}
              <span className="tok-s">eu-consumer-rights</span> \{"\n"}
              {"  "}--format{" "}
              <span className="tok-s">console,json,html</span> \{"\n"}
              {"  "}--out <span className="tok-s">./universcan-report</span>
            </code>
          </pre>
        </div>
        <p>
          <code>universcan packs</code> lists all 24 packs with the dates their
          obligations apply from.
        </p>

        <h2>4. Read a finding</h2>
        <p>
          <strong>Read the coverage block first.</strong>{" "}
          <code>Rules not evaluated</code> is the number that matters most:
          those checks could not run, and they are not passes. A scan with high
          conformity and a high not-evaluated count has told you very little.
        </p>
        <p>Then read the four fields on each finding independently:</p>
        <ul>
          <li>
            <strong>status</strong> - was the rule satisfied, breached, or
            impossible to decide
          </li>
          <li>
            <strong>severity</strong> - how much it matters if it is real
          </li>
          <li>
            <strong>evidence</strong> - <code>observed</code> means the scanner
            saw it; <code>inferred</code> means it was deduced from a signal
            such as a hostname
          </li>
          <li>
            <strong>confidence</strong> - how reliable the check considers its
            own conclusion
          </li>
        </ul>
        <p>
          A <code>manual-review</code> item is not a failure of the tool. Some
          questions - whether a scarcity claim is factually true, whether a
          lawful basis exists - cannot be answered by scanning, and saying so
          is more useful than guessing.
        </p>
        <div className="code">
          <div className="code-head">shell</div>
          <pre>
            <code>
              <span className="prompt">$ </span>universcan explore --input
              ./universcan-report/report.json
            </code>
          </pre>
        </div>
        <p>
          <code>explore</code> pages through findings interactively, filtering
          by status, severity or pack.
        </p>

        <h2>5. Record a risk you cannot fix yet</h2>
        <p>
          Add an entry to <code>ignoredFindings</code> in your config with a
          reason and, ideally, an expiry. The finding is then reported under{" "}
          <code>suppressedFindings</code> carrying that reason - it stops
          blocking the build but does not vanish, so an accepted risk stays
          visible instead of being quietly deleted.
        </p>

        <h2>6. Gate CI on regressions</h2>
        <p>
          Failing a build on an existing backlog trains people to ignore the
          build. Gate on what the change introduced instead:
        </p>
        <div className="code">
          <div className="code-head">shell</div>
          <pre>
            <code>
              <span className="prompt">$ </span>universcan scan \{"\n"}
              {"  "}--url <span className="tok-s">https://staging.example</span>{" "}
              \{"\n"}
              {"  "}--baseline{" "}
              <span className="tok-s">./baseline/report.json</span> \{"\n"}
              {"  "}--fail-on-new \{"\n"}
              {"  "}--fail-on{" "}
              <span className="tok-s">critical,high</span>
            </code>
          </pre>
        </div>
        <p>Branch on the exit code:</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>0</code>
                </td>
                <td className="dim">No findings at the fail-on severities.</td>
              </tr>
              <tr>
                <td>
                  <code>1</code>
                </td>
                <td className="dim">
                  Findings at or above <code>--fail-on</code>. A compliance
                  result.
                </td>
              </tr>
              <tr>
                <td>
                  <code>2</code>
                </td>
                <td className="dim">
                  The scan could not run - bad input, no packs selected,
                  nothing reachable. An infrastructure result, not a clean bill
                  of health.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          On GitHub, the packaged Action does the install, the browser and the
          job summary for you:
        </p>
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
              <span className="tok-f">fail-on</span>:{" "}
              <span className="tok-s">critical,high</span>
            </code>
          </pre>
        </div>

        <h2>Where to go next</h2>
        <ul>
          <li>
            <a href={`${REPO}#writing-your-own-rule-pack`} rel="noopener">
              Writing your own rule pack
            </a>{" "}
            - add obligations the built-in packs do not cover
          </li>
          <li>
            <a href={`${REPO}#using-the-framework-as-a-library`} rel="noopener">
              Using it as a library
            </a>{" "}
            - findings are plain data you can route however you like
          </li>
          <li>
            <a href={`${REPO}#configuration-reference`} rel="noopener">
              Configuration reference
            </a>{" "}
            - every key, and what it defaults to
          </li>
          <li>
            <a href={`${REPO}#crawl-scope-and-robotstxt`} rel="noopener">
              Crawl scope and robots.txt
            </a>{" "}
            - what it will and will not fetch
          </li>
        </ul>

        <div className="callout">
          <strong>A reminder worth repeating.</strong> UniVerscan reports
          technical signals. It is not legal advice and does not certify
          compliance. Its job is to automate what can be tested objectively,
          collect evidence for what can only be partly automated, and clearly
          flag what needs a lawyer, an accessibility specialist or a data
          protection professional.
        </div>
      </div>
    </main>
  );
}
