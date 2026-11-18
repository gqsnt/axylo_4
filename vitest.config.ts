import { defineConfig } from 'vitest/config';

// Unit and property tests run in Node. Browser tests (*.browser.test.ts) drive system Chrome through
// Playwright against the built bundle: run `npm run build` first, then `npm run test:browser`.
export default defineConfig({
  define: { __DEV__: 'true' },
  test: {
    include: process.env.AXYLO_BROWSER
      ? ['packages/*/test/**/*.browser.test.ts', 'apps/docs/test/**/*.browser.test.ts', 'apps/docs/examples/node/*.test.ts']
      : ['packages/*/test/**/*.test.ts', 'apps/docs/test/**/*.test.ts'],
    exclude: process.env.AXYLO_BROWSER ? ['**/node_modules/**'] : ['**/node_modules/**', '**/*.browser.test.ts'],
    testTimeout: process.env.AXYLO_BROWSER ? 60000 : 10000,
    fileParallelism: !process.env.AXYLO_BROWSER,
  },
});
