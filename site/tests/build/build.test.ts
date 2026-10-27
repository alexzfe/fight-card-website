// Builds the site against fixture data and inspects dist/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const SITE = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(SITE, 'dist');
const BUDGET_BYTES = 50 * 1024;

const read = (rel: string) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });

beforeAll(() => {
  execFileSync('npx', ['astro', 'build'], {
    cwd: SITE,
    env: { ...process.env, DATA_DIR: 'tests/fixtures/data' },
    stdio: 'pipe',
  });
}, 180_000);

describe('fixture build', () => {
  it('renders the home page and every event page', () => {
    expect(fs.existsSync(path.join(DIST, 'index.html'))).toBe(true);
    for (const slug of [
      'ufc-323-alpha-vs-bravo',
      'ufc-fight-night-india-vs-juliet',
      'ufc-fight-night-kilo-vs-lima',
      'ufc-fight-night-golf-vs-hotel',
    ]) {
      expect(fs.existsSync(path.join(DIST, 'events', slug, 'index.html')), slug).toBe(true);
    }
  });

  it('serves a plain-text health check', () => {
    expect(read('healthz').trim()).toBe('ok');
  });

  it('ships no JavaScript beyond the event rail\'s inline scroll keeper and the rankings search', () => {
    expect(walk(DIST).filter((f) => /\.m?js$/.test(f))).toEqual([]);
    for (const f of walk(DIST).filter((p) => p.endsWith('.html'))) {
      const isRankings = f === path.join(DIST, 'rankings', 'index.html');
      // speculation rules and JSON-LD are JSON the browser reads natively, and so is the rankings data, but only on
      // the rankings page; no script runs
      const json = isRankings ? 'speculationrules|application\\/ld\\+json|application\\/json' : 'speculationrules|application\\/ld\\+json';
      const html = fs.readFileSync(f, 'utf8').replace(new RegExp(`<script type="(?:${json})"[^>]*>[^<]*<\\/script>`, 'g'), '');
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
      expect(scripts.length, f).toBeLessThanOrEqual(isRankings ? 2 : 1);
      for (const [tag, body] of scripts) {
        expect(tag, f).not.toMatch(/\ssrc=/i);
        const isSearch = body!.includes('rank-results');
        expect(isSearch ? isRankings : true, f).toBe(true);
        expect(body, f).toMatch(isSearch ? /rank-results/ : /event-rail-scroll/);
        expect(body!.length, f).toBeLessThan(isSearch ? 2048 : 1500);
      }
    }
  });

  it('keeps the rankings data, markup and search script off every other page', () => {
    const others = walk(DIST).filter((p) => p.endsWith('.html') && p !== path.join(DIST, 'rankings', 'index.html'));
    expect(others.length).toBeGreaterThan(3);
    for (const f of others) {
      const html = fs.readFileSync(f, 'utf8');
      for (const marker of ['rank-data', 'p4p-row', 'rank-search', 'rank-results']) {
        expect(html, `${f} has ${marker}`).not.toContain(marker);
      }
    }
  });

  it('prerenders every event page up front via speculation rules', () => {
    const html = read('index.html');
    const m = html.match(/<script type="speculationrules">([^<]*)<\/script>/);
    expect(m, 'speculationrules script').not.toBeNull();
    const rules = JSON.parse(m![1]!);
    expect(rules.prerender[0].where.href_matches).toBe('/events/*');
    expect(rules.prerender[0].eagerness).toBe('eager');
  });

  it("loads the first card rows' headshots eagerly, the rest lazily", () => {
    const imgs = [...read('index.html').matchAll(/<img[^>]*>/g)].map((m) => m[0]);
    expect(imgs[0]).toMatch(/loading="eager"/);
    expect(imgs.at(-1)).toMatch(/loading="lazy"/);
  });

  it('renders the rankings page and links it from every page', () => {
    expect(fs.existsSync(path.join(DIST, 'rankings', 'index.html'))).toBe(true);
    for (const f of walk(DIST).filter((p) => p.endsWith('.html'))) {
      expect(fs.readFileSync(f, 'utf8'), f).toMatch(/<a href="\/rankings\/"/);
    }
  });

  it('prerenders the home and rankings pages on intent, beside the eager event pages', () => {
    for (const f of walk(DIST).filter((p) => p.endsWith('.html'))) {
      const rules = JSON.parse(fs.readFileSync(f, 'utf8').match(/<script type="speculationrules">([^<]*)<\/script>/)![1]!);
      expect(rules.prerender, f).toEqual([
        { where: { href_matches: '/events/*' }, eagerness: 'eager' },
        { where: { href_matches: ['/', '/rankings/'] }, eagerness: 'moderate' },
      ]);
    }
  });

  it('loads the P4P headshots lazily at a fixed size, and no other headshot on the page', () => {
    const html = read('rankings/index.html');
    const imgs = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(3); // Alex Alpha, Max Mike, Dana Delta; the other P4P entries have no photo
    for (const img of imgs) {
      expect(img).toMatch(/loading="lazy"/);
      expect(img).toMatch(/width="\d+"/);
      expect(img).toMatch(/height="\d+"/);
    }
  });

  it('puts the active list in one JSON block for the search, not in the markup', () => {
    const html = read('rankings/index.html');
    const m = html.match(/<script type="application\/json" id="rank-data">([^<]*)<\/script>/);
    expect(m, 'rank-data script').not.toBeNull();
    const rows = JSON.parse(m![1]!);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual(['Alex Alpha', 1612, 'Lightweight', '#1 P4P', 0, 'ufc-323-alpha-vs-bravo', 'Oct 31 vs Bravo']);
    expect(html).not.toContain('Joaquín Juliét</'); // not rendered as markup until a search finds it
  });

  it('gives each P4P row its fighter id, the anchor a card\'s P4P rank links to', () => {
    const html = read('rankings/index.html');
    const ids = [...html.matchAll(/<li[^>]*class="p4p-row"[^>]*>/g)].map((m) => m[0].match(/\sid="([^"]+)"/)?.[1]);
    expect(ids).toEqual(['a1a1a1a1a1a1a1a1', 'a3a3a3a3a3a3a3a3', 'c3c3c3c3c3c3c3c3', 'd4d4d4d4d4d4d4d4', 'b4b4b4b4b4b4b4b4']);
    expect(read('events/ufc-323-alpha-vs-bravo/index.html')).toContain('href="/rankings/#c3c3c3c3c3c3c3c3"');
  });

  it('shows the search box at once, before the lists, and hides it only without JavaScript', () => {
    const html = read('rankings/index.html');
    expect(html.match(/<form[^>]*id="rank-search"[^>]*>/)![0]).not.toMatch(/\shidden\b/);
    expect(html).toMatch(/<noscript><style>[^<]*#rank-search\s*\{\s*display:\s*none/);
    const script = html.search(/<script>(?:(?!<\/script>)[\s\S])*rank-results/);
    expect(script).toBeGreaterThan(html.indexOf('id="rank-search"'));
    expect(script).toBeLessThan(html.indexOf('id="p4p"')); // unhidden before the lists are parsed, so nothing shifts
    expect(html.indexOf('id="rank-data"')).toBeGreaterThan(html.indexOf('id="p4p"')); // the 29 KB of JSON comes last
  });

  it('leaves nothing after </html>', () => {
    const html = read('rankings/index.html');
    expect(html.slice(html.lastIndexOf('</html>') + '</html>'.length).trim()).toBe('');
  });

  it('keeps home page HTML + CSS under 50 KB', () => {
    const html = read('index.html');
    const cssLinks = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]!);
    const cssBytes = cssLinks.reduce((n, href) => n + fs.statSync(path.join(DIST, href)).size, 0);
    expect(Buffer.byteLength(html) + cssBytes).toBeLessThan(BUDGET_BYTES);
  });

  it('converts headshots to avif/webp with fixed dimensions', () => {
    const html = read('index.html');
    expect(html).toMatch(/type="image\/avif"/);
    expect(html).toMatch(/type="image\/webp"/);
    for (const img of html.match(/<img[^>]*>/g) ?? []) {
      expect(img).toMatch(/width="\d+"/);
      expect(img).toMatch(/height="\d+"/);
    }
  });

  it('shows the model date in the footer', () => {
    expect(read('index.html')).toContain('Finish model as of Oct 1, 2026');
  });
});

