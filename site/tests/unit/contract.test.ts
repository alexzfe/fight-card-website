// The site's schema (src/lib/schema.ts) against the engine's published contract (/v1/schema.json, pinned as the
// fixture's copy): the site reads only fields the contract defines, accepts every enum value it allows (enums are
// closed within /v1/, so a value the site lacks is a breaking change), and needs nothing the contract leaves optional
// or nullable. Fields the site doesn't read are additive and only noted.
import fs from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { checkContract } from '../../src/lib/contract';

const V1 = path.resolve(import.meta.dirname, '../fixtures/v1');
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(V1, rel), 'utf8'));
const SCHEMA = read('schema.json');
const contract = () => structuredClone(SCHEMA);

// The engine's real contract 1.3 schema, with Fight.elo (fightcard-engine#11 at 580d8d8, from
// `fightcard.publish.build.schema()`); the pinned /v1/ fixture stays 1.2.
const SCHEMA13 = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/schema-1.3.json'), 'utf8'));
const contract13 = () => structuredClone(SCHEMA13);
// The engine's real contract 1.4 schema, with Fight.form (fightcard-engine#12 at 62eecd6, the same way).
const SCHEMA14 = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/schema-1.4.json'), 'utf8'));
const contract14 = () => structuredClone(SCHEMA14);

