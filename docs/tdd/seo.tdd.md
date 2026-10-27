# TDD evidence: SEO fixes (Astro site + nginx)

- **Source:** the 2026-10-27 `/ecc:seo` audit of https://ufc.xlobax.com. The user asked to fix every finding with
  `/ecc:tdd-workflow`. Journeys were derived from the audit during this run; there was no plan file.
- **Branch:** `feat/seo` (from `main` at `da0d7b5`).
- **Not in this branch:** http → https. The audit found `http://ufc.xlobax.com/` answering 200; the user turned on
  Cloudflare's zone-wide "Always Use HTTPS" on 2026-10-27, and `http://ufc.xlobax.com/` and `http://ufc-data.xlobax.com/`
  now 301 to https. No `http://…xlobax.com` callers in this repo; `fightcard-engine` and the VPS were not checked.

## User journeys

1. As a visitor or crawler, `/how-it-works` or `/events/<slug>` without the trailing slash takes me to the https page,
   not `http://ufc.xlobax.com:8080/...` (unreachable).
2. As a search engine, every page names one canonical https URL, so `/`, `/index.html` and http copies don't compete.
3. As a searcher, the home page result reads as the site ("UFC fight cards with finish chances · Next: …"), distinct
   from the event page it shows, and each event result says the date, venue, bout count and what the card offers.
4. As someone sharing a link, the preview has a title, description and a large branded image (Open Graph / Twitter).
5. As a search engine, event pages are a schema.org `SportsEvent` naming the fighters; the home page is a `WebSite`;
   the explainer is an `Article`.
6. As a crawler, `robots.txt` points to `sitemap.xml`, which lists every indexable page.
7. As a visitor on a dead link, I get the site's own 404 (noindex) with a way back to the card, not nginx's default.

## Checkpoint commits (on `feat/seo`)

| Commit | Stage | Evidence |
|---|---|---|
| `c5dbc1e` | RED | `npx vitest run tests/unit/seo.test.ts tests/build/build.test.ts`: `seo.test.ts` fails to load (`Cannot find module '../../src/lib/seo'`); build 9 failed / 15 passed (no canonical, home title `UFC 323: Alpha vs. Bravo · UFC fight …`, old description, no OG, no JSON-LD, ENOENT `sitemap.xml` / `robots.txt` / `404.html`). `uv run --project pipeline pytest scripts/tests/test_dockerfile.py -m docker`: 1 failed / 7 passed, `Location` was `http://ufc.example:8080/events/x/`. |
| `49f4ace` | GREEN | Same commands: 40/40 and 8/8. Full: `npm run test:coverage` 156/156 (98.37% lines), `npm run check` 0 errors, `npm run test:e2e` 40/40, `pytest scripts/tests` 190 passed / 2 skipped. |
| `424196a` | Backfill | Two `homeDescription` unit tests, which passed on first run (code already existed), so they are coverage, not RED evidence. 158/158, 99.45% lines. |
| `62d46eb` | RED (share image) | `npx vitest run tests/build/build.test.ts`: 2 failed / 23 passed (`twitter:card` was `summary`; no `og:image`). The existing OG test's expected card type changed from `summary` to `summary_large_image`. |
| `1da8ec6` | GREEN (share image) | Same command 25/25. `npm run test:coverage` 159/159 (99.45% lines), `npm run check` 0 errors, `npm run test:e2e` 40/40. `npm run icons` left the existing icons byte-identical and added `public/og.png`. |

One existing test changed in RED: "ships no JavaScript…" now strips `application/ld+json` blocks before counting
scripts, as it already did for speculation rules; both are JSON the browser reads, not script.

## Test specification

| # | What is guaranteed | Test | Type |
|---|---|---|---|
| 1 | A slashless directory URL redirects 301 with a relative `Location: /events/x/` | `scripts/tests/test_dockerfile.py › test_slashless_directory_redirect_stays_relative` (`-m docker`) | integration |
| 2 | Every page has exactly one canonical, equal to its own https URL | `site/tests/build/build.test.ts › search and sharing › gives every page one self-referencing canonical URL` | build |
| 3 | Home title is `UFC fight cards with finish chances · Next: <headline>` and differs from every event title; "Latest" for a completed event; bare tagline without events | `build.test.ts › gives the home page its own title…`; `tests/unit/seo.test.ts › homeTitle` | build, unit |
| 4 | Event descriptions name date, venue, bout count, finish chances and Elo; 120-160 chars for a 13-bout card; "results for" when completed; singular, no-venue and empty-card variants; unique per event | `seo.test.ts › eventDescription`; `build.test.ts › writes a distinct, 120-160 character description…` | unit, build |
| 5 | Home description names the site and the next card, 120-160 chars | `seo.test.ts › homeDescription` | unit |
| 6 | Every page has og:title/description/url/type/site_name matching its title, description and canonical, plus `twitter:card` `summary_large_image` | `build.test.ts › describes every page for link previews…` | build |
| 6b | Every page names `https://ufc.xlobax.com/og.png` as og:image with width 1200, height 630 and alt text; the PNG is 1200x630 and opaque | `build.test.ts › gives every page a 1200x630 share image` | build |
| 7 | Event pages carry a `SportsEvent` (name, startDate, url, location when known, each fighter once; unknown fighter ids skipped) | `seo.test.ts › eventJsonLd`; `build.test.ts › marks each event page up as a SportsEvent…` | unit, build |
| 8 | Home has `WebSite` JSON-LD; how-it-works has `Article` and `og:type` article | `build.test.ts › marks the home page up as a WebSite and the explainer as an Article` | build |
| 9 | JSON-LD can't be closed early by `</script>` in data | `seo.test.ts › jsonLdScript` | unit |
| 10 | `sitemap.xml` lists exactly home, how-it-works and every event page (no 404); URLs deduped and XML-escaped | `build.test.ts › lists every indexable page in sitemap.xml`; `seo.test.ts › sitemapXml` | build, unit |
| 11 | `robots.txt` allows all and names `https://ufc.xlobax.com/sitemap.xml` | `build.test.ts › points crawlers at the sitemap from robots.txt` | build |
| 12 | `404.html` exists, is `noindex`, has no canonical, has a "not found" h1 and links to `/` | `build.test.ts › builds a 404 page…`; served on unknown paths per `test_unknown_path_serves_site_404_page` | build |

## Coverage and known gaps

- `npm run test:coverage`: 99.45% lines, 99.14% branches, 100% functions over `src/lib/**` (threshold 80%).
- The share image is one site-wide image, not per event. Per-event images would need fonts in the alpine build image.
- Lighthouse 12 (mobile, simulated throttling) on the local production build (`astro preview`, real data), before the
  share image: home, an event page and how-it-works each scored 100/100/100/100 (performance, accessibility, best
  practices, SEO); LCP 0.9 s, CLS 0, TBT 0 ms. Informational only: "LCP request discovery" (headshot without
  `fetchpriority`) and DOM size 1,272 elements on card pages (warning starts at 1,500). No real network or Cloudflare.
- Cloudflare's managed robots.txt may be served in place of ours; check `https://ufc.xlobax.com/robots.txt` after
  deploy and turn off the managed one if it lacks the `Sitemap:` line.
- Rich-result eligibility (Google's Rich Results Test) was not run; it needs the deployed URL.
