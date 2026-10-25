import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** DATA_DIR env (relative to site/) or ../data by default. */
export function resolveDataDir(env: string | undefined, siteRoot: string = SITE_ROOT): string {
  return path.resolve(siteRoot, env || '../data');
}
