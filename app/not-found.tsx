export default function NotFound() {
  return (
    <main className="doc">
      <div className="wrap" style={{ paddingTop: "3rem" }}>
        <p className="eyebrow">404</p>
        <h1>That page is not here.</h1>
        <p className="lede">
          Which, in the spirit of the tool, is reported rather than guessed at.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href="/">
            Back to the start
          </a>
          <a className="btn" href="/docs/">
            Getting started
          </a>
          <a
            className="btn"
            href="https://github.com/jomardyan/Playwright-Law-Suite"
            rel="noopener"
          >
            GitHub
          </a>
        </div>
      </div>
    </main>
  );
}
