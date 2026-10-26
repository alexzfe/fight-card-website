// Builds the site from the /v1/ snapshot fixture (`fightcard publish` over data/), as refresh.yml does with
// DATA_SOURCE=v1. Its own outDir, so it can run beside build.test.ts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const SITE = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(SITE, 'dist-v1');
const V1 = path.join(SITE, 'tests/fixtures/v1');

beforeAll(() => {
  fs.rmSync(DIST, { recursive: true, force: true });
  execFileSync('npx', ['astro', 'build', '--outDir', DIST], {
    cwd: SITE,
    env: { ...process.env, DATA_DIR: 'tests/fixtures/v1' },
    stdio: 'pipe',
  });
}, 300_000);

describe('v1 snapshot build', () => {
  const index = JSON.parse(fs.readFileSync(path.join(V1, 'index.json'), 'utf8'));
  const events = [...index.upcoming, ...index.recent].map((id: string) =>
    JSON.parse(fs.readFileSync(path.join(V1, 'events', `${id}.json`), 'utf8')),
  );

  it('renders the home page and every indexed event', () => {
    expect(fs.existsSync(path.join(DIST, 'index.html'))).toBe(true);
    for (const e of events) {
      expect(fs.existsSync(path.join(DIST, 'events', e.slug, 'index.html')), e.slug).toBe(true);
    }
  });

  it('does not publish schema.json or anything else from the data dir', () => {
    expect(fs.existsSync(path.join(DIST, 'schema.json'))).toBe(false);
  });
});
