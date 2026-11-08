// Component tests: they render .astro components with Astro's container API, so they need Astro's Vite setup
// (getViteConfig), which the plain unit config (vitest.config.ts) doesn't load. Their data/ is the main fixtures.
import { getViteConfig } from 'astro/config';

process.env.DATA_DIR ??= 'tests/fixtures/data';
process.env.BUILD_NOW ??= '2026-10-24T06:00:00Z';

export default getViteConfig({ test: { include: ['tests/component/**/*.test.ts'] } } as Parameters<typeof getViteConfig>[0]);
