import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataError, loadData } from '../../src/lib/data';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/data');

describe('loadData with the fixture set', () => {
  const data = loadData(FIXTURES);

  it('loads every indexed event in display order', () => {
    expect(data.events.map((e) => e.slug)).toEqual([
      'ufc-323-alpha-vs-bravo',
      'ufc-fight-night-india-vs-juliet',
      'ufc-fight-night-kilo-vs-lima',
      'ufc-fight-night-golf-vs-hotel',
    ]);
  });
  it('loads fighters keyed by id', () => {
    expect(data.fighters['a1a1a1a1a1a1a1a1']?.name).toBe('Alex Alpha');
  });
  it('exposes the model info', () => {
    expect(data.index.model).toMatchObject({ as_of: '2026-10-01', version: 'v1-test', trees: 300 });
  });
  it('keeps fights in card order', () => {
    expect(data.events[0]!.fights.map((f) => f.id)[0]).toBe('f0000000000000a1');
  });
});

describe('loadData contract violations', () => {
  let dir: string;
  const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const writeJson = (rel: string, v: unknown) => fs.writeFileSync(path.join(dir, rel), JSON.stringify(v));
  const EVENT = 'events/1111aaaa1111aaaa.json';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-data-'));
    fs.cpSync(FIXTURES, dir, { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('fails when the data dir is missing', () => {
    expect(() => loadData(path.join(dir, 'nope'))).toThrow(DataError);
  });
  it('fails on invalid JSON with the file path in the message', () => {
    fs.writeFileSync(path.join(dir, 'index.json'), '{not json');
    expect(() => loadData(dir)).toThrow(/index\.json/);
  });
  it('fails when index.json is missing a field', () => {
    const idx = readJson('index.json');
    delete idx.upcoming;
    writeJson('index.json', idx);
    expect(() => loadData(dir)).toThrow(/index\.json.*upcoming/s);
  });
  it('fails when an indexed event file is missing', () => {
    fs.rmSync(path.join(dir, EVENT));
    expect(() => loadData(dir)).toThrow(/1111aaaa1111aaaa/);
  });
  it('fails on an unknown finish tier', () => {
    const e = readJson(EVENT);
    e.fights[0].finish_tier = 'very-high';
    writeJson(EVENT, e);
    expect(() => loadData(dir)).toThrow(/finish_tier/);
  });
  it('fails on an unknown card segment', () => {
    const e = readJson(EVENT);
    e.fights[0].segment = 'undercard';
    writeJson(EVENT, e);
    expect(() => loadData(dir)).toThrow(/segment/);
  });
  it('fails on a malformed date', () => {
    const e = readJson(EVENT);
    e.date = '31/10/2026';
    writeJson(EVENT, e);
    expect(() => loadData(dir)).toThrow(/date/);
  });
  it('fails when a fight references an unknown fighter', () => {
    const e = readJson(EVENT);
    e.fights[0].blue = 'deadbeefdeadbeef';
    writeJson(EVENT, e);
    expect(() => loadData(dir)).toThrow(/deadbeefdeadbeef/);
  });
  it('fails when the event id does not match its file', () => {
    const e = readJson(EVENT);
    e.id = 'other';
    writeJson(EVENT, e);
    expect(() => loadData(dir)).toThrow(/id/);
  });
  it('fails when an upcoming-listed event is not upcoming', () => {
    const e = readJson(EVENT);
    e.status = 'completed';
    writeJson(EVENT, e);
    expect(() => loadData(dir)).toThrow(/status/);
  });
  it('fails when a winner is not in the fight', () => {
    const rel = 'events/0000dddd0000dddd.json';
    const e = readJson(rel);
    e.fights[0].result.winner = 'c3c3c3c3c3c3c3c3';
    writeJson(rel, e);
    expect(() => loadData(dir)).toThrow(/winner/);
  });
  it('fails when a fighters.json key does not match the fighter id', () => {
    const f = readJson('fighters.json');
    f['a1a1a1a1a1a1a1a1'].id = 'zzz';
    writeJson('fighters.json', f);
    expect(() => loadData(dir)).toThrow(/a1a1a1a1a1a1a1a1/);
  });
  it('fails when a fighter image file is missing', () => {
    fs.rmSync(path.join(dir, 'images/a1a1a1a1a1a1a1a1.png'));
    expect(() => loadData(dir)).toThrow(/images\/a1a1a1a1a1a1a1a1\.png/);
  });
  it('fails when two events share a slug', () => {
    const e = readJson(EVENT);
    e.slug = 'ufc-fight-night-golf-vs-hotel';
    writeJson(EVENT, e);
    expect(() => loadData(dir)).toThrow(/slug/);
  });
  it('defaults the Elo fields for fighters written before them', () => {
    const fighters = readJson('fighters.json');
    for (const f of Object.values(fighters) as { [k: string]: unknown }[]) {
      for (const k of ['elo', 'elo_peak', 'p4p_rank', 'elo_provisional', 'elo_inactive', 'best_win']) delete f[k];
    }
    writeJson('fighters.json', fighters);
    const f = loadData(dir).fighters['c3c3c3c3c3c3c3c3']!;
    expect([f.elo_peak, f.p4p_rank, f.elo_provisional, f.elo_inactive, f.best_win]).toEqual([
      undefined,
      undefined,
      false,
      false,
      undefined,
    ]);
  });
  it('keeps the best win', () => {
    expect(loadData(dir).fighters['a1a1a1a1a1a1a1a1']!.best_win).toEqual({
      opponent_id: 'f6f6f6f6f6f6f6f6',
      opponent: 'Finn Foxtrot',
      elo: 1702,
      date: '2025-09-20',
    });
  });
  it('fails on a P4P rank below 1', () => {
    const fighters = readJson('fighters.json');
    fighters['c3c3c3c3c3c3c3c3'].p4p_rank = 0;
    writeJson('fighters.json', fighters);
    expect(() => loadData(dir)).toThrow(/p4p_rank/);
  });
  it('allows a missing model', () => {
    const idx = readJson('index.json');
    idx.model = null;
    writeJson('index.json', idx);
    expect(loadData(dir).index.model).toBeNull();
  });
});

describe('loadData rankings (optional rankings.json)', () => {
  let dir: string;
  const rankingsFile = () => path.join(dir, 'rankings.json');
  const readRankings = () => JSON.parse(fs.readFileSync(rankingsFile(), 'utf8'));
  const writeRankings = (v: unknown) => fs.writeFileSync(rankingsFile(), JSON.stringify(v));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-rankings-'));
    fs.cpSync(FIXTURES, dir, { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('loads the fixture: both P4P lists in rank order and the active list', () => {
    const r = loadData(dir).rankings!;
    expect(r.as_of).toBe('2026-10-20');
    expect(r.p4p.men.map((e) => e.name)).toEqual(['Alex Alpha', 'Max Mike', 'Carla Charlie']);
    expect(r.p4p.women.map((e) => e.name)).toEqual(['Dana Delta', 'Nia November']);
    expect(r.active).toHaveLength(8);
    expect(r.active[0]).toMatchObject({ name: 'Alex Alpha', elo: 1612, p4p_rank: 1, provisional: false });
  });
  it('is null when the data has no rankings.json, and still loads', () => {
    fs.rmSync(rankingsFile());
    const data = loadData(dir);
    expect(data.rankings).toBeNull();
    expect(data.events.length).toBeGreaterThan(0);
  });
  it('keeps null divisions and images', () => {
    const r = loadData(dir).rankings!;
    expect(r.p4p.men[2]).toMatchObject({ division: 'Middleweight', image: null });
    expect(r.active.find((e) => e.name === 'Kim Kilo')!.division).toBeNull();
  });
  it('fails on invalid JSON with the file path in the message', () => {
    fs.writeFileSync(rankingsFile(), '{not json');
    expect(() => loadData(dir)).toThrow(/rankings\.json/);
  });
  it('fails when an entry violates the contract', () => {
    const r = readRankings();
    r.active[0].elo = 'high';
    writeRankings(r);
    expect(() => loadData(dir)).toThrow(/rankings\.json.*active\.0\.elo/s);
  });
  it('fails when a P4P headshot is missing', () => {
    fs.rmSync(path.join(dir, 'images/a3a3a3a3a3a3a3a3.png'));
    expect(() => loadData(dir)).toThrow(/rankings\.json.*images\/a3a3a3a3a3a3a3a3\.png/s);
  });
  it('fails when a P4P list does not run 1..n in order', () => {
    const r = readRankings();
    r.p4p.women[1].rank = 5;
    writeRankings(r);
    expect(() => loadData(dir)).toThrow(/rankings\.json.*women.*rank/s);
  });
  it('fails when the active list is not best Elo first', () => {
    const r = readRankings();
    r.active.reverse();
    writeRankings(r);
    expect(() => loadData(dir)).toThrow(/rankings\.json.*active.*order/s);
  });
  it('fails when an active fighter has a P4P rank but is in no P4P list', () => {
    const r = readRankings();
    r.active.find((e: { name: string }) => e.name === 'Eli Echo').p4p_rank = 4; // would be labelled as a men's #4
    writeRankings(r);
    expect(() => loadData(dir)).toThrow(/rankings\.json.*active.*e5e5e5e5e5e5e5e5.*P4P/s);
  });
  it('fails when a P4P entry is not in the active list', () => {
    const r = readRankings();
    r.active = r.active.filter((e: { name: string }) => e.name !== 'Max Mike');
    writeRankings(r);
    expect(() => loadData(dir)).toThrow(/rankings\.json.*p4p\.men.*a3a3a3a3a3a3a3a3.*active/s);
  });
  it('fails when a P4P entry and its active row disagree on the rank', () => {
    const r = readRankings();
    r.active.find((e: { name: string }) => e.name === 'Nia November').p4p_rank = 1;
    writeRankings(r);
    expect(() => loadData(dir)).toThrow(/rankings\.json.*p4p\.women.*b4b4b4b4b4b4b4b4.*rank 2.*p4p_rank 1/s);
  });
  it('fails when a fighter is in both P4P lists', () => {
    const r = readRankings();
    r.p4p.women[1] = { ...r.p4p.men[0], rank: 2 };
    writeRankings(r);
    expect(() => loadData(dir)).toThrow(/rankings\.json.*a1a1a1a1a1a1a1a1.*more than one/s);
  });
});
