// @ts-check
import { defineConfig } from 'astro/config';
import { resolveDataDir } from './src/lib/data-dir.ts';

const dataDir = resolveDataDir(process.env.DATA_DIR);

export default defineConfig({
  output: 'static',
  site: 'https://ufc.xlobax.com',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'always' },
  vite: {
    resolve: { alias: { '@data': dataDir } },
    server: { fs: { allow: ['.', dataDir] } },
  },
});
