import { defineConfig, devices } from '@playwright/test';

const PORT = 4329;
// dist-live (npm run build:fixtures:live): the live-night fixtures. `astro preview` only serves the configured outDir,
// so a plain static server serves this one.
const LIVE_PORT = 4330;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      testIgnore: 'live.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}` },
    },
    {
      name: 'live',
      testMatch: 'live.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${LIVE_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npx astro preview --port ${PORT} --ignore-lock`,
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: false,
    },
    {
      command: `python3 -m http.server ${LIVE_PORT} --bind 127.0.0.1 --directory dist-live`,
      url: `http://localhost:${LIVE_PORT}/`,
      reuseExistingServer: false,
    },
  ],
});