describe('checkContract', () => {
  it('finds no errors against the pinned /v1/ schema', () => {
    expect(checkContract(SCHEMA).errors).toEqual([]);
  });

  it('flags an enum value the contract allows and the site rejects', () => {
    const c = contract();
    c.$defs.Result.properties.outcome.anyOf[0].enum.push('dq');
    expect(checkContract(c).errors.join('\n')).toMatch(/Result.*outcome.*dq/);
  });

  it('flags a field the site reads that the contract does not define', () => {
    const c = contract();
    delete c.$defs.Fighter.properties.elo;
    expect(checkContract(c).errors.join('\n')).toMatch(/Fighter.*elo/);
  });

  it('flags a field the site requires that the contract makes optional', () => {
    const c = contract();
    c.$defs.Fight.required = c.$defs.Fight.required.filter((k: string) => k !== 'red');
    expect(checkContract(c).errors.join('\n')).toMatch(/Fight.*red/);
  });

  it('flags a null the contract allows and the site rejects', () => {
    const c = contract();
    c.$defs.Fighter.properties.name = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    expect(checkContract(c).errors.join('\n')).toMatch(/Fighter.*name/);
  });

  it('flags a file shape the contract no longer defines', () => {
    const c = contract();
    delete c.$defs.Event;
    expect(checkContract(c).errors.join('\n')).toMatch(/Event/);
  });

  it('only notes a contract without Rankings (before 1.2; rankings.json is optional)', () => {
    const c = contract();
    delete c.$defs.Rankings;
    const r = checkContract(c);
    expect(r.errors).toEqual([]);
    expect(r.notes.join('\n')).toMatch(/Rankings/);
  });

  it('only notes a contract without Fight.elo (before 1.3), so the site can deploy ahead of the engine', () => {
    expect(SCHEMA.title).toBe('fightcard /v1 (contract 1.2)');
    const r = checkContract(SCHEMA);
    expect(r.errors).toEqual([]);
    expect(r.notes.join('\n')).toMatch(/Fight\.elo/);
  });

  it('checks Fight.elo field by field against the 1.3 contract', () => {
    expect(SCHEMA13.title).toBe('fightcard /v1 (contract 1.3)');
    expect(checkContract(SCHEMA13).errors).toEqual([]);
    const c = contract13();
    c.$defs.FightElo.properties.red_pre = { type: 'string' };
    expect(checkContract(c).errors.join('\n')).toMatch(/FightElo\.red_pre/);
  });

  it('only notes a contract without Fight.form (before 1.4), so the site can deploy ahead of the engine', () => {
    for (const schema of [SCHEMA, SCHEMA13]) {
      const r = checkContract(schema);
      expect(r.errors, schema.title).toEqual([]);
      expect(r.notes.join('\n'), schema.title).toMatch(/Fight\.form/);
    }
  });

  it('checks Fight.form field by field against the 1.4 contract', () => {
    expect(SCHEMA14.title).toBe('fightcard /v1 (contract 1.4)');
    expect(checkContract(SCHEMA14).errors).toEqual([]);
    expect(checkContract(SCHEMA14).notes.join('\n')).not.toMatch(/Fight\.(form|elo)/);
    const c = contract14();
    c.$defs.FightForm.properties.red = { type: 'string' };
    expect(checkContract(c).errors.join('\n')).toMatch(/FightForm\.red/);
  });

  it.each([
    ['1.4', 'fightcard /v1 (contract 1.4)'],
    ['a later contract', 'fightcard /v1 (contract 1.10)'],
  ])('flags Fight.form missing from %s: the relaxation expires with the contract that adds it', (_, title) => {
    const c = contract14();
    c.title = title;
    delete c.$defs.Fight.properties.form;
    expect(checkContract(c).errors).toContain("Fight.form: the site reads a field the contract doesn't define");
  });

  it.each([
    ['1.3', 'fightcard /v1 (contract 1.3)'],
    ['a later contract', 'fightcard /v1 (contract 1.10)'],
    ['2.0', 'fightcard /v1 (contract 2.0)'],
  ])('flags Fight.elo missing from %s: the relaxation expires with the contract that adds it', (_, title) => {
    const c = contract13();
    c.title = title;
    delete c.$defs.Fight.properties.elo;
    const r = checkContract(c);
    expect(r.errors).toContain("Fight.elo: the site reads a field the contract doesn't define");
    expect(r.notes.join('\n')).not.toMatch(/Fight\.elo/);
  });

  it.each([
    ['no title', undefined],
    ['a title without a version', 'fightcard /v1'],
    ['an unreadable version', 'fightcard /v1 (contract next)'],
  ])('flags Fight.elo missing from a contract with %s (fails closed)', (_, title) => {
    const c = contract();
    if (title === undefined) delete c.title;
    else c.title = title;
    expect(checkContract(c).errors).toContain("Fight.elo: the site reads a field the contract doesn't define");
  });

  it.each([
    ['Fighter', 'elo', { anyOf: [{ type: 'string' }, { type: 'null' }] }],
    ['Fight', 'title_fight', { type: 'string' }],
    ['Event', 'date', { type: 'integer' }],
    ['ActiveEntry', 'elo', { type: 'number' }],
    ['Fighter', 'elo', { type: ['number', 'null'] }],
  ])('flags a type change: %s.%s to %j', (def, key, to) => {
    const c = contract();
    c.$defs[def].properties[key] = to;
    expect(checkContract(c).errors.join('\n')).toMatch(new RegExp(`${def}\\.${key}`));
  });

  it('flags a type change of list items', () => {
    const c = contract();
    c.$defs.Index.properties.upcoming.items = { type: 'integer' };
    expect(checkContract(c).errors.join('\n')).toMatch(/Index\.upcoming/);
  });

  it('accepts an integer where the site reads a number, and a type list', () => {
    const c = contract();
    c.$defs.Fighter.properties.height_in = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
    c.$defs.Fighter.properties.elo = { type: ['integer', 'null'] };
    expect(checkContract(c).errors).toEqual([]);
  });

  it('reads const as a one-value enum', () => {
    const c = contract();
    c.$defs.Result.properties.outcome.anyOf[0] = { anyOf: ['win', 'draw', 'nc'].map((v) => ({ const: v })) };
    expect(checkContract(c).errors).toEqual([]);
    c.$defs.Result.properties.outcome.anyOf[0].anyOf.push({ const: 'dq' });
    expect(checkContract(c).errors.join('\n')).toMatch(/Result.*outcome.*dq/);
  });

  it('follows a $ref wrapped in allOf', () => {
    const c = contract();
    c.$defs.Fight.properties.result.anyOf[0] = { allOf: [{ $ref: '#/$defs/Result' }], description: 'x' };
    expect(checkContract(c).errors).toEqual([]);
    c.$defs.Result.properties.outcome.anyOf[0].enum.push('dq');
    expect(checkContract(c).errors.join('\n')).toMatch(/Result.*outcome.*dq/);
  });

  it.each(['#/$defs/Nope', 'other.json#/$defs/Result'])('flags a $ref it cannot resolve: %s', (ref) => {
    const c = contract();
    c.$defs.Fight.properties.result.anyOf[0] = { $ref: ref };
    expect(checkContract(c).errors).toContain(`Fight.result: the contract's $ref ${ref} doesn't resolve`);
  });

  it('only notes an added field', () => {
    const c = contract();
    c.$defs.Fighter.properties.new_field = { type: 'string' };
    const r = checkContract(c);
    expect(r.errors).toEqual([]);
    expect(r.notes.join('\n')).toMatch(/Fighter.*new_field/);
  });
});

describe('the /v1/ snapshot fixture', () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(SCHEMA);
  const valid = (def: string, data: unknown) => {
    const check = ajv.getSchema(`${SCHEMA.$id}#/$defs/${def}`)!;
    return check(data) ? [] : check.errors;
  };

  it('is contract 1.2 with rankings.json', () => {
    expect(read('index.json').contract_version).toBe('1.2');
    expect(fs.existsSync(path.join(V1, 'rankings.json'))).toBe(true);
  });

  it('validates against its own schema.json, file by file', () => {
    expect(valid('Index', read('index.json'))).toEqual([]);
    expect(valid('Fighters', read('fighters.json'))).toEqual([]);
    expect(valid('Rankings', read('rankings.json'))).toEqual([]);
    for (const f of fs.readdirSync(path.join(V1, 'events'))) expect(valid('Event', read(`events/${f}`)), f).toEqual([]);
  });
});
