import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The documentation's tests, with the same split as the root vitest.config.ts: unit tests in Node, and
// browser tests (*.browser.test.ts) against the built library and site when AXYLO_BROWSER is set. The root
// config does not include apps/docs yet; until it does, run these with `--config apps/docs/vitest.config.ts`.
export default defineConfig({
  define: { __DEV__: 'true' },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    // The Node examples import the package by name, so they run with the browser suite, after the build.
    include: process.env.AXYLO_BROWSER
      ? ['apps/docs/test/**/*.browser.test.ts', 'apps/docs/examples/node/*.test.ts']
      : ['apps/docs/test/**/*.test.ts'],
    exclude: process.env.AXYLO_BROWSER ? ['**/node_modules/**'] : ['**/node_modules/**', '**/*.browser.test.ts'],
    testTimeout: process.env.AXYLO_BROWSER ? 60000 : 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