describe('search and sharing', () => {
  const ORIGIN = 'https://ufc.xlobax.com';
  const EVENT_SLUGS = [
    'ufc-323-alpha-vs-bravo',
    'ufc-fight-night-india-vs-juliet',
    'ufc-fight-night-kilo-vs-lima',
    'ufc-fight-night-golf-vs-hotel',
  ];
  const PAGES = ['index.html', 'how-it-works/index.html', 'rankings/index.html', ...EVENT_SLUGS.map((s) => `events/${s}/index.html`)];
  const urlOf = (rel: string) => `${ORIGIN}/${rel.replace(/index\.html$/, '')}`;
  const attr = (html: string, re: RegExp) => html.match(re)?.[1];
  const title = (html: string) => attr(html, /<title>([^<]*)<\/title>/);
  const description = (html: string) => attr(html, /<meta name="description" content="([^"]*)"/);
  const jsonLd = (html: string) =>
    [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]!));

  it('gives every page one self-referencing canonical URL', () => {
    for (const rel of PAGES) {
      const html = read(rel);
      const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
      expect(canonicals, rel).toEqual([urlOf(rel)]);
    }
  });

  it('gives the home page its own title, distinct from the event page it shows', () => {
    const home = title(read('index.html'));
    expect(home).toBe('UFC fight cards with finish chances · Next: Alpha vs. Bravo');
    for (const slug of EVENT_SLUGS) expect(title(read(`events/${slug}/index.html`))).not.toBe(home);
  });

  it('writes a distinct, 120-160 character description for each event page', () => {
    const descs = EVENT_SLUGS.map((s) => description(read(`events/${s}/index.html`))!);
    expect(new Set(descs).size).toBe(descs.length);
    expect(description(read('events/ufc-323-alpha-vs-bravo/index.html'))).toBe(
      'UFC 323: Alpha vs. Bravo, Sat, Oct 31, 2026 in Las Vegas, Nevada, USA: all 4 bouts with finish chances and fighter Elo ratings.',
    );
  });

  it('describes every page for link previews with Open Graph and Twitter tags', () => {
    for (const rel of PAGES) {
      const html = read(rel);
      expect(attr(html, /<meta property="og:title" content="([^"]*)"/), rel).toBe(title(html));
      expect(attr(html, /<meta property="og:description" content="([^"]*)"/), rel).toBe(description(html));
      expect(attr(html, /<meta property="og:url" content="([^"]*)"/), rel).toBe(urlOf(rel));
      expect(attr(html, /<meta property="og:site_name" content="([^"]*)"/), rel).toBe('UFC fight cards');
      expect(attr(html, /<meta property="og:type" content="([^"]*)"/), rel).toMatch(/^(website|article)$/);
      expect(attr(html, /<meta name="twitter:card" content="([^"]*)"/), rel).toBe('summary_large_image');
    }
  });

  it('gives every page a 1200x630 share image', () => {
    for (const rel of PAGES) {
      const html = read(rel);
      expect(attr(html, /<meta property="og:image" content="([^"]*)"/), rel).toBe(`${ORIGIN}/og.png`);
      expect(attr(html, /<meta property="og:image:width" content="([^"]*)"/), rel).toBe('1200');
      expect(attr(html, /<meta property="og:image:height" content="([^"]*)"/), rel).toBe('630');
      expect(attr(html, /<meta property="og:image:alt" content="([^"]*)"/), rel).toBeTruthy();
    }
    const b = fs.readFileSync(path.join(DIST, 'og.png'));
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(b[25] === 6 || b[25] === 4, 'opaque, so dark-mode apps do not show it on black').toBe(false);
  });

  it('marks each event page up as a SportsEvent naming its fighters', () => {
    const [ld] = jsonLd(read('events/ufc-323-alpha-vs-bravo/index.html'));
    expect(ld['@type']).toBe('SportsEvent');
    expect(ld.name).toBe('UFC 323: Alpha vs. Bravo');
    expect(ld.startDate).toBe('2026-10-31');
    expect(ld.url).toBe(`${ORIGIN}/events/ufc-323-alpha-vs-bravo/`);
    expect(ld.competitor.length).toBeGreaterThan(0);
  });

  it('marks the home page up as a WebSite and the explainer as an Article', () => {
    expect(jsonLd(read('index.html')).map((l) => l['@type'])).toContain('WebSite');
    expect(jsonLd(read('how-it-works/index.html')).map((l) => l['@type'])).toEqual(['Article']);
    expect(attr(read('how-it-works/index.html'), /<meta property="og:type" content="([^"]*)"/)).toBe('article');
  });

  it('lists every indexable page in sitemap.xml', () => {
    const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    expect(locs).toEqual(PAGES.map(urlOf).sort());
  });

  it('points crawlers at the sitemap from robots.txt', () => {
    const robots = read('robots.txt');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, 'm'));
  });

  it('builds a 404 page that search engines skip and that leads back to the card', () => {
    const html = read('404.html');
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
    expect(html).not.toMatch(/rel="canonical"/);
    expect(html).toMatch(/<h1[^>]*>[\s\S]*not found[\s\S]*<\/h1>/i);
    expect(html).toContain('href="/"');
  });
});

