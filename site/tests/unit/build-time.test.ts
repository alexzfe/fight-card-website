import { describe, expect, it } from 'vitest';
import { resolveBuildNow } from '../../src/lib/build-time';

describe('resolveBuildNow', () => {
  const clock = new Date('2026-11-08T12:30:00Z');
  it('is the clock when BUILD_NOW is unset or empty', () => {
    expect(resolveBuildNow(undefined, clock)).toBe('2026-11-08T12:30:00.000Z');
    expect(resolveBuildNow('', clock)).toBe('2026-11-08T12:30:00.000Z');
  });
  it('pins the build to BUILD_NOW (ISO 8601 UTC), for fixture builds', () => {
    expect(resolveBuildNow('2026-11-08T00:44:00Z', clock)).toBe('2026-11-08T00:44:00.000Z');
  });
  it('rejects a BUILD_NOW that is not an ISO UTC timestamp, rather than silently using the clock', () => {
    expect(() => resolveBuildNow('tomorrow', clock)).toThrow(/BUILD_NOW/);
    expect(() => resolveBuildNow('2026-11-08', clock)).toThrow(/BUILD_NOW/);
    expect(() => resolveBuildNow('2026-13-40T00:00:00Z', clock)).toThrow(/BUILD_NOW/);
  });
});
