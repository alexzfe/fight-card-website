import { describe, expect, it } from 'vitest';
import { groupBySegment, runningOrder, segmentLabel } from '../../src/lib/card';
import type { Fight } from '../../src/lib/schema';

const fight = (id: string, segment?: Fight['segment']): Fight => ({
  id,
  red: 'r',
  blue: 'b',
  title_fight: false,
  segment,
});

describe('segmentLabel', () => {
  it('names each card segment', () => {
    expect(segmentLabel('main')).toBe('Main card');
    expect(segmentLabel('prelims')).toBe('Prelims');
    expect(segmentLabel('early_prelims')).toBe('Early prelims');
  });
});

describe('groupBySegment', () => {
  it('groups consecutive fights by segment, keeping card order', () => {
    const groups = groupBySegment([
      fight('1', 'main'),
      fight('2', 'main'),
      fight('3', 'prelims'),
      fight('4', 'early_prelims'),
    ]);
    expect(groups.map((g) => [g.segment, g.fights.map((f) => f.id)])).toEqual([
      ['main', ['1', '2']],
      ['prelims', ['3']],
      ['early_prelims', ['4']],
    ]);
  });
  it('returns one unlabelled group when no fight has a segment', () => {
    const groups = groupBySegment([fight('1'), fight('2', null)]);
    expect(groups).toEqual([{ segment: null, fights: [fight('1'), fight('2', null)] }]);
  });
  it('orders segments main, prelims, early prelims even when the card order interleaves them', () => {
    const groups = groupBySegment([
      fight('1', 'main'),
      fight('2', 'prelims'),
      fight('3', 'main'),
      fight('4', 'early_prelims'),
      fight('5', 'prelims'),
    ]);
    expect(groups.map((g) => [g.segment, g.fights.map((f) => f.id)])).toEqual([
      ['main', ['1', '3']],
      ['prelims', ['2', '5']],
      ['early_prelims', ['4']],
    ]);
  });
  it('collects unknown-segment fights into one trailing group', () => {
    const groups = groupBySegment([fight('1', 'main'), fight('2'), fight('3', 'prelims'), fight('4', null)]);
    expect(groups.map((g) => [g.segment, g.fights.map((f) => f.id)])).toEqual([
      ['main', ['1']],
      ['prelims', ['3']],
      [null, ['2', '4']],
    ]);
  });
  it('returns no groups for an empty card', () => {
    expect(groupBySegment([])).toEqual([]);
  });
});

describe('runningOrder: the card as the page shows it, main event first', () => {
  it('puts a late-added bout in its segment, where the page shows it, not at the end of the list', () => {
    // ufcstats appends late additions: LATE is a prelim listed after every early prelim.
    const card = [
      fight('ME', 'main'),
      fight('M2', 'main'),
      fight('P1', 'prelims'),
      fight('E1', 'early_prelims'),
      fight('E2', 'early_prelims'),
      fight('LATE', 'prelims'),
    ];
    expect(runningOrder(card).map((f) => f.id)).toEqual(['ME', 'M2', 'P1', 'LATE', 'E1', 'E2']);
  });
  it('keeps the main event first, whatever its segment says', () => {
    const card = [fight('ME'), fight('M2', 'main'), fight('P1', 'prelims')];
    expect(runningOrder(card).map((f) => f.id)).toEqual(['ME', 'M2', 'P1']);
  });
  it('is empty for a card without bouts', () => {
    expect(runningOrder([])).toEqual([]);
  });
});
