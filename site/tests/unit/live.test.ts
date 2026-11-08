// The browser poller's pure parts (src/lib/live.ts): reading the engine's event JSON, merging it into what the page
// shows (never removing a result), the "Live now" pick, the "updated N min ago" text, and the poll/backoff state
// machine driven by fake timers, a fake clock and a fake fetch.
import { describe, expect, it } from 'vitest';
import {
  MAX_BACKOFF_MS,
  POLL_MS,
  backoffMs,
  createPoller,
  isComplete,
  liveLine,
  liveNowId,
  mergeEvent,
  parseLiveEvent,
  type LiveEvent,
  type LiveFight,
  type PollerDeps,
} from '../../src/lib/live';
import finalCard from '../fixtures/live-final/events/bbbb1111bbbb1111.json';
import staticCard from '../fixtures/live/events/bbbb1111bbbb1111.json';

const RESULT = { winner: 'r', method: 'KO/TKO', round: 1, time: '1:00' };
const ELO = { red_pre: 1600, red_delta: 10, blue_pre: 1500, blue_delta: -10 };

/** Card order (main event first), each `true` decided. */
const fights = (...decided: boolean[]): LiveFight[] =>
  decided.map((d, i) => ({ id: `f${i}`, red: 'r', blue: 'b', result: d ? RESULT : null, elo: null }));
const card = (date: string, list: LiveFight[]): LiveEvent => ({ id: 'ev', date, fights: list });
const t = (iso: string) => Date.parse(iso);

describe('parseLiveEvent', () => {
  it('reads the engine event file (the static fixture and the finished card)', () => {
    const live = parseLiveEvent(staticCard, 'bbbb1111bbbb1111')!;
    expect(live.date).toBe('2026-11-07');
    expect(live.fights.map((f) => f.id)).toEqual(staticCard.fights.map((f) => f.id));
    expect(live.fights.filter((f) => f.result)).toHaveLength(2);
    const done = parseLiveEvent(finalCard, 'bbbb1111bbbb1111')!;
    expect(done.fights[0]).toMatchObject({ result: { winner: 'f1f1f1f1f1f1f1f1', round: 2, time: '4:54' } });
    expect(done.fights[0]!.elo).toMatchObject({ red_pre: 1612, red_delta: 26, red_p4p_rank: 4 });
  });

  it('ignores fields it does not know (the contract only ever adds)', () => {
    const raw = { ...staticCard, sponsor: 'x', fights: staticCard.fights.map((f) => ({ ...f, judges: [1, 2] })) };
    expect(parseLiveEvent(raw, 'bbbb1111bbbb1111')).not.toBeNull();
  });

  const f0 = staticCard.fights[0]!;
  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['another event', { ...staticCard, id: 'cccc2222cccc2222' }],
    ['a bad date', { ...staticCard, date: 'Nov 7' }],
    ['fights not a list', { ...staticCard, fights: {} }],
    ['a fight without an id', { ...staticCard, fights: [{ red: 'a', blue: 'b' }] }],
    ['a result that is not an object', { ...staticCard, fights: [{ ...f0, result: 'win' }] }],
    ['a round that is not a positive integer', { ...staticCard, fights: [{ ...f0, result: { ...RESULT, winner: null, round: 0 } }] }],
    ['a winner outside the fight', { ...staticCard, fights: [{ ...f0, result: { ...RESULT, winner: 'zz' } }] }],
    ['a method that is not text', { ...staticCard, fights: [{ ...f0, result: { ...RESULT, winner: null, method: 3 } }] }],
    ['an elo with a fractional value', { ...staticCard, fights: [{ ...f0, elo: { ...ELO, red_pre: 1.5 } }] }],
    ['an elo rank of 0', { ...staticCard, fights: [{ ...f0, elo: { ...ELO, red_p4p_rank: 0 } }] }],
  ])('rejects %s', (_, raw) => {
    expect(parseLiveEvent(raw, 'bbbb1111bbbb1111')).toBeNull();
  });
});

