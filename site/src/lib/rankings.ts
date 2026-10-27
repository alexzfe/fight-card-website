import { orderEvents } from './events';
import { chipDate } from './format';
import type { Event, Fighter, Rankings } from './schema';

/** A fighter's soonest booked bout: the event's slug and e.g. "Nov 7 vs Brady". */
export interface NextBout {
  slug: string;
  label: string;
}

/**
 * One active fighter for the search script: [name, Elo, division, P4P label, provisional], plus [event slug, bout
 * label] only for a fighter booked on an upcoming card. "" = none.
 */
export type SearchRow =
  | [name: string, elo: number, division: string, p4p: string, provisional: 0 | 1]
  | [name: string, elo: number, division: string, p4p: string, provisional: 0 | 1, slug: string, bout: string];

/** The active list, in order, as compact rows. Ranks overlap between the men's and women's lists, so the label says which. */
export function searchRows(rankings: Rankings, bouts: ReadonlyMap<string, NextBout> = new Map()): SearchRow[] {
  const women = new Set(rankings.p4p.women.map((e) => e.id));
  return rankings.active.map((e): SearchRow => {
    const row: SearchRow = [
      e.name,
      e.elo,
      e.division ?? '',
      e.p4p_rank == null ? '' : `#${e.p4p_rank} ${women.has(e.id) ? 'women’s ' : ''}P4P`,
      e.provisional ? 1 : 0,
    ];
    const bout = bouts.get(e.id);
    return bout ? [...row, bout.slug, bout.label] : row;
  });
}

/** Each booked fighter's soonest upcoming bout, by fighter id; the opponent goes by surname, as event names do. */
export function nextBouts(events: readonly Event[], fighters: { [id: string]: Fighter }): Map<string, NextBout> {
  const bouts = new Map<string, NextBout>();
  const surname = (id: string) => fighters[id]?.name.trim().split(/\s+/).at(-1) ?? '';
  for (const event of orderEvents(events).filter((e) => e.status === 'upcoming')) {
    for (const { red, blue } of event.fights) {
      for (const [id, opponent] of [[red, blue], [blue, red]] as const) {
        if (!bouts.has(id)) bouts.set(id, { slug: event.slug, label: `${chipDate(event.date)} vs ${surname(opponent)}` });
      }
    }
  }
  return bouts;
}

/** Where a card's P4P rank links: the fighter's row on /rankings/; null without the page or without a row there. */
export function rankingsHref(rankings: Rankings | null, id: string): string | null {
  if (!rankings) return null;
  const listed = [...rankings.p4p.men, ...rankings.p4p.women].some((e) => e.id === id);
  return listed ? `/rankings/#${id}` : null;
}

/** Ids of the fighters whose rating rests on fewer than 3 UFC fights; the P4P entries don't carry the flag. */
export function provisionalIds(rankings: Rankings): Set<string> {
  return new Set(rankings.active.filter((e) => e.provisional).map((e) => e.id));
}

/** JSON for the body of a <script type="application/json">: no "<", so nothing in it can close the tag. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
