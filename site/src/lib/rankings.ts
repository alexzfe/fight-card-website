import type { Rankings } from './schema';

/** One active fighter for the search script: [name, Elo, division, P4P label, provisional]. "" = none. */
export type SearchRow = [name: string, elo: number, division: string, p4p: string, provisional: 0 | 1];

/** The active list, in order, as compact rows. Ranks overlap between the men's and women's lists, so the label says which. */
export function searchRows(rankings: Rankings): SearchRow[] {
  const women = new Set(rankings.p4p.women.map((e) => e.id));
  return rankings.active.map((e) => [
    e.name,
    e.elo,
    e.division ?? '',
    e.p4p_rank == null ? '' : `#${e.p4p_rank} ${women.has(e.id) ? 'women’s ' : ''}P4P`,
    e.provisional ? 1 : 0,
  ]);
}

/** Ids of the fighters whose rating rests on fewer than 3 UFC fights; the P4P entries don't carry the flag. */
export function provisionalIds(rankings: Rankings): Set<string> {
  return new Set(rankings.active.filter((e) => e.provisional).map((e) => e.id));
}

/** JSON for the body of a <script type="application/json">: no "<", so nothing in it can close the tag. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
