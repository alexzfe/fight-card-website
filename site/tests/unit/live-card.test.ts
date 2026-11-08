// @vitest-environment happy-dom
// The card-level bits of the live page (src/lib/live-row.ts): the "Live now" marker, the header's Live/Results word,
// the "Live · updated N min ago" line and the rail tile. The rows themselves are checked against the server-built
// markup in tests/component/live-row.test.ts; the real page end to end in tests/e2e/live.spec.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { markLiveNow, renderCard } from '../../src/lib/live-row';

beforeEach(() => {
  document.body.innerHTML = `
    <nav><ul class="rail"><li><a class="tile tile-past" href="/events/live-card/">Live card</a></li>
      <li><a class="tile tile-past" href="/events/old-card/">Old card</a></li></ul></nav>
    <p class="event-meta">Sat, Nov 7, 2026 · Las Vegas<span data-event-status> · Results</span></p>
    <p class="live-line" data-live-line hidden></p>
    <ul>
      <li class="fight" data-fight-id="a"><div class="bout"><div class="mid"><span class="main-event-marker">Main event</span><span>Welterweight</span></div></div></li>
      <li class="fight" data-fight-id="b"><div class="bout"><div class="mid"><span>Welterweight</span></div></div></li>
    </ul>`;
});

const markers = () => [...document.querySelectorAll('[data-testid="live-now"]')];
const tile = (slug: string) => document.querySelector(`a[href="/events/${slug}/"]`)!;

describe('markLiveNow', () => {
  it('marks one bout, after its main-event marker, and moves the mark', () => {
    markLiveNow(document, 'b');
    expect(markers()).toHaveLength(1);
    expect(markers()[0]!.closest('li')!.dataset.fightId).toBe('b');
    expect(markers()[0]!.textContent).toBe('Live now');
    markLiveNow(document, 'a');
    expect(markers()).toHaveLength(1);
    const mid = document.querySelector('[data-fight-id="a"] .mid')!;
    expect(mid.children[1]).toBe(markers()[0]);
  });
  it('clears the mark with no bout, or a bout the page does not have', () => {
    markLiveNow(document, 'b');
    markLiveNow(document, null);
    expect(markers()).toHaveLength(0);
    markLiveNow(document, 'zz');
    expect(markers()).toHaveLength(0);
  });
});

describe('renderCard', () => {
  it('reads as live: header word, updated line, rail tile no longer past', () => {
    renderCard(document, { phase: 'live', line: 'Live · updated 3 min ago', slug: 'live-card' });
    expect(document.querySelector('[data-event-status]')!.textContent).toBe(' · Live');
    const line = document.querySelector<HTMLElement>('[data-live-line]')!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe('Live · updated 3 min ago');
    expect(tile('live-card').classList.contains('tile-past')).toBe(false);
    expect(tile('live-card').classList.contains('tile-live')).toBe(true);
    expect(tile('old-card').classList.contains('tile-past')).toBe(true);
  });
  it('reads as finished once complete: Results, no line, past tile', () => {
    renderCard(document, { phase: 'live', line: 'Live · updated just now', slug: 'live-card' });
    renderCard(document, { phase: 'results', line: null, slug: 'live-card' });
    expect(document.querySelector('[data-event-status]')!.textContent).toBe(' · Results');
    expect(document.querySelector<HTMLElement>('[data-live-line]')!.hidden).toBe(true);
    expect(tile('live-card').classList.contains('tile-past')).toBe(true);
    expect(tile('live-card').classList.contains('tile-live')).toBe(false);
  });
  it('leaves the page as built before the first result', () => {
    const before = document.body.innerHTML;
    renderCard(document, { phase: null, line: null, slug: 'live-card' });
    expect(document.body.innerHTML).toBe(before);
  });
});