// Favicon G: a bare ember octagon outline that follows the theme, plus the fallbacks browsers and home screens need.
describe('site icons', () => {
  const SRC_CSS = fs.readFileSync(path.join(SITE, 'src/styles/global.css'), 'utf8');
  const token = (css: string, name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  const darkCss = SRC_CSS.slice(SRC_CSS.indexOf('@media (prefers-color-scheme: dark)'));
  const png = (rel: string) => {
    const b = fs.readFileSync(path.join(DIST, rel));
    expect(b.subarray(1, 4).toString(), rel).toBe('PNG');
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4, bytes: b };
  };

  it('links every icon from the head of every page', () => {
    for (const f of walk(DIST).filter((p) => p.endsWith('.html'))) {
      const html = fs.readFileSync(f, 'utf8');
      expect(html, f).toMatch(/<link rel="icon" href="\/favicon\.ico" sizes="32x32"\s*\/?>/);
      expect(html, f).toMatch(/<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"\s*\/?>/);
      expect(html, f).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"\s*\/?>/);
      expect(html, f).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/);
      expect(html, f).toMatch(/<meta name="theme-color" content="#fbfaf8" media="\(prefers-color-scheme: light\)"\s*\/?>/);
      expect(html, f).toMatch(/<meta name="theme-color" content="#121110" media="\(prefers-color-scheme: dark\)"\s*\/?>/);
    }
  });

  it('draws the SVG favicon as an ember outline in the site\'s accent, swapping with the theme', () => {
    const svg = read('favicon.svg');
    expect(svg).toMatch(/viewBox="0 0 32 32"/);
    expect(svg).toMatch(/<polygon[^>]+points="[^"]+"/);
    expect(svg).toMatch(/fill="none"/);
    expect(svg).not.toMatch(/<rect/); // no background chip
    expect(svg).toContain(token(SRC_CSS, 'color-accent'));
    expect(svg).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(svg).toContain(token(darkCss, 'color-accent'));
  });

  it('ships a 16/32/48 favicon.ico for browsers without SVG favicons', () => {
    const b = fs.readFileSync(path.join(DIST, 'favicon.ico'));
    expect(b.readUInt16LE(0)).toBe(0);
    expect(b.readUInt16LE(2)).toBe(1); // icon
    const count = b.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => b[6 + i * 16] || 256).sort((x, y) => x - y);
    expect(sizes).toEqual([16, 32, 48]);
  });

  it('gives home screens opaque square icons on the paper background', () => {
    for (const [rel, size] of [
      ['apple-touch-icon.png', 180],
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['icon-maskable.png', 512],
    ] as const) {
      const p = png(rel);
      expect([p.width, p.height], rel).toEqual([size, size]);
      expect(p.alpha, `${rel} must be opaque (iOS turns transparency black)`).toBe(false);
    }
  });

  it('describes the icons in a web app manifest', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    expect(m.name).toBe('UFC fight cards');
    expect(m.background_color).toBe(token(SRC_CSS, 'color-bg'));
    expect(m.theme_color).toBe(token(SRC_CSS, 'color-bg'));
    expect(m.icons).toEqual([
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512' },
      { src: '/icon-maskable.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
    ]);
  });
});

