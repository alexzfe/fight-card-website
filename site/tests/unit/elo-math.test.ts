import { describe, expect, it } from 'vitest';
import { decay, eloChange, expectedScore, kFactor } from '../../src/lib/elo-math';

describe('expectedScore', () => {
  it('is even for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });
  it('gives a 100-point favourite about 64%', () => {
    expect(expectedScore(1600, 1500)).toBeCloseTo(0.6401, 4);
    expect(expectedScore(1500, 1600)).toBeCloseTo(0.3599, 4);
  });
});

describe('kFactor', () => {
  it('starts near 144 for a debut and shrinks with experience', () => {
    expect(kFactor(0)).toBeCloseTo(144.46, 2);
    expect(kFactor(10)).toBeCloseTo(93.09, 2);
    expect(kFactor(30)).toBeLessThan(kFactor(10));
  });
});

describe('decay', () => {
  it('pulls 10% of the distance to 1500 per idle year', () => {
    expect(decay(1700, 0)).toBe(1700);
    expect(decay(1700, 1)).toBeCloseTo(1680, 9);
    expect(decay(1700, 2)).toBeCloseTo(1662, 9);
    expect(decay(1300, 1)).toBeCloseTo(1320, 9);
  });
});

describe('eloChange', () => {
  it('is K times the surprise', () => {
    // 1600 with 12 prior bouts beats 1500: K 88.5, expected .640, so about +32.
    expect(eloChange(1600, 1500, 12, 1)).toBeCloseTo(kFactor(12) * (1 - expectedScore(1600, 1500)), 9);
    expect(eloChange(1600, 1500, 12, 1)).toBeCloseTo(31.9, 1);
  });
  it('costs a clear favourite points on a split-decision win', () => {
    expect(eloChange(1600, 1500, 12, 0.6)).toBeLessThan(0);
  });
});
