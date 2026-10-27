import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'astro/zod';
import { orderEvents } from './events';
import { Event, Fighters, Index, Rankings } from './schema';
import type { Fighter } from './schema';

export class DataError extends Error {
  override name = 'DataError';
}

export interface SiteData {
  index: Index;
  events: Event[];
  fighters: { [id: string]: Fighter };
  rankings: Rankings | null; // null when data/ has no rankings.json
}

function readJson<T>(dir: string, rel: string, schema: z.ZodType<T>): T {
  const file = path.join(dir, rel);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new DataError(`${file}: ${(err as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new DataError(`${file} violates the data contract:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

function checkRankings(dir: string, rankings: Rankings): string[] {
  const problems: string[] = [];
  for (const sex of ['men', 'women'] as const) {
    rankings.p4p[sex].forEach((e, i) => {
      if (e.rank !== i + 1) {
        problems.push(`rankings.json: p4p.${sex} position ${i + 1} has rank ${e.rank}, expected ${i + 1}`);
      }
      if (e.image && !fs.existsSync(path.join(dir, e.image))) {
        problems.push(`rankings.json: p4p.${sex} ${e.id} image ${e.image} not found`);
      }
    });
  }
  const unordered = rankings.active.findIndex((e, i) => i > 0 && e.elo > rankings.active[i - 1]!.elo);
  if (unordered > 0) problems.push(`rankings.json: active is not in best-Elo-first order at row ${unordered}`);
  return problems;
}

/** Load and cross-check data/ (see docs/CONTRACT.md). Throws DataError on any violation. */
export function loadData(dir: string): SiteData {
  if (!fs.existsSync(dir)) throw new DataError(`data dir not found: ${dir} (set DATA_DIR)`);

  const index = readJson(dir, 'index.json', Index);
  const fighters = readJson(dir, 'fighters.json', Fighters);
  const problems: string[] = [];

  for (const [key, f] of Object.entries(fighters)) {
    if (f.id !== key) problems.push(`fighters.json: key ${key} has id ${f.id}`);
    if (f.image && !fs.existsSync(path.join(dir, f.image))) {
      problems.push(`fighters.json: ${key} image ${f.image} not found`);
    }
  }

  const rankings = fs.existsSync(path.join(dir, 'rankings.json')) ? readJson(dir, 'rankings.json', Rankings) : null;
  if (rankings) problems.push(...checkRankings(dir, rankings));

  const listed = [
    ...index.upcoming.map((id) => ({ id, status: 'upcoming' as const })),
    ...index.recent.map((id) => ({ id, status: 'completed' as const })),
  ];
  const events = listed.map(({ id, status }) => {
    const rel = `events/${id}.json`;
    if (!fs.existsSync(path.join(dir, rel))) throw new DataError(`${rel} listed in index.json but missing`);
    const event = readJson(dir, rel, Event);
    if (event.id !== id) problems.push(`${rel}: id ${event.id} does not match file name`);
    if (event.status !== status) problems.push(`${rel}: status ${event.status}, but index.json lists it as ${status}`);
    for (const fight of event.fights) {
      for (const fid of [fight.red, fight.blue]) {
        if (!fighters[fid]) problems.push(`${rel}: fight ${fight.id} references unknown fighter ${fid}`);
      }
      const winner = fight.result?.winner;
      if (winner && winner !== fight.red && winner !== fight.blue) {
        problems.push(`${rel}: fight ${fight.id} winner ${winner} is not in the fight`);
      }
    }
    return event;
  });

  const slugs = new Set<string>();
  for (const e of events) {
    if (slugs.has(e.slug)) problems.push(`duplicate event slug ${e.slug}`);
    slugs.add(e.slug);
  }

  if (problems.length) throw new DataError(`data contract violations in ${dir}:\n  ${problems.join('\n  ')}`);
  return { index, events: orderEvents(events), fighters, rankings };
}
