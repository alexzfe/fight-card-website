// @ts-check
import { defineConfig } from 'astro/config';
import { resolveBuildNow } from './src/lib/build-time.ts';
import { resolveDataDir } from './src/lib/data-dir.ts';

const dataDir = resolveDataDir(process.env.DATA_DIR);
// What the pages take as "now" (the current event): this build's start, or BUILD_NOW for fixture builds.
const buildNow = resolveBuildNow(process.env.BUILD_NOW);

export default defineConfig({
  output: 'static',
  site: 'https://ufc.xlobax.com',
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'always' },
  vite: {
    define: { __DATA_DIR__: JSON.stringify(dataDir), __BUILD_NOW__: JSON.stringify(buildNow) },
    resolve: { alias: { '@data': dataDir } },
    server: { fs: { allow: ['.', dataDir] } },
  },
});
