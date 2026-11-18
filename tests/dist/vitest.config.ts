import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tests of the packed distribution (plan M7). They need a built packages/*/dist; the global setup packs it
// (scripts/pack.mjs --no-build) and installs the tarballs into tests/dist/fixtures before any test runs, so
// every run tests exactly what `npm pack` produces from the dist at that moment. Browser tests
// (*.browser.test.ts) are selected with AXYLO_BROWSER=1, as in the root config.
const browser = !!process.env.AXYLO_BROWSER;
export default defineConfig({
  root: path.resolve(import.meta.dirname, '../..'),
  test: {
    include: browser ? ['tests/dist/**/*.browser.test.ts'] : ['tests/dist/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/dist/fixtures/**', 'tests/dist/.packed/**', ...(browser ? [] : ['**/*.browser.test.ts'])],
    globalSetup: ['tests/dist/setup.ts'],
    testTimeout: browser ? 60000 : 30000,
    hookTimeout: 120000,
    fileParallelism: !browser,
  },
});
