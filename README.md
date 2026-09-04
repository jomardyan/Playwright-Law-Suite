# universcan.lolisoft.eu

The landing page for [UniVerscan](https://github.com/jomardyan/Playwright-Law-Suite),
a web compliance scanner. Built with Next.js and exported to static files, so
it runs on basic shared hosting with no Node runtime and no PHP.

The scanner itself lives in a separate repository. This one contains only the
website.

## Develop

```bash
npm install
npm run dev          # http://localhost:3000
```

## Build

```bash
npm run build        # writes out/
```

`out/` is the entire website, around 1 MB. See [DEPLOY.md](DEPLOY.md) for
uploading it to OVH and what `.htaccess` is doing.

## Layout

| Path | What it is |
| --- | --- |
| `app/page.tsx` | The landing page, one component per section |
| `app/docs/page.tsx` | Getting-started guide |
| `app/not-found.tsx` | 404 page |
| `app/layout.tsx` | Header, footer, SEO metadata, structured data |
| `app/globals.css` | All styling. Design tokens are the custom properties at the top |
| `app/CopyButton.tsx` | The only client component on the site |
| `public/` | Copied verbatim to the site root, including `.htaccess` |

## Keeping the figures honest

The landing page states counts - 24 regulatory packs, 129 rules, 19
jurisdictions - and lists every jurisdiction by name. These are not decorative:
they were read from the scanner itself.

```bash
npx universcan packs                       # pack count, rule count
npx universcan packs --plain | cut -f3     # jurisdictions
```

If the scanner's pack set changes, update `app/page.tsx` to match. A landing
page for a tool whose whole argument is "we do not overclaim" cannot afford
inflated numbers.

## Licence

MIT, same as the scanner. See [LICENSE](LICENSE).
