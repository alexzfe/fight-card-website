// The /v1/ API's shapes (fightcard-engine docs/CONTRACT.md): additive over data/, so both must validate.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadData } from '../../src/lib/data';
import { Index, Rankings, Result } from '../../src/lib/schema';

const V1 = path.resolve(import.meta.dirname, '../fixtures/v1');
const INDEX = { generated_at: '2026-10-26T06:00:00Z', upcoming: [], recent: [] };

describe('Index.contract_version', () => {
  it('keeps the /v1/ contract version', () => {
    expect(Index.parse({ ...INDEX, contract_version: '1.2' }).contract_version).toBe('1.2');
  });
  it('is optional, as data/ written by the pipeline has none', () => {
    expect(Index.parse(INDEX).contract_version).toBeUndefined();
  });
  it('must look like a version', () => {
    for (const v of ['', 'v1', '1.', 1]) {
      expect(Index.safeParse({ ...INDEX, contract_version: v }).success, String(v)).toBe(false);
    }
  });
});

describe('Result.outcome', () => {
  it('keeps win, draw and nc', () => {
    for (const outcome of ['win', 'draw', 'nc'] as const) {
      expect(Result.parse({ winner: null, outcome }).outcome).toBe(outcome);
    }
  });
  it('is optional and nullable', () => {
    expect(Result.parse({ winner: 'a' }).outcome).toBeUndefined();
    expect(Result.parse({ winner: 'a', outcome: null }).outcome).toBeNull();
  });
  it('rejects anything else', () => {
    expect(Result.safeParse({ winner: 'a', outcome: 'loss' }).success).toBe(false);
  });
});

describe('the /v1/ snapshot fixture', () => {
  it('is real publish output: contract version, outcomes and schema.json', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(V1, 'index.json'), 'utf8'));
    expect(raw.contract_version).toBe('1.2');
    expect(fs.existsSync(path.join(V1, 'schema.json'))).toBe(true);
  });
  it('loads as site data', () => {
    const data = loadData(V1);
    expect(data.index.contract_version).toBe('1.2');
    expect(data.events.length).toBeGreaterThan(0);
    const results = data.events.flatMap((e) => e.fights.map((f) => f.result).filter((r) => r != null));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => 'outcome' in r!)).toBe(true);
  });
});

describe('Rankings', () => {
  const entry = { rank: 1, id: 'f1', name: 'One', elo: 1700, division: 'Lightweight', image: null };
  const row = { id: 'f1', name: 'One', elo: 1700, division: 'Lightweight', p4p_rank: 1, provisional: false };
  const RANKINGS = { as_of: '2026-10-27', p4p: { men: [entry], women: [] }, active: [row] };

  it('parses the contract shape', () => {
    expect(Rankings.parse(RANKINGS)).toEqual(RANKINGS);
  });
  it('allows an empty roster', () => {
    expect(Rankings.safeParse({ as_of: '2026-10-27', p4p: { men: [], women: [] }, active: [] }).success).toBe(true);
  });
  it('allows a null division and image, and an unranked row', () => {
    const r = Rankings.parse({
      ...RANKINGS,
      p4p: { men: [{ ...entry, division: null, image: 'images/f1.webp' }], women: [] },
      active: [{ ...row, division: null, p4p_rank: null, provisional: true }],
    });
    expect(r.p4p.men[0]).toMatchObject({ division: null, image: 'images/f1.webp' });
    expect(r.active[0]).toMatchObject({ division: null, p4p_rank: null, provisional: true });
  });
  it('needs a YYYY-MM-DD as_of', () => {
    expect(Rankings.safeParse({ ...RANKINGS, as_of: '27/10/2026' }).success).toBe(false);
  });
  it('needs integer Elo and positive integer ranks', () => {
    const bad = (patch: object) => Rankings.safeParse({ ...RANKINGS, active: [{ ...row, ...patch }] }).success;
    expect(bad({ elo: 1700.5 })).toBe(false);
    expect(bad({ p4p_rank: 0 })).toBe(false);
    expect(Rankings.safeParse({ ...RANKINGS, p4p: { men: [{ ...entry, rank: 0 }], women: [] } }).success).toBe(false);
  });
  it('needs every list', () => {
    expect(Rankings.safeParse({ as_of: '2026-10-27', active: [] }).success).toBe(false);
    expect(Rankings.safeParse({ as_of: '2026-10-27', p4p: { men: [] }, active: [] }).success).toBe(false);
  });
});

describe('the /v1/ snapshot fixture rankings', () => {
  it('loads with the real webp headshots and a full active list', () => {
    const r = loadData(V1).rankings!;
    expect(r.p4p.men.length).toBeGreaterThan(0);
    expect(r.p4p.men.every((e) => e.image?.endsWith('.webp'))).toBe(true);
    expect(r.active.length).toBeGreaterThan(100);
  });
});
