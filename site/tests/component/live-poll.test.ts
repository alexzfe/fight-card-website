// The card LivePoll embeds for the live script: its fights must come in the order the page shows them (the "Live now"
// pick reads running order from it), main event first, even when ufcstats appended a late addition to its list.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { Window } from 'happy-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import LivePoll from '../../src/components/LivePoll.astro';
import { liveNowId, parseLiveEvent } from '../../src/lib/live';
import type { Event, Fight, Fighter } from '../../src/lib/schema';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const RESULT = { winner: 'r', method: 'KO/TKO', round: 1, time: '1:00' };
const bout = (id: string, segment: Fight['segment'], decided = false): Fight => ({
  id,
  red: 'r',
  blue: 'b',
  title_fight: false,
  segment,
  result: decided ? RESULT : null,
});
const fighter = (id: string): Fighter => ({
  id,
  name: id,
  record: { w: 1, l: 0, d: 0, nc: 0 },
  elo_provisional: false,
  elo_inactive: false,
});

// Early prelims E1, E2 are done; LATE (a prelim added late, listed last) is in the cage.
const event: Event = {
  id: 'bbbb1111bbbb1111',
  slug: 'ufc-fight-night-live-vs-wire',
  name: 'UFC Fight Night: Live vs. Wire',
  date: '2026-11-07',
  location: null,
  status: 'completed',
  fights: [
    bout('ME', 'main'),
    bout('M2', 'main'),
    bout('P1', 'prelims'),
    bout('E1', 'early_prelims', true),
    bout('E2', 'early_prelims', true),
    bout('LATE', 'prelims'),
  ],
};

async function embedded() {
  const html = await container.renderToString(LivePoll, {
    props: { event, fighters: { r: fighter('r'), b: fighter('b') }, since: '2026-11-08T00:44:00Z' },
  });
  const win = new Window();
  win.document.body.innerHTML = html;
  return JSON.parse(win.document.getElementById('live-card')!.textContent!);
}

describe('LivePoll: the embedded card', () => {
  it('lists the fights as the page shows them, main event first', async () => {
    const card = await embedded();
    expect(card.fights.map((f: { id: string }) => f.id)).toEqual(['ME', 'M2', 'P1', 'LATE', 'E1', 'E2']);
  });
  it('puts "Live now" on the late-added prelim once the early prelims are done', async () => {
    const card = await embedded();
    expect(liveNowId(parseLiveEvent(card, card.id)!.fights)).toBe('LATE');
  });
});
