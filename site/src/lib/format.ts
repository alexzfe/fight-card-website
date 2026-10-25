import type { FinishTier, PastFight, PastResult, Record, Result } from './schema';

const DASH = '—';

export function formatRecord({ w, l, d, nc }: Record): string {
  const base = `${w}-${l}-${d}`;
  return nc > 0 ? `${base} (${nc} NC)` : base;
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

/** e.g. "KO/TKO R1 4:12"; null when there is nothing to show. */
export function formatResult(result: Result | null | undefined): string | null {
  if (!result) return null;
  const parts = [result.method, result.round != null ? `R${result.round}` : null, result.time].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

const RESULT_LETTERS: { [K in PastResult]: string } = { win: 'W', loss: 'L', draw: 'D', nc: 'NC' };

export function resultLetter(result: PastResult): string {
  return RESULT_LETTERS[result];
}

/** e.g. "KO/TKO R1 · Jun 2026"; empty when nothing is known. */
export function formatPastFight(fight: Pick<PastFight, 'method' | 'round' | 'date'>): string {
  const how = [fight.method, fight.round != null ? `R${fight.round}` : null].filter(Boolean).join(' ');
  const when = fight.date
    ? utc(fight.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : null;
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

/** "UFC 323: A vs. B" -> "UFC 323"; "UFC Fight Night: …" -> "Fight Night". */
export function chipLabel(name: string): string {
  const prefix = name.split(':')[0]!.trim();
  return prefix === 'UFC Fight Night' ? 'Fight Night' : prefix;
}