describe('isComplete', () => {
  it('is true once every bout has a result, never for a card without bouts', () => {
    expect(isComplete(fights(true, true))).toBe(true);
    expect(isComplete(fights(true, false))).toBe(false);
    expect(isComplete([])).toBe(false);
  });
});

describe('liveNowId: the bout in progress', () => {
  // Running order is the card read bottom-up: the last bout in the list (earliest prelim) goes first.
  it('is none before the first result', () => {
    expect(liveNowId(fights(false, false, false))).toBeNull();
  });
  it('is the bout after the last decided one in running order', () => {
    expect(liveNowId(fights(false, false, true))).toBe('f1');
    expect(liveNowId(fights(false, true, true))).toBe('f0');
  });
  it('skips a bout left without a result behind a decided one (cancelled)', () => {
    // f2 (first up) never got a result, f1 did: f0 is next, f2 is cancelled.
    expect(liveNowId(fights(false, true, false))).toBe('f0');
  });
  it('is none once the card is complete, or the main event is decided', () => {
    expect(liveNowId(fights(true, true, true))).toBeNull();
    expect(liveNowId(fights(true, false, true))).toBeNull();
  });
  it('reads the fixture: 2 prelims decided, the co-main is next', () => {
    expect(liveNowId(parseLiveEvent(staticCard, 'bbbb1111bbbb1111')!.fights)).toBe('f000000000000003');
  });
});

describe('mergeEvent: only ever adds', () => {
  it('adds a new result with its elo, and reports the changed bouts', () => {
    const shown = card('2026-11-07', fights(false, true));
    const incoming = card('2026-11-07', fights(true, true));
    incoming.fights[0]!.elo = ELO;
    const { event, changed } = mergeEvent(shown, incoming);
    expect(event.fights[0]).toMatchObject({ result: RESULT, elo: ELO });
    expect(changed.map((f) => f.id)).toEqual(['f0']);
  });

  it('never removes a result the page shows when the API drops it', () => {
    const shown = card('2026-11-07', fights(true, true));
    const { event, changed } = mergeEvent(shown, card('2026-11-07', fights(false, false)));
    expect(event.fights.every((f) => f.result)).toBe(true);
    expect(changed).toEqual([]);
  });

  it('never rewrites a result already shown', () => {
    const shown = card('2026-11-07', fights(true));
    const incoming = card('2026-11-07', fights(true));
    incoming.fights[0]!.result = { ...RESULT, method: 'SUB' };
    expect(mergeEvent(shown, incoming).event.fights[0]!.result).toEqual(RESULT);
  });

  it('adds the elo to a bout shown without one, and never drops one', () => {
    const shown = card('2026-11-07', fights(true));
    const withElo = card('2026-11-07', fights(true));
    withElo.fights[0]!.elo = ELO;
    const once = mergeEvent(shown, withElo);
    expect(once.changed.map((f) => f.id)).toEqual(['f0']);
    expect(mergeEvent(once.event, shown).event.fights[0]!.elo).toEqual(ELO);
  });

  it('ignores an elo on a bout without a result, and bouts the page does not have', () => {
    const shown = card('2026-11-07', fights(false));
    const incoming = card('2026-11-07', [...fights(false), { id: 'new', red: 'x', blue: 'y', result: RESULT, elo: null }]);
    incoming.fights[0]!.elo = ELO;
    const { event, changed } = mergeEvent(shown, incoming);
    expect(event.fights).toHaveLength(1);
    expect(event.fights[0]!.elo).toBeNull();
    expect(changed).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const shown = card('2026-11-07', fights(false));
    mergeEvent(shown, card('2026-11-07', fights(true)));
    expect(shown.fights[0]!.result).toBeNull();
  });
});

