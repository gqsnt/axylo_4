/**
 * `sideEffects` in each package.json is a promise to bundlers. Two halves are checked:
 * - what the promise buys: a consumer that imports a package and uses nothing gets an empty bundle
 *   (measured with esbuild, minified, production condition, from the fixtures);
 * - that it is true: importing the JavaScript has no effect (no globals in Node: node.test.ts; no change to
 *   the document in a browser: first-chart.browser.test.ts), while the stylesheet subpath, which exists only
 *   for its effect, survives a side-effect import.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, fixtureGuard, out, packedJson } from './paths';

const bundle = async (contents: string, cwd: string, extra: Parameters<typeof build>[0] = {}) => {
  const r = await build({
    stdin: { contents, resolveDir: cwd, loader: 'ts' }, absWorkingDir: cwd, bundle: true, minify: true, format: 'esm',
    write: false, conditions: ['production'], logLevel: 'silent', outdir: path.join(out, 'side-effects'), plugins: [fixtureGuard([cwd])], ...extra,
  });
  return r.outputFiles ?? [];
};

describe('a consumer that imports and uses nothing', () => {
  for (const [name, cwd, external] of [
    ['axylo', fixture('npm'), []],
    ['@axylo/react', fixture('react'), ['react', 'react/*']],
  ] as const) {
    for (const statement of [`import ${JSON.stringify(name)};`, `import * as unused from ${JSON.stringify(name)};`]) {
      it(`${name}: "${statement}" bundles to nothing`, async () => {
        const files = await bundle(statement, cwd, { external: [...external] });
        const bytes = files.reduce((n, f) => n + f.contents.length, 0);
        console.info(`${name} "${statement}": ${bytes} bytes minified`);
        expect(files.map(f => f.text.trim()).join('')).toBe('');
      });
    }
  }
});

describe('the stylesheet subpath', () => {
  it('is the only file either package declares as having side effects', () => {
    expect(packedJson('@axylo/react').sideEffects).toBe(false);
    const declared = packedJson('axylo').sideEffects;
    expect(Array.isArray(declared)).toBe(true);
    for (const pattern of declared as string[]) expect(pattern).toMatch(/\.css$/);
  });

  it('declares itself in exports', () => {
    expect(packedJson('axylo').exports?.['./axylo.css']).toBe('./dist/axylo.css');
  });

  it('survives `import "axylo/axylo.css"` in a bundler, so sideEffects does not tell bundlers to drop it', async () => {
    const files = await bundle(`import 'axylo/axylo.css';`, fixture('npm'));
    const css = files.find(f => f.path.endsWith('.css'));
    const shipped = fs.readFileSync(fixture('npm', 'node_modules/axylo/dist/axylo.css'), 'utf8');
    expect(css, 'no CSS output: the import was dropped').toBeDefined();
    // Minified by the consumer's bundler, so compared by a rule every stylesheet of the library has.
    expect(shipped).toContain('--axylo-stylesheet');
    expect(css!.text).toContain('--axylo-stylesheet');
  });
});
