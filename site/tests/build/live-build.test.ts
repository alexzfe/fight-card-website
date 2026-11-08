// Builds the live fixtures (tests/fixtures/live at 2026-11-08T00:44Z, mid fight night) into its own outDir and checks
// what the live script needs from the static page, and that it ships only where a card can go live.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const SITE = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(SITE, 'dist-live-build');
const SCRIPT_BUDGET = 8 * 1024; // minified bytes, gzip makes it about a third

const read = (rel: string) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const scriptsOf = (html: string) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]!);

beforeAll(() => {
  fs.rmSync(DIST, { recursive: true, force: true });
  execFileSync('npx', ['astro', 'build', '--outDir', DIST], {
    cwd: SITE,
    env: { ...process.env, BUILD_NOW: '2026-11-08T00:44:00Z', DATA_DIR: 'tests/fixtures/live' },
    stdio: 'pipe',
  });
}, 180_000);

const LIVE = ['index.html', 'events/ufc-fight-night-live-vs-wire/index.html'];
const QUIET = ['events/ufc-fight-night-oldcard-vs-past/index.html', 'events/ufc-324-next-vs-upcoming/index.html'];

describe('live fixture build', () => {
  it('loads the live script on the live card’s pages only, one small module', () => {
    const live = LIVE.map((p) => scriptsOf(read(p)));
    for (const s of live) expect(s).toHaveLength(1);
    expect(new Set(live.flat()).size).toBe(1);
    for (const p of QUIET) expect(scriptsOf(read(p)), p).toEqual([]);
    const js = read(live[0]![0]!.replace(/^\//, ''));
    expect(js.length).toBeLessThan(SCRIPT_BUDGET);
    // The prod bundle has no dev override (a ?live-api= link could point the page at anyone's results).
    expect(js).not.toMatch(/live-api|__live-mock/);
    expect(js).toContain('https://ufc-data.xlobax.com');
  });

  it('embeds the card the script starts from: the bouts, results and Elo tags, the data time', () => {
    const html = read('index.html');
    const m = html.match(/<script type="application\/json" id="live-card"[^>]*>([^<]*)<\/script>/);
    expect(m).not.toBeNull();
    const card = JSON.parse(m![1]!);
    expect(card).toMatchObject({
      id: 'bbbb1111bbbb1111',
      date: '2026-11-07',
      slug: 'ufc-fight-night-live-vs-wire',
      since: '2026-11-08T00:44:00Z',
    });
    expect(card.fights.map((f: { id: string }) => f.id)).toEqual([
      'f000000000000002',
      'f000000000000003',
      'f000000000000004',
      'f000000000000005',
    ]);
    expect(card.fights.filter((f: { result: unknown }) => f.result)).toHaveLength(2);
    expect(card.fights[0]).toHaveProperty('tags');
  });

  it('marks every row with its bout id, and holds a hidden updated line', () => {
    const html = read('index.html');
    expect(html.match(/<li[^>]*data-fight-id="f00000000000000\d"/g)).toHaveLength(4);
    expect(html).toMatch(/<p[^>]*data-live-line[^>]*hidden/);
    expect(read(QUIET[0]!)).not.toMatch(/data-live-line/);
  });

  it('labels the running card Live, not Results, and styles its rail tile live', () => {
    const html = read('index.html');
    expect(html).toMatch(/<span data-event-status[^>]*> · Live<\/span>/);
    expect(html).toMatch(/class="tile tile-live"[^>]*href="\/events\/ufc-fight-night-live-vs-wire\/"/);
    expect(read(QUIET[0]!)).toMatch(/<span data-event-status[^>]*> · Results<\/span>/);
  });
});
