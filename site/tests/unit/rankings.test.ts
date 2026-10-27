import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadData } from '../../src/lib/data';
import { nextBouts, provisionalIds, rankingsHref, scriptJson, searchRows } from '../../src/lib/rankings';
import type { Event } from '../../src/lib/schema';

const data = loadData(path.resolve(import.meta.dirname, '../fixtures/data'));
const rankings = data.rankings!;

describe('searchRows', () => {
  const rows = searchRows(rankings);

  it('keeps the active list in its order, as [name, elo, division, P4P label, provisional]', () => {
    expect(rows).toHaveLength(rankings.active.length);
    expect(rows.map((r) => r[0])).toEqual(rankings.active.map((e) => e.name));
    expect(rows.find((r) => r[0] === 'Eli Echo')).toEqual(['Eli Echo', 1531, 'Lightweight', '', 0]);
  });
  it('labels men and women apart, as their ranks overlap', () => {
    expect(rows.find((r) => r[0] === 'Alex Alpha')![3]).toBe('#1 P4P');
    expect(rows.find((r) => r[0] === 'Dana Delta')![3]).toBe('#1 women’s P4P');
    expect(rows.find((r) => r[0] === 'Nia November')![3]).toBe('#2 women’s P4P');
  });
  it('writes an empty string for no division and no rank, and 1 for provisional', () => {
    expect(rows.find((r) => r[0] === 'Kim Kilo')).toEqual(['Kim Kilo', 1490, '', '', 1]);
  });
  it('adds the event slug and a short label for a fighter booked on an upcoming card, and nothing otherwise', () => {
    const booked = searchRows(rankings, nextBouts(data.events, data.fighters));
    expect(booked.find((r) => r[0] === 'Eli Echo')).toEqual([
      'Eli Echo', 1531, 'Lightweight', '', 0, 'ufc-323-alpha-vs-bravo', 'Oct 31 vs Foxtrot',
    ]);
    expect(booked.find((r) => r[0] === 'Kim Kilo')).toEqual(['Kim Kilo', 1490, '', '', 1]); // a different Kim Kilo is booked
  });
});

describe('nextBouts', () => {
  const bouts = nextBouts(data.events, data.fighters);

  it('gives each booked fighter their soonest upcoming bout: the event slug and "date vs opponent surname"', () => {
    expect(bouts.get('a1a1a1a1a1a1a1a1')).toEqual({ slug: 'ufc-323-alpha-vs-bravo', label: 'Oct 31 vs Bravo' });
    expect(bouts.get('b2b2b2b2b2b2b2b2')).toEqual({ slug: 'ufc-323-alpha-vs-bravo', label: 'Oct 31 vs Alpha' });
    // Kim Kilo is booked on Nov 7 and again on Nov 14.
    expect(bouts.get('e1e1e1e1e1e1e1e1')).toEqual({ slug: 'ufc-fight-night-india-vs-juliet', label: 'Nov 7 vs Lima' });
  });
  it('leaves out completed cards', () => {
    expect(bouts.has('a7a7a7a7a7a7a7a7')).toBe(false); // Gus Golf fought on Oct 18
  });
  it('finds the soonest bout whatever order the events come in', () => {
    const reversed = nextBouts([...data.events].reverse() as Event[], data.fighters);
    expect(reversed.get('e1e1e1e1e1e1e1e1')!.slug).toBe('ufc-fight-night-india-vs-juliet');
  });
});

describe('rankingsHref', () => {
  it('points at the fighter\'s row on the rankings page, men\'s or women\'s', () => {
    expect(rankingsHref(rankings, 'c3c3c3c3c3c3c3c3')).toBe('/rankings/#c3c3c3c3c3c3c3c3');
    expect(rankingsHref(rankings, 'd4d4d4d4d4d4d4d4')).toBe('/rankings/#d4d4d4d4d4d4d4d4');
  });
  it('is null for a fighter with no P4P row, or with no rankings page', () => {
    expect(rankingsHref(rankings, 'e5e5e5e5e5e5e5e5')).toBeNull();
    expect(rankingsHref(null, 'c3c3c3c3c3c3c3c3')).toBeNull();
  });
});

describe('provisionalIds', () => {
  it('lists the fighters rated on fewer than 3 UFC fights', () => {
    expect([...provisionalIds(rankings)].sort()).toEqual(['b4b4b4b4b4b4b4b4', 'j7j7j7j7j7j7j7j7', 'k9k9k9k9k9k9k9k9']);
  });
});

describe('scriptJson', () => {
  it('is JSON that cannot end its <script> block early', () => {
    const text = scriptJson([['</script><b>', 1500, '', '', 0]]);
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual([['</script><b>', 1500, '', '', 0]]);
  });
});