describe('liveLine', () => {
  const now = t('2026-11-08T01:00:00Z');
  it.each([
    [0, 'Live · updated just now'],
    [59_000, 'Live · updated just now'],
    [60_000, 'Live · updated 1 min ago'],
    [14 * 60_000 + 30_000, 'Live · updated 14 min ago'],
    [59 * 60_000, 'Live · updated 59 min ago'],
    [60 * 60_000, 'Live · updated 1 h ago'],
    [150 * 60_000, 'Live · updated 2 h ago'],
  ])('%i ms after the update reads %s', (ago, text) => {
    expect(liveLine(now - ago, now)).toBe(text);
  });
  it('treats an update stamped in the future (clock skew) as just now', () => {
    expect(liveLine(now + 120_000, now)).toBe('Live · updated just now');
  });
});

describe('backoffMs', () => {
  it('polls every 60 s, then backs off 60 s → 2 → 4 → 5 min on errors, capped at 5 min', () => {
    expect(POLL_MS).toBe(60_000);
    expect(MAX_BACKOFF_MS).toBe(300_000);
    expect([0, 1, 2, 3, 4, 10].map(backoffMs)).toEqual([60_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });
});

// A fake world for the poller: a clock, timers, a visibility flag and a scripted fetch.
function world(start: string, responses: Array<LiveEvent | null | Error>) {
  let now = t(start);
  let hidden = false;
  let timer: { at: number; fn: () => void } | null = null;
  const loads: number[] = [];
  const applied: Array<{ changed: string[]; complete: boolean; since: number }> = [];
  const pending: Array<() => void> = [];
  const deps: PollerDeps = {
    now: () => now,
    hidden: () => hidden,
    setTimer: (fn, ms) => {
      timer = { at: now + ms, fn };
      return timer;
    },
    clearTimer: (h) => {
      if (h === timer) timer = null;
    },
    load: () => {
      loads.push(now);
      const next = responses.length > 1 ? responses.shift()! : responses[0]!;
      return new Promise((resolve, reject) =>
        pending.push(() => (next instanceof Error ? reject(next) : resolve(next && { event: next, modified: null }))),
      );
    },
    render: (state) =>
      applied.push({ changed: state.changed.map((f) => f.id), complete: state.complete, since: state.since }),
  };
  return {
    deps,
    loads,
    applied,
    /** Settle the in-flight fetch. */
    async settle() {
      pending.splice(0).forEach((f) => f());
      await new Promise((r) => setTimeout(r, 0));
    },
    /** Move the clock on, firing the timer if it falls due. */
    async advance(ms: number) {
      now += ms;
      if (timer && timer.at <= now) {
        const fn = timer.fn;
        timer = null;
        fn();
        await this.settle();
      }
    },
    setHidden(h: boolean) {
      hidden = h;
    },
    get timerIn() {
      return timer ? timer.at - now : null;
    },
  };
}

const running = card('2026-11-07', fights(false, false, true));
const more = card('2026-11-07', fights(false, true, true));
const done = card('2026-11-07', fights(true, true, true));
const NIGHT = '2026-11-08T01:00:00Z';

describe('createPoller', () => {
  it('fetches at once on start, renders, and polls again every 60 s', async () => {
    const w = world(NIGHT, [running, more]);
    const p = createPoller(running, t('2026-11-08T00:44:00Z'), w.deps);
    p.start();
    expect(w.loads).toHaveLength(1);
    await w.settle();
    expect(w.applied).toHaveLength(1);
    expect(w.timerIn).toBe(POLL_MS);
    await w.advance(POLL_MS);
    expect(w.loads).toHaveLength(2);
    expect(w.applied.at(-1)!.changed).toEqual(['f1']);
    expect(p.state()).toBe('polling');
  });

  it('stops once every bout has a result, and says so', async () => {
    const w = world(NIGHT, [done]);
    const p = createPoller(running, 0, w.deps);
    p.start();
    await w.settle();
    expect(w.applied.at(-1)!.complete).toBe(true);
    expect(p.state()).toBe('stopped');
    expect(w.timerIn).toBeNull();
  });

  it('never starts on a card that is already complete', () => {
    const w = world(NIGHT, [done]);
    const p = createPoller(done, 0, w.deps);
    p.start();
    expect(w.loads).toHaveLength(0);
    expect(p.state()).toBe('stopped');
  });

  it('stops when the card is no longer live by the browser clock (cancelled bout, grace over)', () => {
    const w = world('2026-11-10T00:00:00Z', [running]);
    const p = createPoller(running, 0, w.deps);
    p.start();
    expect(w.loads).toHaveLength(0);
    expect(p.state()).toBe('stopped');
  });

  it('waits without fetching before the card goes live, then starts on its date', async () => {
    const upcoming = card('2026-11-08', fights(false, false));
    const w = world('2026-11-07T23:58:30Z', [upcoming]);
    const p = createPoller(upcoming, 0, w.deps);
    p.start();
    expect(w.loads).toHaveLength(0);
    expect(p.state()).toBe('waiting');
    await w.advance(POLL_MS);
    expect(w.loads).toHaveLength(0);
    await w.advance(POLL_MS);
    expect(w.loads).toHaveLength(1);
  });

  it('backs off on errors and on JSON that does not parse, leaves the page alone, and recovers', async () => {
    const w = world(NIGHT, [new Error('offline'), null, null, null, null, more]);
    const p = createPoller(running, 0, w.deps);
    p.start();
    await w.settle();
    expect(w.timerIn).toBe(60_000);
    await w.advance(60_000);
    expect(w.timerIn).toBe(120_000);
    await w.advance(120_000);
    expect(w.timerIn).toBe(240_000);
    await w.advance(240_000);
    expect(w.timerIn).toBe(300_000);
    await w.advance(300_000);
    expect(w.timerIn).toBe(300_000);
    expect(w.applied).toHaveLength(0);
    await w.advance(300_000);
    expect(w.applied.at(-1)!.changed).toEqual(['f1']);
    expect(w.timerIn).toBe(POLL_MS);
  });

  it('pauses while the tab is hidden and fetches at once when it shows again', async () => {
    const w = world(NIGHT, [running]);
    const p = createPoller(running, 0, w.deps);
    p.start();
    await w.settle();
    w.setHidden(true);
    p.visibilityChanged();
    expect(w.timerIn).toBeNull();
    expect(p.state()).toBe('hidden');
    await w.advance(10 * POLL_MS);
    expect(w.loads).toHaveLength(1);
    w.setHidden(false);
    p.visibilityChanged();
    expect(w.loads).toHaveLength(2);
  });

  it('does not start while hidden; the first show fetches', () => {
    const w = world(NIGHT, [running]);
    w.setHidden(true);
    const p = createPoller(running, 0, w.deps);
    p.start();
    expect(w.loads).toHaveLength(0);
    w.setHidden(false);
    p.visibilityChanged();
    expect(w.loads).toHaveLength(1);
  });

  it('never runs two fetches at once (a show while one is in flight)', () => {
    const w = world(NIGHT, [running]);
    const p = createPoller(running, 0, w.deps);
    p.start();
    w.setHidden(true);
    p.visibilityChanged();
    w.setHidden(false);
    p.visibilityChanged();
    expect(w.loads).toHaveLength(1);
  });

  it('dates the update from Last-Modified when the server sends it, else from the change it saw', async () => {
    const built = t('2026-11-08T00:44:00Z');
    const lastModified = t('2026-11-08T00:58:00Z');
    const w = world(NIGHT, [more]);
    w.deps.load = async () => ({ event: more, modified: lastModified });
    const p = createPoller(running, built, w.deps);
    p.start();
    await w.settle();
    expect(w.applied.at(-1)!.since).toBe(lastModified);

    const v = world(NIGHT, [running, more]);
    const q = createPoller(running, built, v.deps);
    q.start();
    await v.settle();
    expect(v.applied.at(-1)!.since).toBe(built); // nothing new: still the build's data
    await v.advance(POLL_MS);
    expect(v.applied.at(-1)!.since).toBe(t(NIGHT) + POLL_MS); // a change seen now
  });
});
