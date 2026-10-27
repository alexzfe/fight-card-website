// Builds the site twice more, each into its own dist-rankings-* dir (outDir has to be on site/'s filesystem): without rankings.json (no page, no link), and with a
// worst-case rankings.json (700 active fighters, more than the ~650 real ones) to hold the page to its size budget.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SITE = path.resolve(import.meta.dirname, '../..');
const V1 = path.join(SITE, 'tests/fixtures/v1');
const BUDGET_GZ_BYTES = 60 * 1024;
const WORST_CASE_ROWS = 700;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-rankings-build-')); // data copies
const DIST_NONE = path.join(SITE, 'dist-rankings-none');
const DIST_WORST = path.join(SITE, 'dist-rankings-worst');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const build = (dataDir: string, outDir: string) => {
  fs.rmSync(outDir, { recursive: true, force: true });
  execFileSync('npx', ['astro', 'build', '--outDir', outDir], {
    cwd: SITE,
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: 'pipe',
  });
};

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });

// A deterministic, name-shaped list: varied enough that gzip cannot do better than on real names.
function fighters(n: number) {
  const first = ['Alex', 'Bruno', 'Carlos', 'Dmitri', 'Eli', 'Farid', 'Gus', 'Hiroshi', 'Ivan', 'Jon', 'Khalil', 'Lucas'];
  const last = ['Alvarez', 'Borrachinha', 'Cannonier', 'Dvalishvili', 'Evloev', 'Figueiredo', 'Gaethje', 'Holloway'];
  let seed = 7;
  const next = (m: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % m);
  const divisions = ['Flyweight', 'Bantamweight', 'Featherweight', 'Lightweight', 'Welterweight', 'Middleweight'];
  return Array.from({ length: n }, (_, i) => ({
    id: (0xa000000000000000n + BigInt(i) * 7919n).toString(16).padStart(16, '0'),
    name: `${first[next(12)]} ${last[next(8)]}${String.fromCharCode(97 + next(26), 97 + next(26))}`,
    elo: 1750 - Math.floor(i / 3),
    division: divisions[next(6)]!,
    p4p_rank: null,
    provisional: next(10) === 0,
  }));
}

describe('without rankings.json', () => {
  const dist = DIST_NONE;
  beforeAll(() => {
    const data = path.join(tmp, 'data-none');
    fs.cpSync(path.join(SITE, 'tests/fixtures/data'), data, { recursive: true });
    fs.rmSync(path.join(data, 'rankings.json'));
    build(data, dist);
  }, 300_000);

  it('builds, with no rankings page', () => {
    expect(fs.existsSync(path.join(dist, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(dist, 'rankings'))).toBe(false);
  });

  it('shows no site tabs and no link on any page', () => {
    for (const f of walk(dist).filter((p) => p.endsWith('.html'))) {
      const html = fs.readFileSync(f, 'utf8');
      expect(html, f).not.toContain('href="/rankings/"');
      expect(html, f).not.toContain('<nav class="site-nav"');
    }
  });
});

describe('the rankings page budget', () => {
  const dist = DIST_WORST;
  beforeAll(() => {
    const data = path.join(tmp, 'data-worst');
    fs.cpSync(V1, data, { recursive: true });
    const rankings = JSON.parse(fs.readFileSync(path.join(V1, 'rankings.json'), 'utf8'));
    const padded = [...rankings.active, ...fighters(WORST_CASE_ROWS - rankings.active.length)];
    rankings.active = padded.sort((a: { elo: number }, b: { elo: number }) => b.elo - a.elo);
    fs.writeFileSync(path.join(data, 'rankings.json'), JSON.stringify(rankings));
    build(data, dist);
  }, 300_000);

  it(`is at most ${BUDGET_GZ_BYTES / 1024} KB gzipped (HTML, inline CSS and all) with ${WORST_CASE_ROWS} active fighters`, () => {
    const html = fs.readFileSync(path.join(dist, 'rankings', 'index.html'));
    expect(html.includes('rank-data')).toBe(true);
    expect(zlib.gzipSync(html, { level: 9 }).length).toBeLessThanOrEqual(BUDGET_GZ_BYTES);
  });

  it('adds no JavaScript file and loads no stylesheet or script from elsewhere', () => {
    expect(walk(dist).filter((f) => /\.m?js$/.test(f))).toEqual([]);
    const html = fs.readFileSync(path.join(dist, 'rankings', 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
  });
});
