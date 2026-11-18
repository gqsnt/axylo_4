/**
 * Importing one chart kind bundles that kind only. Each named entry passes the shared controller its own
 * composition (packages/axylo/src/kinds), so a consumer that imports `line` must not carry the code of
 * `area`, `bar`, `scatter` or `donut`, and the same for each of the others. Measured the way a consumer's
 * bundler builds it: esbuild, minified, production condition, from the fixture that installed the tarball.
 *
 * Markers are what a minifier keeps: string literals and property names, never local or function names.
 * - every kind: its composition, an object literal that starts `kind:"<kind>",normalize:` (the composition's
 *   first two properties);
 * - area: the `upper` boundary of an area mark, which only the area scene and the area mark handlers use;
 * - bar: the `axylo-pattern-` id prefix of the SVG renderer's bar patterns;
 * - scatter: the `minX` bound of the scatter lookup's point grid;
 * - donut: the `__other__` key of the grouped slice;
 * - line, area and bar (aligned data): `adoptNormalized`, a method of the aligned streaming store, which
 *   scatter and donut must not carry (line has no module of its own beyond its composition).
 * Each marker is first required in its own kind's bundle, so a marker that a rename made vanish fails here
 * instead of passing everything.
 *
 * The package ships one prebundled file per condition; that it can be shaken at all rests on its doing no work
 * at import time, which the first test proves.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import path from 'node:path';
import { fixture, fixtureGuard, out } from './paths';

const KINDS = ['line', 'area', 'bar', 'scatter', 'donut'] as const;
type Kind = typeof KINDS[number];

const ALIGNED_STORE = /adoptNormalized/;
const MARKERS: Record<Kind, readonly RegExp[]> = {
  line: [/kind:"line",normalize:/],
  area: [/kind:"area",normalize:/, /\.upper\b/],
  bar: [/kind:"bar",normalize:/, /axylo-pattern-/],
  scatter: [/kind:"scatter",normalize:/, /\.minX\b/],
  donut: [/kind:"donut",normalize:/, /__other__/],
};
const ALIGNED: readonly Kind[] = ['line', 'area', 'bar'];

const bundles = new Map<Kind, Promise<string>>();
function consumer(kind: Kind): Promise<string> {
  let text = bundles.get(kind);
  if (!text) {
    const cwd = fixture('npm');
    text = build({
      stdin: { contents: `export { ${kind} } from 'axylo';`, resolveDir: cwd, loader: 'ts', sourcefile: `${kind}.ts` }, absWorkingDir: cwd,
      bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, conditions: ['production'], logLevel: 'silent',
      outdir: path.join(out, 'tree-shaking'), plugins: [fixtureGuard([cwd])],
    }).then(r => r.outputFiles[0]!.text);
    bundles.set(kind, text);
  }
  return text;
}

describe('the production file', () => {
  // Why one prebundled file can be shaken: a bundler drops a top-level statement only when it can see that the
  // statement does nothing. With `ignoreAnnotations` esbuild disregards the package's `sideEffects` promise, so
  // an import for effect keeps exactly the statements that do work at import time: there must be none.
  it('does no work at import time: imported for its effects, with side-effect hints ignored, it bundles to nothing', async () => {
    const cwd = fixture('npm');
    const r = await build({
      stdin: { contents: `import 'axylo';`, resolveDir: cwd, loader: 'ts' }, absWorkingDir: cwd, bundle: true, minify: true, format: 'esm',
      write: false, conditions: ['production'], ignoreAnnotations: true, logLevel: 'silent', outdir: path.join(out, 'tree-shaking'),
      plugins: [fixtureGuard([cwd])],
    });
    expect(r.outputFiles[0]!.text.trim()).toBe('');
  });
});

describe('a consumer that imports one chart kind', () => {
  for (const kind of KINDS) {
    it(`${kind}: carries its own composition and code (the markers are present)`, async () => {
      const text = await consumer(kind);
      for (const marker of MARKERS[kind]) expect(text, `${kind} lacks its own marker ${marker}`).toMatch(marker);
      if (ALIGNED.includes(kind)) expect(text).toMatch(ALIGNED_STORE);
    });

    it(`${kind}: carries no other kind's code`, async () => {
      const text = await consumer(kind);
      const found: string[] = [];
      for (const other of KINDS) {
        if (other === kind) continue;
        for (const marker of MARKERS[other]) if (marker.test(text)) found.push(`${other} ${marker}`);
      }
      if (!ALIGNED.includes(kind) && ALIGNED_STORE.test(text)) found.push(`aligned storage ${ALIGNED_STORE}`);
      console.info(`${kind} only: ${text.length} bytes minified`);
      expect(found).toEqual([]);
    });
  }
});
