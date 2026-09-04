# Deploying to universcan.lolisoft.eu

The site is a **fully static export**. There is no Node runtime and no PHP on
the server: the build produces plain HTML, CSS and JS, which is why it runs on
basic OVH shared hosting.

## Build

```bash
cd website
npm install
npm run build
```

Output lands in `website/out/` (about 1 MB). That directory *is* the website.

## Upload

Copy the **contents** of `out/` into the document root for the subdomain, not
the `out` folder itself:

```
out/index.html        ->  /index.html
out/docs/index.html   ->  /docs/index.html
out/_next/...         ->  /_next/...
out/.htaccess         ->  /.htaccess
out/robots.txt        ->  /robots.txt
out/sitemap.xml       ->  /sitemap.xml
out/404.html          ->  /404.html
```

On OVH that document root is usually `~/www/` for the primary domain, or a
directory you point the subdomain at in the control panel (commonly
`~/universcan/`).

With `lftp`, which mirrors and deletes removed files in one pass:

```bash
lftp -u YOUR_FTP_USER ftp.cluster0XX.hosting.ovh.net -e \
  "mirror -R --delete --verbose website/out/ /universcan/; quit"
```

**Make sure hidden files are included.** Many FTP clients skip dotfiles by
default, which silently drops `.htaccess` and with it the HTTPS redirect,
caching and security headers. In FileZilla: Server → Force showing hidden
files.

## Subdomain setup, once

1. OVH control panel → your domain → **Multisite** → *Add a domain or
   subdomain*.
2. Subdomain `universcan`, root directory the folder you uploaded to.
3. Tick **SSL** so a Let's Encrypt certificate is issued.
4. Wait for the certificate before relying on the HTTPS redirect in
   `.htaccess`. Until it exists, that redirect sends visitors into a
   certificate warning - comment the `RewriteCond`/`RewriteRule` HTTPS block
   out for the first deploy if you want to check the upload early.

## What `.htaccess` does

- Redirects HTTP to HTTPS using `X-Forwarded-Proto`, because OVH terminates
  TLS upstream and `mod_rewrite` would otherwise never see a secure request.
- Adds a trailing slash to directory requests, so `/docs` resolves to
  `/docs/index.html`. The export uses `trailingSlash: true` to match.
- Caches `/_next/static` for a year (filenames are content-hashed, so this is
  safe) and HTML not at all, so a redeploy is visible immediately.
- Sets a strict Content-Security-Policy. The page loads no third-party
  scripts, fonts or analytics, so nothing needs relaxing. `'unsafe-inline'`
  appears only on `style-src`, because Next inlines critical CSS.

## If you move it off the subdomain root

Serving from a path such as `lolisoft.eu/universcan` requires
`basePath: '/universcan'` and `assetPrefix: '/universcan'` in
`next.config.mjs`, then a rebuild. Without them every CSS and JS request
resolves to the wrong place and the page loads unstyled.

## Editing content

- `app/page.tsx` - the landing page, section by section
- `app/docs/page.tsx` - the getting-started guide
- `app/layout.tsx` - header, footer, SEO metadata, favicon
- `app/globals.css` - all styling, via CSS custom properties at the top

Figures on the landing page (24 packs, 129 rules, 19 jurisdictions) were read
from `universcan packs`. If the pack set changes, update them - and the
jurisdiction list in `app/page.tsx`, which mirrors what that command prints.
