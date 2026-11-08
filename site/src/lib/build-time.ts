const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

/**
 * The instant the build renders "now" at, as an ISO string: BUILD_NOW (ISO 8601 UTC) when set, so fixture builds are
 * deterministic, else the clock. A malformed BUILD_NOW fails the build rather than falling back to the clock.
 */
export function resolveBuildNow(env: string | undefined, clock: Date = new Date()): string {
  if (!env) return clock.toISOString();
  const t = Date.parse(env);
  if (!ISO_UTC.test(env) || Number.isNaN(t)) throw new Error(`BUILD_NOW must be an ISO 8601 UTC timestamp, got ${env}`);
  return new Date(t).toISOString();
}

/** Where the browser polls live results: the engine's production API unless LIVE_API says otherwise. */
export const DEFAULT_LIVE_API = 'https://ufc-data.xlobax.com';
const LIVE_API = /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?\/?$/;

/**
 * The live script's API origin (no trailing slash): LIVE_API when set, an https origin or a local http one, else
 * production. Staging and prod run the same image, so a build can't tell them apart; both poll production, where
 * the site's data comes from too. Anything else fails the build.
 */
export function resolveLiveApi(env: string | undefined): string {
  if (!env) return DEFAULT_LIVE_API;
  if (!LIVE_API.test(env)) throw new Error(`LIVE_API must be an https origin (or http://localhost), got ${env}`);
  return env.replace(/\/$/, '');
}
