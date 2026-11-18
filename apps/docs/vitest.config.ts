import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The documentation's tests alone, with the same split as the root vitest.config.ts (which includes them
// too): unit tests in Node, and browser tests (*.browser.test.ts) against the packed library and the built
// site when AXYLO_BROWSER is set.
export default defineConfig({
  define: { __DEV__: 'true' },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    // The Node examples run against the packed package, from node.browser.test.ts, after the build.
    include: process.env.AXYLO_BROWSER ? ['apps/docs/test/**/*.browser.test.ts'] : ['apps/docs/test/**/*.test.ts'],
    exclude: process.env.AXYLO_BROWSER ? ['**/node_modules/**'] : ['**/node_modules/**', '**/*.browser.test.ts'],
    testTimeout: process.env.AXYLO_BROWSER ? 60000 : 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
