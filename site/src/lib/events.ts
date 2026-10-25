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

/** The soonest upcoming event, else the latest completed one. */
export function nextEvent(events: readonly Event[]): Event | undefined {
  return orderEvents(events)[0];
}

export function findBySlug(events: readonly Event[], slug: string): Event | undefined {
  return events.find((e) => e.slug === slug);
}
