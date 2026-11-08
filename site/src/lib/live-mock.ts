// Dev only: `astro dev` serves /__live-mock/v1/events/<id>.json, a finished card (LIVE_MOCK_DIR, default
// tests/fixtures/live-final) replayed on top of the page's data/, one more bout every STEP_MS in running order, so the
// live script can be watched locally: open a live card's page with ?live-api=/__live-mock. Never part of a build.
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

type Fight = { id: string; result?: unknown; elo?: unknown };
type Card = { fights: Fight[] };

const STEP_MS = 20_000;

/**
 * `final` with the results data/ already has (`shown`) plus the next `steps` bouts in running order (the card
 * bottom-up), each with its elo; the bouts after those have neither.
 */
export function revealResults<T extends Card>(shown: Card, final: T, steps: number): T {
  const known = new Set(shown.fights.filter((f) => f.result).map((f) => f.id));
  let left = steps;
  const fights = [...final.fights].reverse().map((f) => {
    if (known.has(f.id)) return f;
    if (f.result && left > 0) {
      left -= 1;
      return f;
    }
    return { ...f, result: null, elo: null };
  });
  return { ...final, fights: fights.reverse() };
}

const read = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

export function liveMock(dataDir: string, mockDir: string): Plugin {
  const started = new Map<string, number>(); // event id -> first request, so the replay starts when you look
  return {
    name: 'live-mock',
    apply: 'serve',
    // Lets the live script take ?live-api= (components/LivePoll.astro); a build never gets it.
    config: () => ({ define: { __LIVE_DEV__: 'true' } }),
    configureServer(server) {
      server.middlewares.use('/__live-mock/v1/events/', (req, res, next) => {
        const id = /^\/([a-z0-9]+)\.json$/.exec(req.url ?? '')?.[1];
        const shown = id && read(path.join(dataDir, 'events', `${id}.json`));
        const final = id && read(path.resolve(mockDir, 'events', `${id}.json`));
        if (!id || !shown || !final) return next();
        if (!started.has(id)) started.set(id, Date.now());
        const steps = Math.floor((Date.now() - started.get(id)!) / STEP_MS);
        res.setHeader('content-type', 'application/json');
        res.setHeader('access-control-allow-origin', '*');
        res.end(JSON.stringify(revealResults(shown, final, steps)));
      });
    },
  };
}
