import type { Event } from './schema';

const byDate = (a: Event, b: Event) => a.date.localeCompare(b.date);

/** Upcoming soonest-first, then completed most-recent-first. */
export function orderEvents(events: readonly Event[]): Event[] {
  const upcoming = events.filter((e) => e.status === 'upcoming').sort(byDate);
  const past = events.filter((e) => e.status === 'completed').sort((a, b) => byDate(b, a));
  return [...upcoming, ...past];
}

/** Every event in calendar order, past then upcoming: the event rail. */
export function byDateAscending(events: readonly Event[]): Event[] {
  return [...events].sort(byDate);
}

/** How long a card with some but not all results stays current: a cancelled bout never gets one. */
export const RESULTS_GRACE_DAYS = 2;

const DAY_MS = 86_400_000;
const midnightUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);

const decidedCount = (event: Event) => event.fights.filter((f) => f.result).length;

/** Some but not all fights have a result: the card is (probably) still running. */
const isPartial = (event: Event) => {
  const decided = decidedCount(event);
  return decided > 0 && decided < event.fights.length;
};

/**
 * Whether the card is live or just finished at `now`. Read from the fights' results, not `status`: the engine marks an
 * event `completed` on its first result. A card with a result counts from 00:00Z the day before its date, since cards
 * in Australia and Asia start their prelims on the previous UTC day.
 */
function isLive(event: Event, now: number): boolean {
  const start = midnightUtc(event.date);
  const decided = decidedCount(event);
  if (now < (decided > 0 ? start - DAY_MS : start)) return false;
  if (now < start + DAY_MS) return true; // dated today (UTC), or tomorrow with a result
  if (decided === 0) return false;
  if (decided < event.fights.length) return now < start + (1 + RESULTS_GRACE_DAYS) * DAY_MS;
  return now < start + DAY_MS + DAY_MS / 2; // all in: until 12:00 UTC the next day
}

/** Qualifying cards: one with some but not all results first (it's running), then the most recent date. */
const liveFirst = (a: Event, b: Event) => Number(isPartial(b)) - Number(isPartial(a)) || byDate(b, a);

/**
 * The event the home page and the rail treat as current at `now`: the live or just-finished card (if several, one
 * with some but not all results, then the most recent), else the soonest upcoming one, else the latest completed one.
 * Pure and browser-safe; the build passes its build time (BUILD_NOW), so a static page only moves on at the next build.
 */
export function currentEvent(events: readonly Event[], now: Date): Event | undefined {
  const t = now.getTime();
  const live = events.filter((e) => isLive(e, t)).sort(liveFirst);
  return live[0] ?? orderEvents(events)[0];
}

export function findBySlug(events: readonly Event[], slug: string): Event | undefined {
  return events.find((e) => e.slug === slug);
}
