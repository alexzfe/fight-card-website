import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Two projects: plain unit and build tests, and component tests that need Astro's Vite setup to render .astro
    // files (vitest.component.config.ts). One run, one coverage report.
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'tests/build/**/*.test.ts'] } },
      './vitest.component.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
