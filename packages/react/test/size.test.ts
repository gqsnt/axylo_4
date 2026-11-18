/**
 * Size budget (task brief): the adapter, minified and gzipped with react, react-dom and axylo external, is at
 * most 2 KiB. Measured on the production flavour (__DEV__ false) and, for information, the development one.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const entry = path.resolve(import.meta.dirname, '../src/index.ts');

async function gzipped(development: boolean): Promise<{ raw: number; gzip: number }> {
  const result = await build({
    entryPoints: [entry], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'axylo'], define: { __DEV__: String(development) },
  });
  const code = result.outputFiles[0]!.contents;
  if (/axylo-figure|ResizeObserver/.test(new TextDecoder().decode(code))) throw new Error('the core was bundled into the adapter');
  return { raw: code.length, gzip: gzipSync(code, { level: 9 }).length };
}

describe('size', () => {
  it('production build is at most 2 KiB gzipped', async () => {
    const production = await gzipped(false);
    const development = await gzipped(true);
    console.info(`@axylo/react: production ${production.raw} B min, ${production.gzip} B gzip; development ${development.raw} B min, ${development.gzip} B gzip`);
    expect(production.gzip).toBeLessThanOrEqual(2048);
  });
});
