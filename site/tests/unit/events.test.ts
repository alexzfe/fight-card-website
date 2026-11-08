import { describe, expect, it } from 'vitest';
import { RESULTS_GRACE_DAYS, byDateAscending, currentEvent, findBySlug, orderEvents } from '../../src/lib/events';
import type { Event } from '../../src/lib/schema';

const ev = (id: string, date: string, status: Event['status'], fights: Event['fights'] = []): Event => ({
  id,
  slug: `slug-${id}`,
  name: `Event ${id}`,
  date,
  location: null,
  status,
  fights,
});

/** `done` bouts with a result, then `left` without one. */
const bouts = (done: number, left: number): Event['fights'] =>
  Array.from({ length: done + left }, (_, i) => ({
    id: `f${i}`,
    red: 'r',
    blue: 'b',
    title_fight: false,
    result: i < done ? { winner: 'r', method: 'KO/TKO', round: 1, time: '1:00' } : null,
  }));

const at = (iso: string) => new Date(iso);
// Long before every fixture date, so only the fallback applies.
const EARLY = at('2026-08-01T12:00:00Z');

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

describe('currentEvent: fallback', () => {
  it('returns the soonest upcoming event', () => {
    expect(currentEvent(events, EARLY)?.id).toBe('up-soon');
  });
  it('falls back to the latest completed event when nothing is upcoming', () => {
    expect(currentEvent(events.filter((e) => e.status === 'completed'), EARLY)?.id).toBe('past-new');
  });
  it('returns undefined for no events', () => {
    expect(currentEvent([], EARLY)).toBeUndefined();
  });
  it('does not mutate its input', () => {
    const copy = [...events];
    currentEvent(events, at('2026-11-07T23:00:00Z'));
    expect(events).toEqual(copy);
  });
});

// Fight night 2026-11-07: the engine flips an event to `completed` on its first result, and the next card is a week out.
describe('currentEvent: a live or just-finished card stays current', () => {
  const prev = ev('prev', '2026-10-31', 'completed', bouts(12, 0));
  const next = ev('next', '2026-11-14', 'upcoming', bouts(0, 13));
  const tonight = (done: number, left: number, status: Event['status'] = done ? 'completed' : 'upcoming') =>
    [prev, ev('tonight', '2026-11-07', status, bouts(done, left)), next];

  it('keeps the grace at 2 days', () => {
    expect(RESULTS_GRACE_DAYS).toBe(2);
  });
  it('is the card dated today (UTC) before its first result', () => {
    expect(currentEvent(tonight(0, 14), at('2026-11-07T00:00:00Z'))?.id).toBe('tonight');
    expect(currentEvent(tonight(0, 14), at('2026-11-07T23:59:59Z'))?.id).toBe('tonight');
  });
  it('is the card dated today even when its status is already completed', () => {
    expect(currentEvent(tonight(1, 13), at('2026-11-07T22:30:00Z'))?.id).toBe('tonight');
  });
  it('stays on a card with some results after midnight UTC (the real 6/14 at 00:44Z)', () => {
    expect(currentEvent(tonight(6, 8), at('2026-11-08T00:44:00Z'))?.id).toBe('tonight');
  });
  it('stays on a card with some results for the 2-day grace, then lets go', () => {
    expect(currentEvent(tonight(13, 1), at('2026-11-09T23:59:59Z'))?.id).toBe('tonight');
    // A cancelled bout that never gets a result must not pin the card forever.
    expect(currentEvent(tonight(13, 1), at('2026-11-10T00:00:00Z'))?.id).toBe('next');
    expect(currentEvent(tonight(13, 1), at('2026-11-12T12:00:00Z'))?.id).toBe('next');
  });
  it('stays on a finished card until noon UTC the next day', () => {
    expect(currentEvent(tonight(14, 0), at('2026-11-08T04:17:00Z'))?.id).toBe('tonight');
    expect(currentEvent(tonight(14, 0), at('2026-11-08T11:59:59Z'))?.id).toBe('tonight');
  });
  it('moves on from a finished card at noon UTC the next day', () => {
    expect(currentEvent(tonight(14, 0), at('2026-11-08T12:00:00Z'))?.id).toBe('next');
    expect(currentEvent(tonight(14, 0), at('2026-11-08T12:30:00Z'))?.id).toBe('next');
  });
  it('falls back to the latest completed card when a finished one is past noon and nothing is upcoming', () => {
    expect(currentEvent(tonight(14, 0).slice(0, 2), at('2026-11-08T12:30:00Z'))?.id).toBe('tonight');
    expect(currentEvent([prev], at('2026-11-08T12:30:00Z'))?.id).toBe('prev');
  });
  it('ranks a card with some but not all results above one with none, whatever the dates', () => {
    // Saturday's card is still running past midnight UTC; a Sunday card exists with no results yet.
    const running = ev('running', '2026-11-07', 'completed', bouts(13, 1));
    const sunday = ev('sunday', '2026-11-08', 'upcoming', bouts(0, 10));
    expect(currentEvent([prev, sunday, running, next], at('2026-11-08T03:00:00Z'))?.id).toBe('running');
    expect(currentEvent([prev, running, sunday, next], at('2026-11-08T03:00:00Z'))?.id).toBe('running');
  });
  it('picks the most recent date among qualifying cards in the same rank', () => {
    // Neither partial: yesterday's finished card (before noon) and today's card with no results.
    const finished = ev('finished', '2026-11-07', 'completed', bouts(14, 0));
    const today = ev('today', '2026-11-08', 'upcoming', bouts(0, 10));
    expect(currentEvent([prev, today, finished, next], at('2026-11-08T10:00:00Z'))?.id).toBe('today');
    expect(currentEvent([prev, finished, today, next], at('2026-11-08T10:00:00Z'))?.id).toBe('today');
    // Both partial.
    const older = ev('older', '2026-11-07', 'completed', bouts(5, 5));
    const newer = ev('newer', '2026-11-08', 'completed', bouts(1, 9));
    expect(currentEvent([prev, newer, older, next], at('2026-11-08T10:00:00Z'))?.id).toBe('newer');
    expect(currentEvent([prev, older, newer, next], at('2026-11-08T10:00:00Z'))?.id).toBe('newer');
  });
  // Cards in Australia and Asia start their prelims on the previous UTC day (Sydney 09:00 AEDT = 22:00Z the day before).
  it('is a card dated tomorrow once it has a result, from 00:00Z the day before its date', () => {
    const sydney = ev('sydney', '2026-11-08', 'completed', bouts(1, 12));
    expect(currentEvent([prev, sydney, next], at('2026-11-07T22:30:00Z'))?.id).toBe('sydney');
    expect(currentEvent([prev, sydney, next], at('2026-11-07T00:00:00Z'))?.id).toBe('sydney');
    expect(currentEvent([prev, sydney, next], at('2026-11-06T23:59:59Z'))?.id).toBe('next');
  });
  it('ignores a card with results more than a day in the future', () => {
    const odd = ev('odd', '2026-11-10', 'completed', bouts(1, 1));
    expect(currentEvent([prev, odd, next], at('2026-11-08T23:59:59Z'))?.id).toBe('next');
    expect(currentEvent([prev, odd, next], at('2026-11-08T10:00:00Z'))?.id).toBe('next');
  });
  it('treats a card with no fights as never finished', () => {
    const empty = ev('empty', '2026-11-07', 'completed', []);
    expect(currentEvent([empty, next], at('2026-11-08T10:00:00Z'))?.id).toBe('next');
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
