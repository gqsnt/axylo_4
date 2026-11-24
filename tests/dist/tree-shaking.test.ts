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
 *
 * The markers can only see the code they name. The last group closes that gap a level up: the library's source,
 * bundled with the release build's production settings (scripts/build.mjs), one kind at a time, must not
 * include a module that belongs to another kind. Which module belongs to which kind is listed by hand from the
 * restructuring's map (reviews/2026-11-18/impl/wp/tree-shake.report.md): shared code that starts importing
 * another kind's composition, scene, lookup, view or store again brings in that kind's module, and fails there
 * even when the module's own text carries no marker. `validate` alone must carry no drawing, DOM, lookup or
 * reader module, since it runs only the synchronous stages (plan 1.6).
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import path from 'node:path';
import { fixture, fixtureGuard, out, repo } from './paths';
// @ts-expect-error scripts/build.mjs is plain JavaScript without declarations
import { PRODUCTION, stylesheetPlugin, stylesheets } from '../../scripts/build.mjs';

const KINDS = ['line', 'area', 'bar', 'histogram', 'scatter', 'donut'] as const;
type Kind = typeof KINDS[number];

const ALIGNED_STORE = /adoptNormalized/;
const MARKERS: Record<Kind, readonly RegExp[]> = {
  line: [/kind:"line",normalize:/],
  area: [/kind:"area",normalize:/, /\.upper\b/],
  bar: [/kind:"bar",normalize:/],
  histogram: [/kind:"histogram",normalize:/],
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
      if (kind === 'bar' || kind === 'histogram') expect(text).toMatch(/axylo-pattern-/);
      if (ALIGNED.includes(kind)) expect(text).toMatch(ALIGNED_STORE);
    });

    it(`${kind}: carries no other kind's code`, async () => {
      const text = await consumer(kind);
      const found: string[] = [];
      for (const other of KINDS) {
        if (other === kind) continue;
        for (const marker of MARKERS[other]) if (marker.test(text)) found.push(`${other} ${marker}`);
      }
      if (kind !== 'bar' && kind !== 'histogram' && /axylo-pattern-/.test(text)) found.push('bar patterns');
      if (!ALIGNED.includes(kind) && ALIGNED_STORE.test(text)) found.push(`aligned storage ${ALIGNED_STORE}`);
      console.info(`${kind} only: ${text.length} bytes minified`);
      expect(found).toEqual([]);
    });
  }
});

/** Source modules that belong to some kinds only (paths under packages/axylo/src), and the kinds they belong to. */
const OWNED: Record<string, readonly Kind[]> = {
  'kinds/line.ts': ['line'], 'kinds/area.ts': ['area'], 'kinds/bar.ts': ['bar'], 'kinds/scatter.ts': ['scatter'], 'kinds/donut.ts': ['donut'],
  'kinds/histogram.ts': ['histogram'], 'data/histogram.ts': ['histogram'],
  'scene/areas.ts': ['area'], 'scene/bars.ts': ['bar', 'histogram'],
  'lookup/scatter.ts': ['scatter'], 'lookup/scatter-grid.ts': ['scatter'], 'lookup/point-order.ts': ['scatter'],
  'lookup/donut.ts': ['donut'], 'view/donut.ts': ['donut'], 'view/donut-geometry.ts': ['donut'],
  // Aligned data (one x shared by every series): line, area and bar.
  'data/store.ts': ['line', 'area', 'bar'], 'data/store-buffers.ts': ['line', 'area', 'bar'], 'lookup/aligned.ts': ['line', 'area', 'bar', 'histogram'],
  'view/stack.ts': ['line', 'area', 'bar', 'histogram'],
  // Unaligned data: scatter points and donut slices.
  'data/store-unaligned.ts': ['scatter', 'donut', 'histogram'],
};

const src = path.join(repo, 'packages/axylo/src');
/** Source modules that contribute bytes when `name` alone is imported from the source, built as the release build builds. */
async function sourceModules(name: Kind | 'validate'): Promise<Set<string>> {
  const { minified } = await (stylesheets as () => Promise<{ minified: string }>)();
  const r = await build({
    stdin: { contents: `export { ${name} } from ${JSON.stringify(path.join(src, 'index.ts'))};`, resolveDir: repo, loader: 'ts' }, absWorkingDir: repo,
    bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, metafile: true, logLevel: 'silent', legalComments: 'none',
    define: PRODUCTION as Record<string, string>, plugins: [(stylesheetPlugin as (text: string) => import('esbuild').Plugin)(minified)],
  });
  const output = Object.values(r.metafile.outputs)[0]!;
  return new Set(Object.entries(output.inputs).filter(([, v]) => v.bytesInOutput > 0).map(([f]) => path.relative(src, path.resolve(repo, f)).split(path.sep).join('/')));
}

describe('the source, bundled one kind at a time with the release settings', () => {
  for (const kind of KINDS) {
    it(`${kind}: includes the modules that belong to it and none that belong only to other kinds`, async () => {
      const modules = await sourceModules(kind);
      const mine = Object.entries(OWNED).filter(([, kinds]) => kinds.includes(kind)).map(([m]) => m);
      expect(mine.filter(m => !modules.has(m)), `${kind} lacks its own modules (a renamed module would leave this list stale)`).toEqual([]);
      const foreign = Object.entries(OWNED).filter(([m, kinds]) => !kinds.includes(kind) && modules.has(m)).map(([m, kinds]) => `${m} (${kinds.join(', ')})`);
      expect(foreign).toEqual([]);
    });
  }

  it('validate: includes no composition and no drawing, DOM, lookup or reader module', async () => {
    const modules = await sourceModules('validate');
    expect(modules.has('data/normalize.ts'), 'validate normalizes').toBe(true);
    expect([...modules].filter(m => /^(kinds|render|dom|scene|lookup|reader|theme)\//.test(m))).toEqual([]);
  });
});
