import { describe, expect, it } from 'vitest';
import {
  ageAt,
  chipDate,
  chipLabel,
  formatDate,
  formatHeight,
  formatLongDate,
  formatReach,
  formatRecord,
  formatResult,
  initials,
  tierLabel,
} from '../../src/lib/format';

describe('formatRecord', () => {
  it('formats w-l-d', () => {
    expect(formatRecord({ w: 21, l: 4, d: 0, nc: 0 })).toBe('21-4-0');
  });
  it('appends no-contests when nc > 0', () => {
    expect(formatRecord({ w: 18, l: 2, d: 1, nc: 1 })).toBe('18-2-1 (1 NC)');
  });
  it('handles a debut record', () => {
    expect(formatRecord({ w: 0, l: 0, d: 0, nc: 0 })).toBe('0-0-0');
  });
});

describe('formatHeight', () => {
  it('converts inches to feet and inches', () => {
    expect(formatHeight(71)).toBe(`5'11"`);
  });
  it('handles an exact foot', () => {
    expect(formatHeight(72)).toBe(`6'0"`);
  });
  it('rounds fractional inches', () => {
    expect(formatHeight(70.6)).toBe(`5'11"`);
  });
  it('rounds up into the next foot without showing 12 inches', () => {
    expect(formatHeight(71.6)).toBe(`6'0"`);
  });
  it('renders a dash when unknown', () => {
    expect(formatHeight(null)).toBe('—');
  });
});

describe('formatReach', () => {
  it('formats whole inches', () => {
    expect(formatReach(72)).toBe('72"');
  });
  it('keeps half inches', () => {
    expect(formatReach(75.5)).toBe('75.5"');
  });
  it('renders a dash when unknown', () => {
    expect(formatReach(null)).toBe('—');
  });
});

describe('ageAt', () => {
  it('counts full years at the event date', () => {
    expect(ageAt('1992-11-01', '2026-10-31')).toBe(33);
  });
  it('includes the birthday itself', () => {
    expect(ageAt('1992-10-31', '2026-10-31')).toBe(34);
  });
  it('handles a birthday later in the month', () => {
    expect(ageAt('1994-03-15', '2026-03-14')).toBe(31);
  });
  it('returns null when dob is unknown', () => {
    expect(ageAt(null, '2026-10-31')).toBeNull();
  });
});

describe('formatResult', () => {
  it('formats method, round and time', () => {
    expect(formatResult({ winner: 'x', method: 'KO/TKO', round: 1, time: '4:12' })).toBe('KO/TKO R1 4:12');
  });
  it('skips missing parts', () => {
    expect(formatResult({ winner: null, method: 'Draw', round: null, time: null })).toBe('Draw');
  });
  it('returns null when there is no result', () => {
    expect(formatResult(null)).toBeNull();
    expect(formatResult(undefined)).toBeNull();
  });
  it('returns null for an empty result', () => {
    expect(formatResult({ winner: null, method: null, round: null, time: null })).toBeNull();
  });
});

describe('tierLabel', () => {
  it.each([
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
  ] as const)('labels %s as %s', (tier, label) => {
    expect(tierLabel(tier)).toBe(label);
  });
  it('renders null as a dash', () => {
    expect(tierLabel(null)).toBe('—');
  });
});

describe('initials', () => {
  it('uses first and last name', () => {
    expect(initials('Alex Alpha')).toBe('AA');
  });
  it('uses first and last of several names', () => {
    expect(initials('Jose Luis de la Cruz')).toBe('JC');
  });
  it('handles a single name', () => {
    expect(initials('Shogun')).toBe('S');
  });
  it('handles empty input', () => {
    expect(initials('  ')).toBe('?');
  });
});

describe('dates', () => {
  it('formats a chip date without timezone drift', () => {
    expect(chipDate('2026-11-01')).toBe('Nov 1');
  });
  it('formats a plain date', () => {
    expect(formatDate('2026-10-01')).toBe('Oct 1, 2026');
  });
  it('formats a long date', () => {
    expect(formatLongDate('2026-10-31')).toBe('Sat, Oct 31, 2026');
  });
});

describe('chipLabel', () => {
  it('shortens numbered events', () => {
    expect(chipLabel('UFC 323: Alpha vs. Bravo')).toBe('UFC 323');
  });
  it('shortens fight nights', () => {
    expect(chipLabel('UFC Fight Night: Kilo vs. Lima')).toBe('Fight Night');
  });
  it('keeps the prefix of other names', () => {
    expect(chipLabel('Noche UFC: Lopes vs. Silva')).toBe('Noche UFC');
  });
  it('keeps names without a colon', () => {
    expect(chipLabel('UFC Apex Special')).toBe('UFC Apex Special');
  });
});
