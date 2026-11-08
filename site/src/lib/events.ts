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

/**
 * Whether the card is live or just finished at `now`. Read from the fights' results, not `status`: the engine marks an
 * event `completed` on its first result.
 */
function isLive(event: Event, now: number): boolean {
  const start = midnightUtc(event.date);
  if (now < start) return false;
  if (now < start + DAY_MS) return true; // dated today (UTC)
  const decided = event.fights.filter((f) => f.result).length;
  if (decided === 0) return false;
  if (decided < event.fights.length) return now < start + (1 + RESULTS_GRACE_DAYS) * DAY_MS;
  return now < start + DAY_MS + DAY_MS / 2; // all in: until 12:00 UTC the next day
}

/**
 * The event the home page and the rail treat as current at `now`: the live or just-finished card (the most recent, if
 * several), else the soonest upcoming one, else the latest completed one. Pure and browser-safe; the build passes its
 * build time (BUILD_NOW), so a static page only moves on at the next build.
 */
export function currentEvent(events: readonly Event[], now: Date): Event | undefined {
  const t = now.getTime();
  const live = events.filter((e) => isLive(e, t)).sort((a, b) => byDate(b, a));
  return live[0] ?? orderEvents(events)[0];
}

export function findBySlug(events: readonly Event[], slug: string): Event | undefined {
  return events.find((e) => e.slug === slug);
}
