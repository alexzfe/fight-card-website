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

  it('ships no JavaScript beyond the event rail\'s inline scroll keeper', () => {
    expect(walk(DIST).filter((f) => /\.m?js$/.test(f))).toEqual([]);
    for (const f of walk(DIST).filter((p) => p.endsWith('.html'))) {
      // speculation rules are JSON the browser reads natively; no script runs
      const html = fs.readFileSync(f, 'utf8').replace(/<script type="speculationrules">[^<]*<\/script>/, '');
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
      expect(scripts.length, f).toBeLessThanOrEqual(1);
      for (const [tag, body] of scripts) {
        expect(tag, f).not.toMatch(/\ssrc=/i);
        expect(body, f).toContain('event-rail-scroll');
        expect(body!.length, f).toBeLessThan(1500);
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
