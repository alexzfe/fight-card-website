// Live results in the browser, the pure part: read the engine's event file (/v1/events/<id>.json), merge it into what
// the page shows, pick the bout in progress, and run the poll loop. No DOM here (live-row.ts) and nothing Node-only:
// it ships in the live script (components/LivePoll.astro). The script stays small, so no zod: parseLiveEvent checks
// just the fields the page reads, as strictly as schema.ts does.
import { isComplete, isLive } from './events';
import { eloAtFight, resultParts, type EloAtFight } from './format';
import type { FightElo, Result } from './schema';

export type LiveFight = { id: string; red: string; blue: string; result: Result | null; elo: FightElo | null };
export type LiveEvent = { id: string; date: string; fights: LiveFight[] };

type Obj = { [k: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const optStr = (v: unknown) => v == null || typeof v === 'string';
const isInt = (v: unknown): v is number => Number.isInteger(v);
const optPos = (v: unknown) => v == null || (isInt(v) && v > 0);

function readResult(v: unknown): Result | null | undefined {
  if (v == null) return null;
  if (!isObj(v) || !optStr(v.method) || !optStr(v.time) || !optPos(v.round)) return undefined;
  if (!optStr(v.winner)) return undefined; // any id, as schema.ts: a winner outside the fight shows no winner
  if (v.outcome != null && v.outcome !== 'win' && v.outcome !== 'draw' && v.outcome !== 'nc') return undefined;
  return v as Result;
}

function readElo(v: unknown): FightElo | null | undefined {
  if (v == null) return null;
  if (!isObj(v)) return undefined;
  const ints = [v.red_pre, v.red_delta, v.blue_pre, v.blue_delta].every(isInt);
  return ints && optPos(v.red_p4p_rank) && optPos(v.blue_p4p_rank) ? (v as FightElo) : undefined;
}

/** The event file as the page needs it, or null when it isn't one (or isn't event `id`): ignore it then. */
export function parseLiveEvent(raw: unknown, id: string): LiveEvent | null {
  if (!isObj(raw) || raw.id !== id || typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date))
    return null;
  if (!Array.isArray(raw.fights)) return null;
  const fights: LiveFight[] = [];
  for (const f of raw.fights) {
    if (!isObj(f) || !isStr(f.id) || !isStr(f.red) || !isStr(f.blue)) return null;
    const result = readResult(f.result);
    const elo = readElo(f.elo);
    if (result === undefined || elo === undefined) return null;
    fights.push({ id: f.id, red: f.red, blue: f.blue, result, elo });
  }
  return { id, date: raw.date, fights };
}

/** Every bout decided, or the main event (first) decided: the card is over (events.ts). */
export { isComplete };

/**
 * The bout in progress, from the fights as the page shows them (card.ts runningOrder: a late addition sits in its
 * segment, not at the end of the list). In running order (that list bottom-up, main event last), the bout right
 * after the last one with a result. Bouts left without one before it were cancelled. None before the first result,
 * or once the last bout (the main event) has one.
 */
export function liveNowId(fights: ReadonlyArray<Pick<LiveFight, 'id' | 'result'>>): string | null {
  const last = fights.findIndex((f) => f.result); // card order: the first decided is the last decided to run
  return last > 0 ? fights[last - 1]!.id : null;
}

/**
 * `incoming` folded into what the page shows, only ever adding: a result for a bout without one, an Elo for a
 * decided bout without one. A result already shown is never removed or rewritten; bouts the page lacks are ignored.
 */
export function mergeEvent(shown: LiveEvent, incoming: LiveEvent): { event: LiveEvent; changed: LiveFight[] } {
  const next = new Map(incoming.fights.map((f) => [f.id, f]));
  const changed: LiveFight[] = [];
  const fights = shown.fights.map((f) => {
    const n = next.get(f.id);
    const result = f.result ?? n?.result ?? null;
    const elo = f.elo ?? (result && n?.elo) ?? null;
    if (result === f.result && elo === f.elo) return f;
    const merged = { ...f, result, elo };
    changed.push(merged);
    return merged;
  });
  return { event: { ...shown, fights }, changed };
}

export type CornerView = { winner: boolean; lost: boolean; atFight: EloAtFight | null; tags: string[] };
export type FightView = {
  id: string;
  done: boolean;
  /** How it ended (resultParts); null shows no outcome block. */
  outcome: { method: string | null; when: string | null } | null;
  red: CornerView;
  blue: CornerView;
};

/** What a row shows for a live bout, from the same helpers FightRow and Corner use (format.ts). */
export function liveFightView(fight: LiveFight, tags: { red: string[]; blue: string[] }): FightView {
  const winner = fight.result?.winner;
  const corner = (side: 'red' | 'blue'): CornerView => ({
    winner: !!winner && winner === fight[side],
    lost: !!winner && winner !== fight[side],
    atFight: eloAtFight(fight, side),
    tags: tags[side],
  });
  return {
    id: fight.id,
    done: fight.result != null,
    outcome: resultParts(fight.result),
    red: corner('red'),
    blue: corner('blue'),
  };
}

/** "Live · updated 6 min ago". */
export function liveLine(since: number, now: number): string {
  const min = Math.floor(Math.max(0, now - since) / 60_000);
  const ago = min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
  return `Live · updated ${ago}`;
}

export const POLL_MS = 60_000;
export const MAX_BACKOFF_MS = 300_000;

/** The wait before the next fetch after `failures` failed ones in a row: 60 s, doubling from the second, at most 5 min. */
export const backoffMs = (failures: number) => Math.min(POLL_MS * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);

export type RenderState = { event: LiveEvent; changed: LiveFight[]; complete: boolean; since: number };

export interface PollerDeps {
  /** One fetch: the parsed event and its Last-Modified (ms), or null when it didn't parse. Rejects on errors. */
  load(): Promise<{ event: LiveEvent; modified: number | null } | null>;
  /** Apply a batch to the page. If it throws, the batch isn't kept: the next poll brings the same rows again. */
  render(state: RenderState): void;
  /** The loop has stopped for good (card over, or no longer live by the browser clock). */
  onStop?(): void;
  now(): number;
  hidden(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export type PollerState = 'idle' | 'waiting' | 'polling' | 'hidden' | 'stopped';

/**
 * The poll loop for one card, from the page's copy (`initial`, its data time `since`). While the card is live by the
 * browser clock and not complete, it fetches at once, then every 60 s; errors and bad JSON back off and change
 * nothing. A hidden tab pauses it; showing it again fetches at once. Before the card's date it waits without fetching.
 */
export function createPoller(initial: LiveEvent, since: number, deps: PollerDeps) {
  let event = initial;
  let state: PollerState = 'idle';
  let timer: unknown = null;
  let inFlight = false;
  let failures = 0;

  const schedule = (ms: number) => {
    timer = deps.setTimer(() => {
      timer = null;
      tick();
    }, ms);
  };

  const stop = () => {
    if (state === 'stopped') return;
    state = 'stopped';
    deps.onStop?.();
  };

  const done = (got: Awaited<ReturnType<PollerDeps['load']>>) => {
    if (!got) throw new Error('unparsable');
    failures = 0; // the fetch worked: a render error below is not a fetch failure, so it never backs off
    const { event: next, changed } = mergeEvent(event, got.event);
    let nextSince = since;
    if (got.modified != null) nextSince = Math.max(since, got.modified);
    else if (changed.length) nextSince = deps.now();
    const complete = isComplete(next.fights);
    try {
      deps.render({ event: next, changed, complete, since: nextSince });
    } catch (err) {
      console.error('live: could not show the update; trying again on the next poll', err);
      return; // nothing kept: the next poll reports the same rows as changed
    }
    event = next;
    since = nextSince;
    if (complete) stop();
  };

  function tick() {
    if (state === 'stopped' || inFlight) return;
    const now = deps.now();
    if (isComplete(event.fights)) return stop();
    if (now < Date.parse(`${event.date}T00:00:00Z`) && !event.fights.some((f) => f.result)) {
      state = 'waiting';
      return schedule(POLL_MS);
    }
    if (!isLive(event, now)) return stop();
    if (deps.hidden()) return void (state = 'hidden');
    state = 'polling';
    inFlight = true;
    deps
      .load()
      .then(done)
      .catch(() => {
        failures += 1;
      })
      .finally(() => {
        inFlight = false;
        if (state === 'polling') schedule(failures ? backoffMs(failures) : POLL_MS);
      });
  }

  return {
    start: tick,
    visibilityChanged() {
      if (state === 'stopped') return;
      if (timer != null) deps.clearTimer(timer);
      timer = null;
      if (deps.hidden()) state = 'hidden';
      else if (inFlight)
        state = 'polling'; // its answer schedules the next one
      else tick();
    },
    state: () => state,
  };
}
