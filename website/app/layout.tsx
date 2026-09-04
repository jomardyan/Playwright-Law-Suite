import type { Metadata } from "next";
import "./globals.css";

const SITE = "https://universcan.lolisoft.eu";

const DESCRIPTION =
  "UniVerscan drives a real browser over a website and reports what it can establish " +
  "about GDPR, cookie consent, WCAG accessibility, privacy, consumer and security " +
  "obligations. 24 regulatory packs, 129 rules, 19 jurisdictions. Open source, MIT.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "UniVerscan - web compliance scanning that shows its evidence",
    template: "%s - UniVerscan",
  },
  description: DESCRIPTION,
  keywords: [
    "web compliance scanner",
    "GDPR scanner",
    "cookie consent audit",
    "WCAG accessibility testing",
    "Playwright",
    "SARIF",
    "ePrivacy",
    "EU AI Act",
    "CCPA",
    "CI compliance gate",
  ],
  authors: [{ name: "jomardyan" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "UniVerscan",
    title: "UniVerscan - web compliance scanning that shows its evidence",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "UniVerscan - web compliance scanning that shows its evidence",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

/** Inlined so the tab icon costs no extra request on a static host. */
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="#8b7cf8"/>
      <path d="M16 6l7 3v6.5c0 4.4-2.9 8.2-7 9.4-4.1-1.2-7-5-7-9.4V9l7-3z"
            fill="none" stroke="#0b0d12" stroke-width="2.1"
            stroke-linejoin="round"/>
      <path d="M12.6 16.1l2.5 2.5 4.5-4.7" fill="none" stroke="#0b0d12"
            stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  );

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href={FAVICON} />
        <meta name="theme-color" content="#0b0d12" />
      </head>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}

const REPO = "https://github.com/jomardyan/Playwright-Law-Suite";
const NPM = "https://www.npmjs.com/package/universcan";

function ShieldMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 3l10 4.2v8.9c0 6.2-4.1 11.6-10 13.2-5.9-1.6-10-7-10-13.2V7.2L16 3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M11.4 16.3l3.4 3.4 6-6.3"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <a className="brand" href="/">
          <ShieldMark />
          UniVerscan
        </a>
        <nav className="nav" aria-label="Main">
          <a className="hide-sm" href="/#how">
            How it works
          </a>
          <a className="hide-sm" href="/#coverage">
            Coverage
          </a>
          <a className="hide-sm" href="/#ci">
            CI
          </a>
          <a href="/docs/">Docs</a>
          <a href={REPO} rel="noopener">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-cols">
          <div>
            <h4>Get it</h4>
            <ul>
              <li>
                <a href={NPM} rel="noopener">
                  npm
                </a>
              </li>
              <li>
                <a
                  href={`${REPO}/pkgs/container/playwright-law-suite`}
                  rel="noopener"
                >
                  Container image
                </a>
              </li>
              <li>
                <a href={REPO} rel="noopener">
                  Source
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Learn</h4>
            <ul>
              <li>
                <a href="/docs/">Getting started</a>
              </li>
              <li>
                <a href={`${REPO}#readme`} rel="noopener">
                  Full README
                </a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/CHANGELOG.md`} rel="noopener">
                  Changelog
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Contribute</h4>
            <ul>
              <li>
                <a href={`${REPO}/blob/main/CONTRIBUTING.md`} rel="noopener">
                  Contributing
                </a>
              </li>
              <li>
                <a href={`${REPO}/issues`} rel="noopener">
                  Issues
                </a>
              </li>
              <li>
                <a href={`${REPO}/blob/main/SECURITY.md`} rel="noopener">
                  Security policy
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Legal</h4>
            <ul>
              <li>
                <a href={`${REPO}/blob/main/LICENSE`} rel="noopener">
                  MIT licence
                </a>
              </li>
              <li>
                <a
                  href={`${REPO}/blob/main/CODE_OF_CONDUCT.md`}
                  rel="noopener"
                >
                  Code of conduct
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p className="disclaimer">
          <strong>UniVerscan reports technical signals about a website. It is
          not legal advice and does not certify compliance with any
          regulation.</strong>{" "}
          Its output is evidence for a human review. Automated checks cannot
          establish whether a claim is factually accurate, whether a lawful
          basis exists, or whether a disclosure is adequate for its audience -
          which is why findings are labelled with how each was established, and
          why a rule that could not run reports <code>not-evaluated</code>{" "}
          rather than a pass.
        </p>
        <p style={{ marginTop: "1.5rem" }}>
          Open source under the MIT licence. Not affiliated with any regulator
          or supervisory authority.
        </p>
      </div>
    </footer>
  );
}
