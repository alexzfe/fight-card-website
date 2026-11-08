// The live row and the static row come from the same code: render FightRow for a bout before and after its result
// (Astro's container API, the same components the build uses), apply the result live to the upcoming row in a DOM
// (src/lib/live-row.ts), and the patched row must match the server-built completed row: same elements, classes,
// attributes and text.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { Window } from 'happy-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import FightRow from '../../src/components/FightRow.astro';
import { liveFightView, type LiveFight } from '../../src/lib/live';
import { applyFight } from '../../src/lib/live-row';
import { eloTags } from '../../src/lib/format';
import type { Event, Fight, Fighter, Result } from '../../src/lib/schema';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const fighter = (id: string, name: string, extra: Partial<Fighter> = {}): Fighter => ({
  id,
  name,
  record: { w: 10, l: 2, d: 0, nc: 0 },
  elo_provisional: false,
  elo_inactive: false,
  height_in: 70,
  reach_in: 72,
  stance: 'Orthodox',
  dob: '1995-03-04',
  recent_fights: [{ result: 'win', opponent: 'Old Foe', method: 'KO/TKO', round: 1, event: 'UFC 300', date: '2026-04-13' }],
  ...extra,
});

// a1a1… is #1 in the fixtures' rankings.json, so its today's rank is a link, as on the real site.
const RED = fighter('a1a1a1a1a1a1a1a1', 'Alex Alpha', { elo: 1640, elo_peak: 1700, p4p_rank: 1, elo_inactive: true });
const BLUE = fighter('b2b2b2b2b2b2b2b2', 'Bruno Bravo', { elo: 1580, elo_provisional: true });
// Fighters without today's Elo: the upcoming row has no Elo line at all, the completed one shows the Elo going in.
const NEW_RED = fighter('a1a1a1a1a1a1a1a1', 'Alex Alpha', { elo: null, elo_provisional: true });
const NEW_BLUE = fighter('b2b2b2b2b2b2b2b2', 'Bruno Bravo', { elo: null });

const ELO = { red_pre: 1612, red_delta: 26, blue_pre: 1588, blue_delta: -26, red_p4p_rank: 4, blue_p4p_rank: null };

const base: Fight = {
  id: 'f000000000000002',
  red: RED.id,
  blue: BLUE.id,
  weight_class: 'Welterweight',
  title_fight: false,
  finish_tier: 'medium',
  segment: 'main',
  tier_frozen_at: '2026-11-07T22:00:00Z',
  result: null,
  elo: null,
};

const event = (fight: Fight): Event => ({
  id: 'bbbb1111bbbb1111',
  slug: 'ufc-fight-night-live-vs-wire',
  name: 'UFC Fight Night: Live vs. Wire',
  date: '2026-11-07',
  location: 'Las Vegas',
  status: 'completed',
  fights: [fight],
});

type RowProps = { mainEvent?: boolean; finishLabel?: boolean };

async function render(fight: Fight, fighters: Fighter[], props: RowProps) {
  const html = await container.renderToString(FightRow, {
    props: { fight, event: event(fight), fighters: Object.fromEntries(fighters.map((f) => [f.id, f])), ...props },
  });
  const win = new Window();
  win.document.body.innerHTML = `<ul>${html}</ul>`;
  return win.document.querySelector('li.fight') as unknown as HTMLElement;
}

/** A node as a comparable tree: tag, sorted attributes, children; whitespace-only text dropped, other text collapsed. */
function canon(node: Node): unknown {
  if (node.nodeType === 3) {
    const text = node.textContent!.replace(/\s+/g, ' ');
    return text.trim() ? text : null;
  }
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  const attrs = [...el.attributes].map((a) => `${a.name}=${a.value}`).sort();
  return [el.tagName.toLowerCase(), attrs, [...el.childNodes].map(canon).filter((c) => c != null)];
}

const visible = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ').trim();

// Before the card is rebuilt, the form going into the fight is today's last fights: the rebuild brings the real one.
const formOf = ([red, blue]: Fighter[]) => ({ red: red!.recent_fights ?? [], blue: blue!.recent_fights ?? [] });

