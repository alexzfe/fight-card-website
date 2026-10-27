import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadData } from '../../src/lib/data';
import { provisionalIds, scriptJson, searchRows } from '../../src/lib/rankings';

const rankings = loadData(path.resolve(import.meta.dirname, '../fixtures/data')).rankings!;

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
