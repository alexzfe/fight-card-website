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
