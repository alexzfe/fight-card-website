import { describe, expect, it } from 'vitest';
import { resolveBuildNow, resolveLiveApi } from '../../src/lib/build-time';

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

describe('resolveLiveApi', () => {
  it('defaults to the production engine API', () => {
    expect(resolveLiveApi(undefined)).toBe('https://ufc-data.xlobax.com');
    expect(resolveLiveApi('')).toBe('https://ufc-data.xlobax.com');
  });
  it('takes LIVE_API (an https origin, or a local http one), without a trailing slash', () => {
    expect(resolveLiveApi('https://ufc-data-staging.xlobax.com/')).toBe('https://ufc-data-staging.xlobax.com');
    expect(resolveLiveApi('http://localhost:8080')).toBe('http://localhost:8080');
    expect(resolveLiveApi('http://127.0.0.1:9000/')).toBe('http://127.0.0.1:9000');
  });
  it('rejects anything else, failing the build', () => {
    for (const bad of ['ufc-data.xlobax.com', 'http://ufc-data.xlobax.com', 'https://x.com/v1/', 'javascript:alert(1)']) {
      expect(() => resolveLiveApi(bad), bad).toThrow(/LIVE_API/);
    }
  });
});
