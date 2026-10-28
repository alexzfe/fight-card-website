import type { BestWin, Event, Fight, Fighter, FinishTier, PastFight, PastResult, Record, Result } from './schema';

const DASH = '—';

export function formatRecord({ w, l, d, nc }: Record): string {
  const base = `${w}-${l}-${d}`;
  return nc > 0 ? `${base} (${nc} NC)` : base;
}

/** e.g. "Elo 1690 · #4 P4P", or "Elo 1612" when unranked; null when unknown. */
export function formatElo(elo: number | null | undefined, p4pRank?: number | null): string | null {
  if (elo == null) return null;
  return p4pRank != null ? `Elo ${elo} · #${p4pRank} P4P` : `Elo ${elo}`;
}

/** A rating change: "+26", "−14" (a real minus sign), "±0". */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '±0';
}

/** The same change in words, for screen readers (which may drop the minus sign): "up 26", "down 14", "no change". */
export function spokenDelta(delta: number): string {
  return delta > 0 ? `up ${delta}` : delta < 0 ? `down ${-delta}` : 'no change';
}

export type EloAtFight = {
  elo: string;
  /** null when nothing changed (a no contest): nothing shows, and screen readers still hear "no change". */
  delta: string | null;
  change: 'gain' | 'loss' | null;
  spoken: string;
  rank: string | null;
};

/** A completed fight's Elo for one corner at the time, e.g. "Elo 1612", "+26" ("up 26"), "#4 P4P"; null without fight.elo. */
export function eloAtFight(fight: Pick<Fight, 'elo'>, side: 'red' | 'blue'): EloAtFight | null {
  if (!fight.elo) return null;
  const rank = fight.elo[`${side}_p4p_rank`];
  const delta = fight.elo[`${side}_delta`];
  return {
    elo: formatElo(fight.elo[`${side}_pre`]) ?? DASH,
    delta: delta ? formatDelta(delta) : null,
    change: delta > 0 ? 'gain' : delta < 0 ? 'loss' : null,
    spoken: spokenDelta(delta),
    rank: rank != null ? `#${rank} P4P` : null,
  };
}

/** e.g. opponent "Glover Teixeira" over meta "Elo 1684 · Jun 2022"; null without a win. */
export function formatBestWin(win: BestWin | null | undefined): { opponent: string; meta: string } | null {
  if (!win) return null;
  return { opponent: win.opponent, meta: `Elo ${win.elo} · ${monthYear(win.date)}` };
}

export function eloTags(fighter: Pick<Fighter, 'elo_provisional' | 'elo_inactive'>): string[] {
  return [fighter.elo_provisional && 'provisional', fighter.elo_inactive && 'inactive'].filter(
    (t): t is string => !!t,
  );
}

/** Elo tooltip, e.g. "Peak 1659 · Best win: Chris Duncan (1634)"; null when neither is known. */
export function eloTip(fighter: Pick<Fighter, 'elo_peak' | 'best_win'>): string | null {
  const parts = [
    fighter.elo_peak != null ? `Peak ${fighter.elo_peak}` : null,
    fighter.best_win ? `Best win: ${fighter.best_win.opponent} (${fighter.best_win.elo})` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const TAG_TIPS: { [tag: string]: string } = {
  provisional: 'Fewer than 3 UFC fights',
  inactive: 'No fight in the last 12 months',
};

/** What an Elo tag means, for its tooltip. */
export function tagTip(tag: string): string | undefined {
  return TAG_TIPS[tag];
}

export function formatHeight(inches: number | null | undefined): string {
  if (inches == null) return DASH;
  const total = Math.round(inches);
  return `${Math.floor(total / 12)}'${total % 12}"`;
}

export function formatReach(inches: number | null | undefined): string {
  if (inches == null) return DASH;
  return `${Math.round(inches * 10) / 10}"`;
}

/** Full years between dob and date (both YYYY-MM-DD). */
export function ageAt(dob: string | null | undefined, date: string): number | null {
  if (!dob) return null;
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const hadBirthday = m > bm || (m === bm && d >= bd);
  return y - by - (hadBirthday ? 0 : 1);
}

/** A result as its method over when it ended, e.g. "KO/TKO" over "R1 · 4:12"; null when nothing is known. */
export function resultParts(result: Result | null | undefined): { method: string | null; when: string | null } | null {
  if (!result) return null;
  const when = [result.round != null ? `R${result.round}` : null, result.time].filter(Boolean).join(' · ') || null;
  return result.method || when ? { method: result.method ?? null, when } : null;
}

const RESULT_LETTERS: { [K in PastResult]: string } = { win: 'W', loss: 'L', draw: 'D', nc: 'NC' };

export function resultLetter(result: PastResult): string {
  return RESULT_LETTERS[result];
}

/** e.g. "KO/TKO R1 · Jun 2026"; empty when nothing is known. */
export function formatPastFight(fight: Pick<PastFight, 'method' | 'round' | 'date'>): string {
  const how = [fight.method, fight.round != null ? `R${fight.round}` : null].filter(Boolean).join(' ');
  const when = fight.date ? monthYear(fight.date) : null;
  return [how, when].filter(Boolean).join(' · ');
}

const TIER_LABELS: { [K in FinishTier]: string } = { high: 'High', medium: 'Medium', low: 'Low' };

export function tierLabel(tier: FinishTier | null | undefined): string {
  return tier ? TIER_LABELS[tier] : DASH;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0]!;
  const last = words[words.length - 1]!;
  return words.length === 1 ? first[0]!.toUpperCase() : (first[0]! + last[0]!).toUpperCase();
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

const monthYear = (date: string) =>
  utc(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function chipDate(date: string): string {
  return utc(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatDate(date: string): string {
  return utc(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatLongDate(date: string): string {
  return utc(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "UFC 323: Alpha vs. Bravo" -> kicker "UFC 323", headline "Alpha vs. Bravo"; no colon -> no kicker. */
export function splitEventName(name: string): { kicker: string | null; headline: string } {
  const colon = name.indexOf(':');
  return colon > 0
    ? { kicker: name.slice(0, colon).trim(), headline: name.slice(colon + 1).trim() }
    : { kicker: null, headline: name };
}

/** Event rail tile: "Oct 31 · UFC 323" over "Alpha vs. Bravo". "UFC Fight Night" is every other week, so it's dropped. */
export function eventTile(event: Pick<Event, 'name' | 'date'>): { meta: string; headline: string } {
  const { kicker, headline } = splitEventName(event.name);
  const meta = [chipDate(event.date), kicker === 'UFC Fight Night' ? null : kicker];
  return { meta: meta.filter(Boolean).join(' · '), headline };
}
