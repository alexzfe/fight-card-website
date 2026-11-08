// The dev-only live mock (src/lib/live-mock.ts, served by `astro dev` at /__live-mock/): it replays a finished card
// on top of the page's data/, one more bout per step in running order, so the live script can be watched locally.
import { describe, expect, it } from 'vitest';
import { revealResults } from '../../src/lib/live-mock';
import finalCard from '../fixtures/live-final/events/bbbb1111bbbb1111.json';
import staticCard from '../fixtures/live/events/bbbb1111bbbb1111.json';

const decided = (e: { fights: Array<{ id: string; result?: unknown }> }) =>
  e.fights.filter((f) => f.result).map((f) => f.id);

describe('revealResults', () => {
  it('starts from what data/ already has (step 0)', () => {
    expect(decided(revealResults(staticCard, finalCard, 0))).toEqual(decided(staticCard));
  });
  it('reveals one more bout per step, in running order (the card bottom-up), with its elo', () => {
    const one = revealResults(staticCard, finalCard, 1);
    expect(decided(one)).toEqual(['f000000000000003', 'f000000000000004', 'f000000000000005']);
    expect(one.fights[1]!.elo).toEqual(finalCard.fights[1]!.elo);
    expect(one.fights[0]!.elo ?? null).toBeNull();
    expect(decided(revealResults(staticCard, finalCard, 2))).toHaveLength(4);
    expect(decided(revealResults(staticCard, finalCard, 99))).toHaveLength(4);
  });
  it('does not mutate its inputs', () => {
    revealResults(staticCard, finalCard, 2);
    expect(decided(staticCard)).toHaveLength(2);
    expect(decided(finalCard)).toHaveLength(4);
  });
});
