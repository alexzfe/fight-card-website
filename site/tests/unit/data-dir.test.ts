import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from '../../src/lib/data-dir';

const siteRoot = '/repo/site';

describe('resolveDataDir', () => {
  it('defaults to ../data relative to site/', () => {
    expect(resolveDataDir(undefined, siteRoot)).toBe(path.resolve('/repo/data'));
  });
  it('treats an empty value as unset', () => {
    expect(resolveDataDir('', siteRoot)).toBe(path.resolve('/repo/data'));
  });
  it('resolves a relative DATA_DIR against site/', () => {
    expect(resolveDataDir('tests/fixtures/data', siteRoot)).toBe('/repo/site/tests/fixtures/data');
  });
  it('keeps an absolute DATA_DIR', () => {
    expect(resolveDataDir('/srv/data', siteRoot)).toBe('/srv/data');
  });
  it('defaults siteRoot to the site package directory', () => {
    expect(resolveDataDir('x')).toBe(path.resolve(import.meta.dirname, '../../x'));
  });
});