// Ember is the brand and the "High finish chance" colour on purpose; other data stays out of it.
describe('accent colour', () => {
  const css = fs.readFileSync(path.join(SITE, 'src/styles/global.css'), 'utf8');
  const [light, dark] = css.split('@media (prefers-color-scheme: dark)');

  it('is the High tier colour in both themes', () => {
    expect(light).toMatch(/--color-tier-high:\s*var\(--color-accent\);/);
    expect(dark).not.toMatch(/--color-tier-high:/); // inherits the dark accent through the var
  });

  it('is not used on numbers or chart points, so they cannot be read as a High tier', () => {
    const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.stat:first-child .stat-value')).not.toContain('--color-accent');
    expect(rule('.chart-mark circle')).not.toContain('--color-accent');
  });
});

// Rankings borrowed the event page's header and the method page's sections; they share generic names and one stylesheet.
describe('shared page styles', () => {
  it('heads every page with .page-head and splits rankings and how-it-works into .page-section', () => {
    for (const page of ['index.html', 'events/ufc-323-alpha-vs-bravo/index.html', 'rankings/index.html', 'how-it-works/index.html', '404.html']) {
      expect(read(page), page).toContain('<header class="page-head"');
    }
    expect(read('rankings/index.html')).toContain('class="page-section"');
    expect(read('how-it-works/index.html')).toContain('class="page-section"');
  });

  it('keeps the rankings styles in global.css with the rest', () => {
    expect(fs.readFileSync(path.join(SITE, 'src/styles/global.css'), 'utf8')).toMatch(/\.p4p-row\s*\{/);
    expect(fs.readFileSync(path.join(SITE, 'src/pages/[rankings].astro'), 'utf8')).not.toContain('<style');
  });
});
