// @ts-check
import { defineConfig } from 'astro/config';
import { resolveBuildNow, resolveLiveApi } from './src/lib/build-time.ts';
import { liveMock } from './src/lib/live-mock.ts';
import { resolveDataDir } from './src/lib/data-dir.ts';

const dataDir = resolveDataDir(process.env.DATA_DIR);
// What the pages take as "now" (the current event): this build's start, or BUILD_NOW for fixture builds.
const buildNow = resolveBuildNow(process.env.BUILD_NOW);
// Where the live script polls results (the engine's /v1/): production unless LIVE_API says otherwise.
const liveApi = resolveLiveApi(process.env.LIVE_API);

export default defineConfig({
  output: 'static',
  site: 'https://ufc.xlobax.com',
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'always' },
  vite: {
    define: {
      __DATA_DIR__: JSON.stringify(dataDir),
      __BUILD_NOW__: JSON.stringify(buildNow),
      __LIVE_API__: JSON.stringify(liveApi),
      __LIVE_DEV__: 'false', // the dev server's live mock turns it on
    },
    // `astro dev` only: /__live-mock/ replays a finished card on top of data/ (open a page with ?live-api=/__live-mock).
    plugins: [liveMock(dataDir, process.env.LIVE_MOCK_DIR ?? 'tests/fixtures/live-final')],
    resolve: { alias: { '@data': dataDir } },
    server: { fs: { allow: ['.', dataDir] } },
  },
});
