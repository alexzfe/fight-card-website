// `npm run validate-data`: refresh.yml's v1 job runs it on the swapped data/ before committing, so a snapshot the
// site's own schema (src/lib/schema.ts, via loadData) rejects never reaches main.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SITE = path.resolve(import.meta.dirname, '../..');
const V1 = path.join(SITE, 'tests/fixtures/v1');
const tmp: string[] = [];

function validate(dir: string) {
  return spawnSync('npm', ['run', '--silent', 'validate-data', '--', dir], { cwd: SITE, encoding: 'utf8' });
}

function copy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-data-'));
  tmp.push(dir);
  fs.cpSync(V1, dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('validate-data', () => {
  it('passes the /v1/ fixture', () => {
    const r = validate(V1);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('ok');
  }, 60_000);

  it('fails on a fighter that violates the schema', () => {
    const dir = copy();
    const file = path.join(dir, 'fighters.json');
    const fighters = JSON.parse(fs.readFileSync(file, 'utf8'));
    const [first] = Object.keys(fighters);
    fighters[first].record = { w: -1 };
    fs.writeFileSync(file, JSON.stringify(fighters));
    const r = validate(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('fighters.json');
  }, 60_000);

  it('fails on a missing data dir', () => {
    const r = validate(path.join(os.tmpdir(), 'no-such-data-dir'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not found');
  }, 60_000);
});
