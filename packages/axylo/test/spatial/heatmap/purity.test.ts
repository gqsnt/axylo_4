/**
 * Pure modules and zero tax:
 *  - The heatmap entry, built the way scripts/build.mjs builds a subpath (one minified production ESM file), does
 *    no work at import time: that file imported for its effects alone, with pure annotations ignored, bundles to
 *    0 raw bytes (the same check tests/dist/tree-shaking.test.ts makes for the root file).
 *  - The root and `axylo/static` bundles take no input from src/spatial: the heatmap adds 0 B to them.
 *  - The entry imports in Node (no DOM globals).
 * The build options are scripts/build.mjs's own (its PRODUCTION define and stylesheet plugin), so the bytes match
 * what `npm run build` would emit for these entries.
 * Sizes are printed with the label [n8a-ledger] for docs/progress/n8a-heatmap-ledger.md.
 */
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';

const src = path.resolve(import.meta.dirname, '../../../src');
const buildScript = path.resolve(import.meta.dirname, '../../../../../scripts/build.mjs');

interface BuildScript {
  readonly PRODUCTION: Record<string, string>;
  stylesheets(): Promise<{ readonly minified: string }>;
  stylesheetPlugin(text: string): Plugin;
}
let script: Promise<{ readonly mod: BuildScript; readonly css: string }> | undefined;
/** scripts/build.mjs exports its production define and stylesheet plugin; importing it builds nothing. */
function buildOptions() {
  return script ??= (import(buildScript) as Promise<BuildScript>).then(async mod => ({ mod, css: (await mod.stylesheets()).minified }));
}

async function subpath(entry: string) {
  const { mod, css } = await buildOptions();
  const r = await build({
    entryPoints: [path.join(src, entry)], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true,
    legalComments: 'none', define: mod.PRODUCTION, plugins: [mod.stylesheetPlugin(css)], logLevel: 'silent', metafile: true, outdir: 'out',
  });
  return { text: r.outputFiles[0]!.text, inputs: Object.keys(r.metafile!.inputs) };
}

/** Bundles `import '<built file>'` with pure annotations ignored: what a consumer keeps for a bare import. */
async function bareImportOf(text: string): Promise<string> {
  const virtual: Plugin = {
    name: 'built', setup(b) {
      b.onResolve({ filter: /^built:/ }, a => ({ path: a.path, namespace: 'built' }));
      b.onLoad({ filter: /.*/, namespace: 'built' }, () => ({ contents: text, loader: 'js' }));
    },
  };
  const r = await build({
    stdin: { contents: `import 'built:heatmap';`, loader: 'js' }, bundle: true, write: false, format: 'esm', minify: true,
    target: 'es2022', ignoreAnnotations: true, logLevel: 'silent', plugins: [virtual],
  });
  return r.outputFiles[0]!.text;
}

describe('import-time purity and zero tax', () => {
  it('the built heatmap entry imported for effects bundles to 0 raw bytes with ignoreAnnotations', async () => {
    const built = await subpath('spatial/heatmap/index.ts');
    expect(built.text.length).toBeGreaterThan(1000);
    expect((await bareImportOf(built.text)).trim()).toBe('');
    console.log(`[n8a-ledger] heatmap entry (esbuild in-memory, scripts/build.mjs production options): raw ${built.text.length} B, gzip ${gzipSync(built.text).length} B; bare import with ignoreAnnotations: 0 B`);
  });

  it('the root and static bundles take no input from src/spatial', async () => {
    for (const entry of ['index.ts', 'static.ts']) {
      const built = await subpath(entry);
      expect(built.inputs.filter(i => i.includes('/spatial/'))).toEqual([]);
      console.log(`[n8a-ledger] ${entry} (esbuild in-memory, scripts/build.mjs production options): raw ${built.text.length} B, gzip ${gzipSync(built.text).length} B, spatial inputs 0`);
    }
  });

  it('imports in Node with no document and exposes the entry points', async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const mod = await import('../../../src/spatial/heatmap/index');
    expect(typeof mod.heatmap).toBe('function');
    expect(typeof mod.validateHeatmap).toBe('function');
    expect(typeof mod.heatmapInternals).toBe('function');
  });
});
