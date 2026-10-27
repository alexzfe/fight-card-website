// Checks the site's schema (schema.ts) against the engine's published contract, /v1/schema.json (the fightcard-engine's
// docs/CONTRACT.md). /v1/ is additive-only and its enums are closed, so data the contract allows must parse here:
// an error is a field the site reads that the contract doesn't define, an enum value or a null the contract allows
// and the site rejects, or a field the site requires that the contract makes optional. A field the contract has and
// the site doesn't read is additive and only a note.
import { z } from 'astro/zod';
import { Event, Fighters, Index, Rankings } from './schema';

type Json = { [key: string]: any };
export type ContractCheck = { errors: string[]; notes: string[] };

// The files the site reads, by their #/$defs name in schema.json.
const FILES: [string, z.ZodType][] = [
  ['Index', Index],
  ['Event', Event],
  ['Fighters', Fighters],
  ['Rankings', Rankings],
];

function lookup(root: Json, ref: string): Json | undefined {
  const name = ref.match(/^#\/\$defs\/(.+)$/)?.[1];
  return name ? root.$defs?.[name] : undefined;
}

// The non-null alternatives of a schema, $refs resolved, each with the $defs name it came from (if any).
function branches(s: Json, root: Json, label?: string): { s: Json; label?: string }[] {
  if (s.$ref) {
    const target = lookup(root, s.$ref);
    return target ? branches(target, root, s.$ref.split('/').pop()) : [];
  }
  const alts = s.anyOf ?? s.oneOf;
  if (alts) return alts.flatMap((a: Json) => branches(a, root, label));
  if (s.type === 'null') return [];
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t: string) => t !== 'null');
    return types.length ? [{ s: { ...s, type: types.length === 1 ? types[0] : types }, label }] : [];
  }
  return [{ s, label }];
}

function allowsNull(s: Json, root: Json): boolean {
  if (s.$ref) {
    const target = lookup(root, s.$ref);
    return target ? allowsNull(target, root) : false;
  }
  const alts = s.anyOf ?? s.oneOf;
  if (alts) return alts.some((a: Json) => allowsNull(a, root));
  return s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null')) || (s.enum ?? []).includes(null);
}

const isObject = (s: Json) => s.type === 'object' || s.properties !== undefined || typeof s.additionalProperties === 'object';
const isArray = (s: Json) => s.type === 'array' || s.items !== undefined;

class Walker {
  errors = new Set<string>();
  notes = new Set<string>();
  constructor(
    private site: Json,
    private contract: Json,
  ) {}

  compare(site: Json, contract: Json, where: string): void {
    if (allowsNull(contract, this.contract) && !allowsNull(site, this.site)) {
      this.errors.add(`${where}: the contract allows null, the site rejects it`);
    }
    const theirs = branches(contract, this.contract);
    for (const { s } of branches(site, this.site)) {
      if (s.enum) this.compareEnum(s, theirs, where);
      else if (isObject(s)) this.compareObject(s, theirs, where);
      else if (isArray(s)) {
        const c = theirs.find((b) => isArray(b.s));
        if (!c) this.errors.add(`${where}: the site expects a list, the contract has none`);
        else if (s.items && c.s.items) this.compare(s.items, c.s.items, `${c.label ?? where}[]`);
      }
    }
  }

  private compareEnum(s: Json, theirs: { s: Json }[], where: string): void {
    const ours = new Set(s.enum);
    if (theirs.some((b) => !b.s.enum)) {
      this.errors.add(`${where}: the site expects one of ${[...ours].join(', ')}, the contract allows any value`);
      return;
    }
    const allowed = new Set(theirs.flatMap((b) => b.s.enum).filter((v) => v !== null));
    for (const v of allowed) if (!ours.has(v)) this.errors.add(`${where}: the contract allows "${v}", the site rejects it`);
    for (const v of ours) if (!allowed.has(v)) this.notes.add(`${where}: the site also accepts "${v}"`);
  }

  private compareObject(s: Json, theirs: { s: Json; label?: string }[], where: string): void {
    const match = theirs.find((b) => isObject(b.s));
    if (!match) {
      this.errors.add(`${where}: the site expects an object, the contract has none`);
      return;
    }
    const c = match.s;
    const at = match.label ?? where;
    const required = new Set<string>(c.required ?? []);
    const rest = typeof c.additionalProperties === 'object' ? c.additionalProperties : undefined;
    const restNames: unknown[] | undefined = c.propertyNames?.enum;
    for (const [key, ours] of Object.entries<Json>(s.properties ?? {})) {
      const named = c.properties?.[key];
      const field = named ?? (rest && (!restNames || restNames.includes(key)) ? rest : undefined);
      if (!field) {
        this.errors.add(`${at}.${key}: the site reads a field the contract doesn't define`);
        continue;
      }
      if (named && (s.required ?? []).includes(key) && !required.has(key)) {
        this.errors.add(`${at}.${key}: the site requires it, the contract makes it optional`);
      }
      this.compare(ours, field, `${at}.${key}`);
    }
    if (s.properties) {
      for (const key of Object.keys(c.properties ?? {})) {
        if (!(key in s.properties)) this.notes.add(`${at}.${key}: in the contract, not read by the site`);
      }
    }
    if (typeof s.additionalProperties === 'object') {
      if (!rest) this.errors.add(`${at}: the site expects a map, the contract has none`);
      else this.compare(s.additionalProperties, rest, `${at}.*`);
    }
  }
}

export function checkContract(schema: Json): ContractCheck {
  const errors: string[] = [];
  const notes: string[] = [];
  for (const [name, zod] of FILES) {
    const theirs = schema.$defs?.[name];
    if (!theirs) {
      errors.push(`${name}: the contract defines no ${name}`);
      continue;
    }
    const ours = z.toJSONSchema(zod, { io: 'input' }) as Json;
    const walker = new Walker(ours, schema);
    walker.compare(ours, { $ref: `#/$defs/${name}` }, name);
    errors.push(...walker.errors);
    notes.push(...walker.notes);
  }
  return { errors: [...new Set(errors)], notes: [...new Set(notes)] };
}
