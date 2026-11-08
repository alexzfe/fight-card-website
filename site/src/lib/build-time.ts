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
