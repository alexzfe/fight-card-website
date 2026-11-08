// Live results in the browser, the DOM part: turn a FightRow built before its result into the completed row the build
// gives a finished fight, and mark the card live. Every element added here is the one FightRow.astro / Corner.astro
// render for a completed fight, from the same view (live.ts liveFightView, on format.ts's helpers);
// tests/component/live-row.test.ts renders both rows with the real components and checks they match.
import { tagTip } from './format';
import type { CornerView, FightView } from './live';

type Attrs = { [name: string]: string | undefined };

function el(doc: Document, tag: string, attrs: Attrs, ...kids: Array<Node | string>): HTMLElement {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

/** Corner.astro's Elo span content for a completed fight: "Elo 1612 +26 (up 26) · #4 P4P". */
function fillAtFightElo(elo: HTMLElement, a: NonNullable<CornerView['atFight']>) {
  const doc = elo.ownerDocument;
  elo.removeAttribute('data-tip');
  elo.removeAttribute('tabindex');
  elo.replaceChildren(a.elo);
  if (a.delta) {
    const chip = el(
      doc,
      'span',
      { class: `elo-delta elo-${a.change}`, 'data-testid': 'elo-delta', 'aria-hidden': 'true' },
      a.delta,
    );
    elo.append(' ', chip);
  }
  elo.append(el(doc, 'span', { class: 'sr-only' }, ` (${a.spoken})`));
  if (a.rank) elo.append(' · ', a.rank);
}

function applyCorner(corner: HTMLElement, view: CornerView, result: boolean) {
  const doc = corner.ownerDocument;
  const who = corner.querySelector('.who')!;
  if (result) {
    if (view.winner) {
      corner.classList.add('winner');
      corner.dataset.testid = 'winner';
      who.querySelector('.name')!.append(el(doc, 'span', { class: 'sr-only' }, ' (winner)'));
      const chip = el(doc, 'span', { class: 'win-chip', 'data-testid': 'win-chip', 'aria-hidden': 'true' }, 'Win');
      who.querySelector('.record')!.prepend(chip);
    }
    if (view.lost) {
      corner.classList.add('lost');
      who.querySelector('.name')!.append(el(doc, 'span', { class: 'sr-only' }, ' (lost)'));
    }
  }
  if (!view.atFight) return;
  let elo = who.querySelector<HTMLElement>('.elo');
  if (!elo) {
    // No Elo today, so the row was built without an Elo line: the completed row has one, with the corner's tags.
    elo = el(doc, 'span', { class: 'elo', 'data-testid': 'elo' });
    const tags = view.tags.map((t) =>
      el(doc, 'span', { class: 'elo-tag', 'data-testid': 'elo-tag', 'data-tip': tagTip(t), tabindex: '-1' }, t),
    );
    who.querySelector('.record')!.after(el(doc, 'span', { class: 'elo-line' }, elo, ...tags));
  }
  fillAtFightElo(elo, view.atFight);
}

/**
 * Show a live bout's result (and Elo going in) on its row, as the build shows a completed fight. Only ever adds: a row
 * already showing a result keeps it, an Elo already at the time stays; a bout still without a result is left alone.
 */
export function applyFight(row: HTMLElement, view: FightView) {
  if (!view.done) return;
  const doc = row.ownerDocument;
  const fresh = !row.classList.contains('done');
  if (fresh) {
    row.classList.add('done');
    const mid = row.querySelector('.mid')!;
    if (view.outcome) {
      const { method, when } = view.outcome;
      const outcome = el(doc, 'span', { class: 'outcome', 'data-testid': 'outcome' });
      if (method) outcome.append(el(doc, 'span', { class: 'method' }, method));
      if (method && when) outcome.append(' ');
      if (when) outcome.append(el(doc, 'span', { class: 'when' }, when));
      const after = [...mid.children].filter((c) => c.matches('.main-event-marker, .live-marker')).at(-1);
      if (after) after.after(outcome);
      else mid.prepend(outcome);
    }
    // An unscored bout drops its "Finish chance —"; a scored one keeps the badge frozen at the start.
    if (mid.querySelector('.badge-none')) mid.querySelectorAll('.finish-label, .badge').forEach((e) => e.remove());
  }
  // The Elo going in, once: the at-time Elo always carries its spoken change.
  const corners = (['red', 'blue'] as const).map((side) => row.querySelector<HTMLElement>(`.corner-${side}`)!);
  const hasAtFight = corners.some((c) => c.querySelector('.elo .sr-only'));
  [view.red, view.blue].forEach((side, i) =>
    applyCorner(corners[i]!, hasAtFight ? { ...side, atFight: null } : side, fresh),
  );
}

/** Put the "Live now" marker on bout `id` (after its main-event marker), or nowhere. */
export function markLiveNow(root: ParentNode, id: string | null) {
  const current = root.querySelector('[data-testid="live-now"]');
  const mid = id ? root.querySelector(`[data-fight-id="${CSS.escape(id)}"] .mid`) : null;
  if (current && current.parentElement === mid) return;
  current?.remove();
  if (!mid) return;
  const marker = el(mid.ownerDocument, 'span', { class: 'live-marker', 'data-testid': 'live-now' }, 'Live now');
  const main = mid.querySelector(':scope > .main-event-marker');
  if (main) main.after(marker);
  else mid.prepend(marker);
}

/** The card reads as live (header word, "updated" line, rail tile) or as finished; null leaves the page as built. */
export function renderCard(
  doc: Document,
  view: { phase: 'live' | 'results' | null; line: string | null; slug: string },
) {
  if (!view.phase) return;
  const live = view.phase === 'live';
  const status = doc.querySelector('[data-event-status]');
  if (status) status.textContent = live ? ' · Live' : ' · Results';
  const line = doc.querySelector<HTMLElement>('[data-live-line]');
  if (line) {
    line.hidden = !(live && view.line);
    line.textContent = live ? view.line : '';
  }
  const tile = doc.querySelector(`.rail a[href="/events/${view.slug}/"]`);
  tile?.classList.toggle('tile-past', !live);
  tile?.classList.toggle('tile-live', live);
}