// The Elo tags the page embeds for each corner (the live card JSON), for a row that gains its Elo line live.
const tagsOf = ([red, blue]: Fighter[]) => ({ red: eloTags(red!), blue: eloTags(blue!) });

const live = (fight: Fight): LiveFight => ({
  id: fight.id,
  red: fight.red,
  blue: fight.blue,
  result: fight.result ?? null,
  elo: fight.elo ?? null,
});

const cases: Array<[string, Partial<Fight>, Fighter[], RowProps]> = [
  [
    'red wins by KO, main event, title fight, with Elo and a P4P rank going in',
    { result: { winner: RED.id, method: 'KO/TKO', round: 2, time: '4:54', outcome: 'win' }, elo: ELO, title_fight: true },
    [RED, BLUE],
    { mainEvent: true, finishLabel: true },
  ],
  [
    'blue wins a decision on an unscored bout (no finish badge left)',
    { result: { winner: BLUE.id, method: 'U-DEC', round: 3, time: '5:00' }, elo: ELO, finish_tier: null },
    [RED, BLUE],
    { finishLabel: true },
  ],
  [
    'a draw: no winner, no loser, no Elo change',
    {
      result: { winner: null, method: 'M-DEC', round: 3, time: '5:00', outcome: 'draw' },
      elo: { ...ELO, red_delta: 0, blue_delta: 0 },
    },
    [RED, BLUE],
    {},
  ],
  ['a result known only by its winner, before the Elo', { result: { winner: BLUE.id } as Result }, [RED, BLUE], {}],
  [
    'a result without the Elo yet: today’s Elo stays',
    { result: { winner: RED.id, method: 'SUB', round: 1, time: '2:02' } },
    [RED, BLUE],
    {},
  ],
  [
    'fighters without today’s Elo: the Elo going in appears, with its tags',
    { result: { winner: RED.id, method: 'SUB', round: 1, time: '2:02' }, elo: ELO },
    [NEW_RED, NEW_BLUE],
    {},
  ],
];

describe('applyFight matches the server-built completed row', () => {
  it.each(cases)('%s', async (_, change, fighters, props) => {
    const done = { ...base, form: formOf(fighters), ...change };
    const upcoming = { ...done, result: null, elo: null, form: null };
    const row = await render(upcoming, fighters, props);
    const server = await render(done, fighters, props);
    expect(row.classList.contains('done')).toBe(false);
    applyFight(row, liveFightView(live(done), tagsOf(fighters)));
    expect(visible(row)).toBe(visible(server));
    expect(canon(row)).toEqual(canon(server));
  });

  it('applies the Elo later, when it arrives after the result', async () => {
    const result = { winner: RED.id, method: 'KO/TKO', round: 2, time: '4:54' };
    const row = await render(base, [RED, BLUE], {});
    applyFight(row, liveFightView(live({ ...base, result }), tagsOf([RED, BLUE])));
    applyFight(row, liveFightView(live({ ...base, result, elo: ELO }), tagsOf([RED, BLUE])));
    const server = await render({ ...base, result, elo: ELO, form: formOf([RED, BLUE]) }, [RED, BLUE], {});
    expect(canon(row)).toEqual(canon(server));
  });

  it('is idempotent, and never touches a row the server built completed', async () => {
    const result = { winner: RED.id, method: 'KO/TKO', round: 2, time: '4:54' };
    const done = { ...base, result, elo: ELO, form: formOf([RED, BLUE]) };
    const server = await render(done, [RED, BLUE], {});
    const before = canon(server);
    applyFight(server, liveFightView(live(done), tagsOf([RED, BLUE])));
    applyFight(server, liveFightView(live({ ...done, result: { winner: BLUE.id, method: 'SUB' } }), tagsOf([RED, BLUE])));
    expect(canon(server)).toEqual(before);
  });

  it('leaves an upcoming row alone when the bout still has no result', async () => {
    const row = await render(base, [RED, BLUE], {});
    const before = canon(row);
    applyFight(row, liveFightView(live({ ...base, elo: ELO }), tagsOf([RED, BLUE])));
    expect(canon(row)).toEqual(before);
  });
});
