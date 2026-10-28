import { describe, expect, it } from 'vitest';
import {
  ageAt,
  chipDate,
  eventTile,
  formatDate,
  formatHeight,
  formatLongDate,
  formatReach,
  eloTags,
  eloTip,
  tagTip,
  formatElo,
  formatDelta,
  eloAtFight,
  AT_FIGHT_TIP,
  formatBestWin,
  formatRecord,
  formatPastFight,
  formatResult,
  initials,
  resultLetter,
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

describe('formatElo', () => {
  it('labels a rating', () => {
    expect(formatElo(1612)).toBe('Elo 1612');
  });
  it('is null when unknown', () => {
    expect(formatElo(null)).toBeNull();
    expect(formatElo(undefined)).toBeNull();
  });
  it('adds the P4P rank when there is one', () => {
    expect(formatElo(1690, 4)).toBe('Elo 1690 · #4 P4P');
  });
  it('leaves the rank out when unranked', () => {
    expect(formatElo(1690, null)).toBe('Elo 1690');
    expect(formatElo(1690, undefined)).toBe('Elo 1690');
  });
  it('is null when unknown, even with a rank', () => {
    expect(formatElo(null, 4)).toBeNull();
  });
});

describe('formatDelta', () => {
  it('signs a gain with a plus', () => {
    expect(formatDelta(26)).toBe('+26');
  });
  it('signs a loss with a real minus sign, as the site writes numbers', () => {
    expect(formatDelta(-14)).toBe('\u221214');
  });
  it('writes no change (a no contest) as ±0', () => {
    expect(formatDelta(0)).toBe('±0');
  });
});

describe('eloAtFight', () => {
  const elo = { red_pre: 1548, red_delta: 26, blue_pre: 1580, blue_delta: -26, red_p4p_rank: 4, blue_p4p_rank: null };
  it("gives a corner's Elo going in, the bout's change and the P4P rank then", () => {
    expect(eloAtFight({ elo }, 'red')).toEqual({ elo: 'Elo 1548', delta: '+26', rank: '#4 P4P' });
  });
  it('has no rank when the fighter was unranked going in', () => {
    expect(eloAtFight({ elo }, 'blue')).toEqual({ elo: 'Elo 1580', delta: '\u221226', rank: null });
    const { blue_p4p_rank, ...noRank } = elo;
    expect(eloAtFight({ elo: noRank }, 'blue')!.rank).toBeNull();
  });
  it('is null without Elo at the time (upcoming, unrated, or data before contract 1.3)', () => {
    expect(eloAtFight({ elo: null }, 'red')).toBeNull();
    expect(eloAtFight({}, 'blue')).toBeNull();
  });
  it('explains itself in one short tip', () => {
    expect(AT_FIGHT_TIP).toBe('Elo going into this fight, and the change from it');
  });
});

describe('formatBestWin', () => {
  it('names the opponent over their rating and the month', () => {
    expect(formatBestWin({ opponent_id: 'x', opponent: 'Glover Teixeira', elo: 1684, date: '2022-06-11' })).toEqual({
      opponent: 'Glover Teixeira',
      meta: 'Elo 1684 · Jun 2022',
    });
  });
  it('is null without a win', () => {
    expect(formatBestWin(null)).toBeNull();
    expect(formatBestWin(undefined)).toBeNull();
  });
});

describe('eloTags', () => {
  it('names each tag that applies, provisional first', () => {
    expect(eloTags({ elo_provisional: true, elo_inactive: true })).toEqual(['provisional', 'inactive']);
    expect(eloTags({ elo_provisional: false, elo_inactive: true })).toEqual(['inactive']);
  });
  it('is empty when neither applies', () => {
    expect(eloTags({ elo_provisional: false, elo_inactive: false })).toEqual([]);
  });
});

describe('eloTip', () => {
  const win = { opponent_id: 'x', opponent: 'Chris Duncan', elo: 1634, date: '2026-04-11' };
  it('names the peak and the best win', () => {
    expect(eloTip({ elo_peak: 1659, best_win: win })).toBe('Peak 1659 · Best win: Chris Duncan (1634)');
  });
  it('gives whichever one is known', () => {
    expect(eloTip({ elo_peak: 1793, best_win: null })).toBe('Peak 1793');
    expect(eloTip({ elo_peak: null, best_win: win })).toBe('Best win: Chris Duncan (1634)');
  });
  it('is null when neither is known', () => {
    expect(eloTip({ elo_peak: undefined, best_win: undefined })).toBeNull();
  });
});

describe('tagTip', () => {
  it('says what each tag means', () => {
    expect(tagTip('provisional')).toBe('Fewer than 3 UFC fights');
    expect(tagTip('inactive')).toBe('No fight in the last 12 months');
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

describe('eventTile', () => {
  it('shows the date and number of a numbered event over its headliners', () => {
    expect(eventTile({ name: 'UFC 323: Alpha vs. Bravo', date: '2026-10-31', status: 'upcoming' })).toEqual({
      meta: 'Oct 31 · UFC 323',
      headline: 'Alpha vs. Bravo',
    });
  });
  it('drops the "UFC Fight Night" prefix, which says nothing', () => {
    expect(eventTile({ name: 'UFC Fight Night: Kilo vs. Lima', date: '2026-11-14', status: 'upcoming' })).toEqual({
      meta: 'Nov 14',
      headline: 'Kilo vs. Lima',
    });
  });
  it('keeps other prefixes', () => {
    expect(eventTile({ name: 'Noche UFC: Lopes vs. Silva', date: '2026-09-12', status: 'upcoming' }).meta).toBe(
      'Sep 12 · Noche UFC',
    );
  });
  it('marks a completed event as results', () => {
    expect(eventTile({ name: 'UFC Fight Night: Golf vs. Hotel', date: '2026-10-18', status: 'completed' })).toEqual({
      meta: 'Oct 18 · Results',
      headline: 'Golf vs. Hotel',
    });
  });
  it('uses the whole name as the headline when there is no colon', () => {
    expect(eventTile({ name: 'UFC Apex Special', date: '2026-11-01', status: 'upcoming' })).toEqual({
      meta: 'Nov 1',
      headline: 'UFC Apex Special',
    });
  });
});

describe('resultLetter', () => {
  it('abbreviates past results', () => {
    expect(['win', 'loss', 'draw', 'nc'].map((r) => resultLetter(r as never))).toEqual(['W', 'L', 'D', 'NC']);
  });
});

describe('formatPastFight', () => {
  const fight = { result: 'win', opponent: 'Dan Delta', method: 'KO/TKO', round: 1, time: '2:10', event: 'UFC 318', date: '2026-06-13' } as const;
  it('shows method, round and month', () => {
    expect(formatPastFight(fight)).toBe('KO/TKO R1 · Jun 2026');
  });
  it('drops missing parts', () => {
    expect(formatPastFight({ ...fight, method: null, round: null, date: null })).toBe('');
  });
});
