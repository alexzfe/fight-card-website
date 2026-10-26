// The /v1/ API's shapes (fightcard-engine docs/CONTRACT.md): additive over data/, so both must validate.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadData } from '../../src/lib/data';
import { Index, Result } from '../../src/lib/schema';

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
    expect(raw.contract_version).toBe('1');
    expect(fs.existsSync(path.join(V1, 'schema.json'))).toBe(true);
  });
  it('loads as site data', () => {
    const data = loadData(V1);
    expect(data.index.contract_version).toBe('1');
    expect(data.events.length).toBeGreaterThan(0);
    const results = data.events.flatMap((e) => e.fights.map((f) => f.result).filter((r) => r != null));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => 'outcome' in r!)).toBe(true);
  });
});
