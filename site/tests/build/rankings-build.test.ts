// Builds the site twice more, each into its own dist-rankings-* dir (outDir has to be on site/'s filesystem): without rankings.json (no page, no link), and with a
// worst-case rankings.json (700 active fighters, more than the ~650 real ones) to hold the page to its size budget, and
// with empty lists (the page still builds and says there are no rankings).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SITE = path.resolve(import.meta.dirname, '../..');
const V1 = path.join(SITE, 'tests/fixtures/v1');
const BUDGET_GZ_BYTES = 24 * 1024; // the real page, 644 active fighters, is 16.4 KB gzipped; the 60 KB it started with let a doubling through
const WORST_CASE_ROWS = 700;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-rankings-build-')); // data copies
const DIST_NONE = path.join(SITE, 'dist-rankings-none');
const DIST_WORST = path.join(SITE, 'dist-rankings-worst');
const DIST_EMPTY = path.join(SITE, 'dist-rankings-empty');
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

// A deterministic list of random-letter names (no letter pattern for gzip to learn, so it can only do worse than on
// real names, which the test sizes confirm) and random Elos, sorted best first by the caller.
function fighters(n: number) {
  let seed = 7;
  const next = (m: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), (seed >> 8) % m);
  const word = () => {
    const w = Array.from({ length: 4 + next(7) }, () => String.fromCharCode(97 + next(26))).join('');
    return w[0]!.toUpperCase() + w.slice(1);
  };
  const divisions = ['Flyweight', 'Bantamweight', 'Featherweight', 'Lightweight', 'Welterweight', 'Middleweight'];
  return Array.from({ length: n }, (_, i) => ({
    id: (0xa000000000000000n + BigInt(i) * 7919n).toString(16).padStart(16, '0'),
    name: `${word()} ${word()}`,
    elo: 1300 + next(450),
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

  it('shows no Rankings link on any page', () => {
    for (const f of walk(dist).filter((p) => p.endsWith('.html'))) {
      const html = fs.readFileSync(f, 'utf8');
      expect(html, f).not.toContain('href="/rankings/"');
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

describe('empty rankings lists', () => {
  const dist = DIST_EMPTY;
  beforeAll(() => {
    const data = path.join(tmp, 'data-empty');
    fs.cpSync(V1, data, { recursive: true });
    fs.writeFileSync(
      path.join(data, 'rankings.json'),
      JSON.stringify({ as_of: '2026-10-27', p4p: { men: [], women: [] }, active: [] }),
    );
    build(data, dist);
  }, 300_000);

  it('builds the page with a "No rankings yet." line and no P4P rows', () => {
    const html = fs.readFileSync(path.join(dist, 'rankings', 'index.html'), 'utf8');
    expect(html).toContain('No rankings yet.');
    expect(html).not.toContain('data-testid="p4p-row"'); // the class is in the page's CSS
  });
});
