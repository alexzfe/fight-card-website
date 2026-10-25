import { describe, expect, it } from 'vitest';
import { byDateAscending, findBySlug, nextEvent, orderEvents } from '../../src/lib/events';
import type { Event } from '../../src/lib/schema';

const ev = (id: string, date: string, status: Event['status']): Event => ({
  id,
  slug: `slug-${id}`,
  name: `Event ${id}`,
  date,
  location: null,
  status,
  fights: [],
});

const events = [
  ev('past-old', '2026-09-01', 'completed'),
  ev('up-late', '2026-11-14', 'upcoming'),
  ev('past-new', '2026-10-18', 'completed'),
  ev('up-soon', '2026-10-31', 'upcoming'),
  ev('up-mid', '2026-11-07', 'upcoming'),
];

describe('orderEvents', () => {
  it('puts upcoming soonest-first, then completed most-recent-first', () => {
    expect(orderEvents(events).map((e) => e.id)).toEqual(['up-soon', 'up-mid', 'up-late', 'past-new', 'past-old']);
  });
  it('does not mutate its input', () => {
    const copy = [...events];
    orderEvents(events);
    expect(events).toEqual(copy);
  });
});

describe('byDateAscending', () => {
  it('runs past and upcoming events in calendar order', () => {
    expect(byDateAscending(events).map((e) => e.id)).toEqual(['past-old', 'past-new', 'up-soon', 'up-mid', 'up-late']);
  });
  it('does not mutate its input', () => {
    const copy = [...events];
    byDateAscending(events);
    expect(events).toEqual(copy);
  });
});

describe('nextEvent', () => {
  it('returns the soonest upcoming event', () => {
    expect(nextEvent(events)?.id).toBe('up-soon');
  });
  it('falls back to the latest completed event when nothing is upcoming', () => {
    expect(nextEvent(events.filter((e) => e.status === 'completed'))?.id).toBe('past-new');
  });
  it('returns undefined for no events', () => {
    expect(nextEvent([])).toBeUndefined();
  });
});

describe('findBySlug', () => {
  it('finds an event by slug', () => {
    expect(findBySlug(events, 'slug-up-mid')?.id).toBe('up-mid');
  });
  it('returns undefined for an unknown slug', () => {
    expect(findBySlug(events, 'nope')).toBeUndefined();
  });
});
