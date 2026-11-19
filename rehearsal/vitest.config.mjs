import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: '.vite',
  test: {
    include: ['test/**/*.test.mjs'],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
