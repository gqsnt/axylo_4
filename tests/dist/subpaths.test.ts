/**
 * The opt-in subpaths `axylo/static` and `axylo/stream`, as packed (C3.1), and the later ones up to Wave 4's
 * `axylo/spatial` and `axylo/hierarchy`. Node only: bundles are built with esbuild from the npm fixture that
 * installed the tarball, declarations are checked with tsc there, and the Node imports run plain Node through
 * the fixture guard, one fresh process per entry and condition.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { check, fixture, fixtureGuard, installed, nodeJson, out, packedJson } from './paths';

const cwd = fixture('npm');

const consumerBuild = (contents: string, extra: Parameters<typeof build>[0] = {}) => build({
  stdin: { contents, resolveDir: cwd, loader: 'ts' }, absWorkingDir: cwd, bundle: true, minify: true, format: 'esm', target: 'es2022',
  write: false, conditions: ['production'], logLevel: 'silent', outdir: path.join(out, 'subpaths'), plugins: [fixtureGuard([cwd])], ...extra,
});
async function consumer(contents: string, extra: Parameters<typeof build>[0] = {}): Promise<string> {
  const r = await consumerBuild(contents, extra);
  return r.outputFiles?.[0]?.text ?? '';
}
const gzip = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length;
const STREAMING_MARKERS = ['adoptNormalized', 'StreamSession'];

describe('package.json', () => {
  it('exports ./static, ./stream, ./cartesian, ./stats, ./sync, ./export, ./finance, ./spatial and ./hierarchy with types, development and default files that were packed', () => {
    const json = packedJson('axylo');
    for (const name of ['static', 'stream', 'cartesian', 'stats', 'sync', 'export', 'finance', 'spatial', 'hierarchy']) {
      expect(json.exports?.[`./${name}`]).toEqual({ types: `./dist/${name}.d.ts`, development: `./dist/${name}.dev.js`, default: `./dist/${name}.js` });
      for (const file of [`${name}.js`, `${name}.dev.js`, `${name}.d.ts`]) expect(fs.existsSync(installed('axylo', 'dist', file)), file).toBe(true);
    }
  });
});

describe('import for effect, with side-effect hints ignored', () => {
  for (const specifier of ['axylo', 'axylo/static', 'axylo/stream', 'axylo/cartesian', 'axylo/stats', 'axylo/sync', 'axylo/export', 'axylo/finance', 'axylo/spatial', 'axylo/hierarchy']) {
    it(`"import '${specifier}'" bundles to 0 raw bytes`, async () => {
      expect((await consumer(`import '${specifier}';`, { ignoreAnnotations: true })).length).toBe(0);
    });
  }

  // W4: the new subpaths' production and development files both bundle to nothing. `ignoreAnnotations` makes
  // esbuild disregard the package's `sideEffects` and every pure annotation, so only the code itself counts;
  // the metafile proves the condition picked the file named here.
  for (const name of ['spatial', 'hierarchy']) {
    for (const [condition, file] of [['production', `${name}.js`], ['development', `${name}.dev.js`]] as const) {
      it(`"import 'axylo/${name}'" under the ${condition} condition reads dist/${file} and bundles to 0 raw bytes`, async () => {
        const r = await consumerBuild(`import 'axylo/${name}';`, { conditions: [condition], ignoreAnnotations: true, metafile: true });
        // The metafile lists the entry itself as the virtual '<stdin>', which has no file to canonicalize.
        const inputs = Object.keys(r.metafile?.inputs ?? {}).filter(p => p !== '<stdin>').map(p => fs.realpathSync(path.resolve(cwd, p)));
        expect(inputs).toContain(fs.realpathSync(installed('axylo', 'dist', file)));
        expect(r.outputFiles?.[0]?.text.length ?? 0).toBe(0);
      });
    }
  }
});

describe('axylo/cartesian, axylo/finance, axylo/stats, axylo/sync and axylo/export packed sizes stay under caps', () => {
  // N9a: the native violin layer raised the cartesian cap from 134,000 B (docs/progress/n9a-violin-ledger.md).
  it('cartesian (<= 138,000 B) and finance (<= 127,000 B) standalone bundles omit streaming storage and stay under gzip-9 caps', async () => {
    const cart = await consumer("export { cartesian } from 'axylo/cartesian';");
    const fin = await consumer("export { candlestick } from 'axylo/finance';");
    for (const marker of STREAMING_MARKERS) {
      expect(cart, `axylo/cartesian contains ${marker}`).not.toContain(marker);
      expect(fin, `axylo/finance contains ${marker}`).not.toContain(marker);
    }
    const cartGz = gzip(cart), finGz = gzip(fin);
    console.info(`cartesian: ${cartGz} B, finance: ${finGz} B gzip-9`);
    expect(cartGz).toBeLessThanOrEqual(138_000);
    expect(finGz).toBeLessThanOrEqual(127_000);
  });

  it('stats, sync and export standalone bundles stay tiny (<= 3,500 B gzip-9 each)', async () => {
    const statsGz = gzip(await consumer("export * from 'axylo/stats';"));
    const syncGz = gzip(await consumer("export * from 'axylo/sync';"));
    const exportGz = gzip(await consumer("export * from 'axylo/export';"));
    console.info(`stats: ${statsGz} B, sync: ${syncGz} B, export: ${exportGz} B gzip-9`);
    expect(statsGz).toBeLessThanOrEqual(3_500);
    expect(syncGz).toBeLessThanOrEqual(3_500);
    expect(exportGz).toBeLessThanOrEqual(3_500);
  });
});

describe('axylo/spatial and axylo/hierarchy packed sizes stay under caps', () => {
  // W4 integration (docs/progress/w4-wire-ledger.md): measured 142,020 B (spatial, both families with their
  // core) and 21,525 B (hierarchy) gzip-9 from an equivalent workspace build; caps a little above those. After
  // the review repair: 142,342 B and 21,591 B, under the same caps. The bubble TableModel.row(-1) fix measured
  // 142,502 B, so the spatial cap moved to 143,000 B; the hierarchy cap is unchanged.
  it('spatial (<= 143,000 B) and hierarchy (<= 21,600 B) standalone bundles stay under gzip-9 caps', async () => {
    const spatial = await consumer("export * from 'axylo/spatial';");
    const hierarchy = await consumer("export * from 'axylo/hierarchy';");
    for (const marker of STREAMING_MARKERS) expect(spatial, `axylo/spatial contains ${marker}`).not.toContain(marker);
    const spatialGz = gzip(spatial), hierarchyGz = gzip(hierarchy);
    console.info(`spatial: ${spatialGz} B, hierarchy: ${hierarchyGz} B gzip-9`);
    expect(spatialGz).toBeLessThanOrEqual(143_000);
    expect(hierarchyGz).toBeLessThanOrEqual(21_600);
  });
});

describe('axylo/static carries no streaming storage and is smaller than the root entry', () => {
  // Regression guard for the root and static entries. Owner decision 2026-11-27: the root caps follow the
  // post-R2 / Wave 4 (2b3868f) baseline, because the root growth since b097f1a came from the 2026-11-25 R2
  // speed/memory campaign (about +24.7 KiB), not from Phase 2 Waves 1–4 (under +1.2 KiB root, -752 B static).
  // line, everything and iife are that baseline plus a little headroom; the static caps keep their C3-sealed
  // b097f1a values, which Wave 4 already meets. Deeper size cuts are left to a later campaign.
  const LEGACY_CAPS = { line: 136_500, everything: 159_500, staticLine: 120_729, staticEverything: 140_988, iife: 159_600 } as const;

  for (const [label, statement, fullCap, staticCap] of [
    ['line', 'export { line } from', LEGACY_CAPS.line, LEGACY_CAPS.staticLine],
    ['everything', 'export * from', LEGACY_CAPS.everything, LEGACY_CAPS.staticEverything],
  ] as const) {
    it(`${label}`, async () => {
      const fixed = await consumer(`${statement} 'axylo/static';`);
      const full = await consumer(`${statement} 'axylo';`);
      for (const marker of STREAMING_MARKERS) expect(fixed, `axylo/static ${label} contains ${marker}`).not.toContain(marker);
      // The minifier renames the StreamSession class, but the store's method name survives: proof that the
      // markers still find the stores where they are bundled.
      expect(full, `axylo ${label} lacks adoptNormalized: the marker no longer identifies the stores`).toContain('adoptNormalized');
      const fullGz = gzip(full), fixedGz = gzip(fixed);
      console.info(`${label}: axylo ${fullGz} B, axylo/static ${fixedGz} B gzip-9`);
      expect(fixedGz).toBeLessThan(fullGz);
      expect(fullGz, `axylo ${label} exceeded its 2026-11-27 owner-approved cap`).toBeLessThanOrEqual(fullCap);
      expect(fixedGz, `axylo/static ${label} exceeded its b097f1a cap`).toBeLessThanOrEqual(staticCap);
    });
  }

  it('IIFE bundle stays within its 2026-11-27 owner-approved cap (<= 159,600 B)', () => {
    const iifeGz = gzipSync(fs.readFileSync(installed('axylo', 'dist', 'axylo.iife.min.js')), { level: 9 }).length;
    expect(iifeGz, 'IIFE exceeded its 2026-11-27 owner-approved cap').toBeLessThanOrEqual(LEGACY_CAPS.iife);
  });
});

describe('declarations', () => {
  const configs = [
    ['Bundler', { module: 'ESNext', moduleResolution: 'Bundler' }],
    ['NodeNext', { module: 'NodeNext', moduleResolution: 'NodeNext' }],
  ] as const;

  for (const [label, resolution] of configs) {
    it(`compile under ${label} against packed dist/static.d.ts and dist/stream.d.ts: StaticChart omits append, axylo/stream keeps it, axylo/cartesian types scatter, boxplot and violin layers`, () => {
      const project = path.join(cwd, '.out', `subpaths-types-${label.toLowerCase()}`);
      fs.rmSync(project, { recursive: true, force: true });
      fs.mkdirSync(project, { recursive: true });
      fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2022', ...resolution, lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true, noEmit: true, skipLibCheck: false, types: [],
        },
        include: ['check.ts'],
      }));
      fs.writeFileSync(path.join(project, 'check.ts'), [
        "import * as fixed from 'axylo/static';",
        "import * as stream from 'axylo/stream';",
        "import { cartesian, validateCartesian } from 'axylo/cartesian';",
        "import { boxplot, quantile, quantiles, kde, violinData, kdeConvention } from 'axylo/stats';",
        "import type { KdeResult, ViolinResult } from 'axylo/stats';",
        "import { createDashboard, createSyncGroup, syncCharts } from 'axylo/sync';",
        "import type { Dashboard, DashboardPanel } from 'axylo/sync';",
        "import { exportSvg, exportPng, exportCsv, parseCsv } from 'axylo/export';",
        "import { candlestick, validateCandlestick } from 'axylo/finance';",
        "import { heatmap, validateHeatmap, bubble, validateBubble } from 'axylo/spatial';",
        "import type { HeatmapOptions, HeatmapChart, HeatmapColorOptions, BubbleOptions, BubbleChart, SizeField } from 'axylo/spatial';",
        "import { treemap, sunburst, validateTreemap, validateSunburst } from 'axylo/hierarchy';",
        "import type { TreemapChart, SunburstChart, HierarchyOptions, HierarchyCrumb, TableModel as HierarchyTable } from 'axylo/hierarchy';",
        "import type { StaticChart, LineOptions, Diagnostic } from 'axylo/static';",
        "type Row = { x: number; y: number };",
        "declare const el: HTMLElement;",
        "const options: LineOptions<Row> = { data: [{ x: 1, y: 2 }], x: 'x', y: 'y' };",
        "const a: StaticChart<Row, LineOptions<Row>> = fixed.line(el, options);",
        "a.update({ title: 'T' });",
        "a.zoom(null);",
        "// @ts-expect-error a static chart has no append",
        "a.append([{ x: 2, y: 3 }]);",
        "const b = stream.line(el, options);",
        "b.append([{ x: 2, y: 3 }]);",
        "const c = cartesian(el, {",
        "  title: 'Dual', data: [{ m: 'Jan', orders: 100, ms: 20 }], x: 'm',",
        "  axes: { orders: { position: 'left', label: 'Orders' }, ms: { position: 'right', scale: 'log', unit: 'ms' } },",
        "  layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }, { type: 'line', y: 'ms', yAxis: 'ms' }],",
        "});",
        "c.update({ axes: { orders: { position: 'left', label: 'Renamed', domain: [0, 200] }, ms: { position: 'right', scale: 'log', domain: [1, 100] } } });",
        "// @ts-expect-error bar cannot bind to log axis",
        "c.update({ layers: [{ type: 'bar', y: 'orders', yAxis: 'ms' }] });",
        "// W3 integration: scatter and boxplot layers are part of the packed axylo/cartesian declarations.",
        "type Mark = { g: string; mn: number; q1: number; md: number; q3: number; mx: number; mean: number; out: number[]; s: number };",
        "const marks: Mark[] = [{ g: 'A', mn: 1, q1: 2, md: 3, q3: 4, mx: 5, mean: 3.2, out: [9], s: 2 }];",
        "const sb = cartesian(el, {",
        "  data: marks, x: 'g', axes: { v: { position: 'left' }, r: { position: 'right', scale: 'log' } },",
        "  layers: [",
        "    { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v', label: 'Spread', capWidth: 8, size: 4 },",
        "    { type: 'scatter', y: 'mean', yAxis: 'v', label: 'Mean', size: 6 },",
        "    { type: 'scatter', y: ['s'], yAxis: 'r' },",
        "  ],",
        "});",
        "sb.update({ layers: [{ type: 'scatter', y: 'mean' }, { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'r' }] });",
        "const sbD: readonly Diagnostic[] = validateCartesian({ data: marks, x: 'g', axes: { v: { position: 'left' } }, layers: [{ type: 'scatter', y: 'mean', yAxis: 'left' }] });",
        "// @ts-expect-error a boxplot needs all five numbers",
        "sb.update({ layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', max: 'mx', yAxis: 'v' }] });",
        "// @ts-expect-error a box's outliers must name a field of number lists",
        "sb.update({ layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', outliers: 'g' }] });",
        "// @ts-expect-error a scatter names a numeric field",
        "sb.update({ layers: [{ type: 'scatter', y: 'g' }] });",
        "// @ts-expect-error a scatter binds to a declared axis or a position",
        "sb.update({ layers: [{ type: 'scatter', y: 'mean', yAxis: 'nope' }] });",
        "// N9a: the violin layer and the KDE payload are part of the packed declarations.",
        "const vd: ViolinResult = violinData([{ g: 'A', v: 1 }, { g: 'A', v: 2 }], { group: 'g', value: 'v', normalize: 'width', clamp: [0, Infinity] });",
        "const kd: KdeResult = kde([1, 2, 3], { bandwidth: 0.5, points: 64 }); const kdN: 'gaussian' = kdeConvention().kernel;",
        "const vc = cartesian(el, { data: vd.data, x: 'x', axes: { v: { position: 'left' }, r: { position: 'right', scale: 'log' } }, layers: [{ type: 'violin', yAxis: 'v', label: 'Spread', inner: 'none' }, { type: 'scatter', y: 'mean', yAxis: 'v' }] });",
        "vc.update({ layers: [{ type: 'violin', yAxis: 'v', median: 'median', grid: 'grid', density: 'density', n: 'n', bandwidth: 'bandwidth' }] });",
        "// @ts-expect-error a violin binds to a linear axis only",
        "vc.update({ layers: [{ type: 'violin', yAxis: 'r' }] });",
        "// @ts-expect-error a violin's density names a field of number lists",
        "vc.update({ layers: [{ type: 'violin', yAxis: 'v', density: 'median' }] });",
        "// @ts-expect-error inner is 'box' or 'none'",
        "vc.update({ layers: [{ type: 'violin', yAxis: 'v', inner: 'dots' }] });",
        "// @ts-expect-error violinData groups by a field of its rows",
        "violinData([{ g: 'A', v: 1 }], { group: 'nope', value: 'v' });",
        "const d: Diagnostic[] = fixed.validate('line', options).concat(stream.validate('line', options), validateCartesian({ data: [{ m: 'Jan', orders: 100, ms: 20 }], x: 'm', axes: { orders: { position: 'left' } }, layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }] }));",
        "const q = quantile([1, 2, 3, 4], 0.5); const qs = quantiles([1, 2, 3], [0.25, 0.75]); const bx = boxplot([{ g: 'A', v: 1 }], { x: 'g', y: 'v' });",
        "const sg = createSyncGroup(); sg.attach(a); sg.destroy(); const sc = syncCharts([a, b]); sc.destroy();",
        "// The packed axylo/sync declarations close over the dashboard too: panels are made by real typed chart factories.",
        "const panels: DashboardPanel[] = [{ id: 'line', create: e => fixed.line(e, options), sync: { xKind: 'number' } }, { create: e => stream.line(e, options) }];",
        "const dash: Dashboard = createDashboard(el, panels, { minPanelWidth: 280, gap: 8, label: 'Linked', unmatchedHover: 'nearest' });",
        "dash.zoom([1, 2]); dash.reset(); const dashIds: readonly string[] = dash.ids; dash.add({ create: e => fixed.line(e, options) }); dash.remove('line'); dash.destroy();",
        "const csvText = exportCsv([{ x: 1, y: 2 }]); const parsedCsv = parseCsv(csvText);",
        "const fin = candlestick(el, { data: [{ d: '2026-01-01', o: 10, h: 12, l: 9, c: 11 }], x: 'd', open: 'o', high: 'h', low: 'l', close: 'c' });",
        "const finD = validateCandlestick({ data: [{ d: '2026-01-01', o: 10, h: 12, l: 9, c: 11 }], x: 'd', open: 'o', high: 'h', low: 'l', close: 'c' });",
        "// W4: the packed axylo/spatial and axylo/hierarchy declarations type the families and their options.",
        "type Cell = { r: string; c: string; v: number };",
        "const hmColor: HeatmapColorOptions = { scheme: 'diverging', mid: 0, bins: 16 };",
        "const hmOptions: HeatmapOptions<Cell> = { data: [{ r: 'a', c: 'x', v: 1 }], x: 'c', y: { field: 'r', categories: ['a'] }, value: { field: 'v', unit: 'ms' }, color: hmColor };",
        "const hm: HeatmapChart<Cell> = heatmap(el, hmOptions); hm.update({ color: { bins: 8 } }); const hmD: readonly Diagnostic[] = validateHeatmap(hmOptions);",
        "// @ts-expect-error a heatmap value names a field of the rows",
        "heatmap(el, { data: [{ r: 'a', c: 'x', v: 1 }], x: 'c', y: 'r', value: 'nope' });",
        "type Dot = { x: number; y: number; s: number; t: string };",
        "const sf: SizeField<Dot> = { field: 's', label: 'Size', format: v => `${v}` };",
        "const bOptions: BubbleOptions<Dot> = { data: [{ x: 1, y: 2, s: 3, t: '4' }], x: 'x', y: 'y', size: sf, radius: { min: 1, max: 20 } };",
        "const bc: BubbleChart<Dot> = bubble(el, bOptions); bc.update({ size: { field: 't', parse: 'number' } }); const bD: Diagnostic[] = validateBubble(bOptions);",
        "// @ts-expect-error a size names a numeric field unless it parses",
        "bubble(el, { data: [{ x: 1, y: 2, s: 3, t: '4' }], x: 'x', y: 'y', size: 't' });",
        "// @ts-expect-error a bubble chart has no append",
        "bc.append([{ x: 2, y: 3, s: 1, t: '1' }]);",
        "const hOptions: HierarchyOptions = { data: { label: 'R', children: [{ label: 'a', value: 1 }] }, value: { unit: 'kg' } };",
        "const tm: TreemapChart = treemap(el, hOptions); const sbc: SunburstChart = sunburst(el, hOptions);",
        "const crumbs: readonly HierarchyCrumb[] = tm.breadcrumb; const ht: HierarchyTable | null = tm.table; const htPage: number | undefined = ht?.pageSize;",
        "const hD: readonly Diagnostic[] = validateTreemap(hOptions).concat(validateSunburst(hOptions)); tm.drill('a'); sbc.destroy();",
        "// @ts-expect-error a hierarchy node's value is a number",
        "treemap(el, { data: { label: 'R', value: 'one' } });",
        "export { hm, hmD, bc, bD, crumbs, htPage, hD };",
        "export { vd, kd, kdN, vc };",
        "export { a, b, c, d, q, qs, bx, exportSvg, exportPng, csvText, parsedCsv, fin, finD, sb, sbD, dash, dashIds };",
      ].join('\n'));
      const result = check(project, 'tsconfig.json');
      expect(result.errors).toEqual([]);
      expect(result.status).toBe(0);
      expect(result.files).toContain(installed('axylo', 'dist', 'static.d.ts'));
      expect(result.files).toContain(installed('axylo', 'dist', 'stream.d.ts'));
      expect(result.files).toContain(installed('axylo', 'dist', 'cartesian.d.ts'));
      expect(result.files).toContain(installed('axylo', 'dist', 'spatial.d.ts'));
      expect(result.files).toContain(installed('axylo', 'dist', 'hierarchy.d.ts'));
    });
  }
});

describe('Node import (no DOM)', () => {
  const dir = path.join(cwd, '.out', 'subpaths-node');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'probe.mjs');
  fs.writeFileSync(script, [
    "const rows = [{ day: 'Mon', value: 10 }, { day: 'Tue', value: null }, { day: 'Wed', value: '40' }];",
    "const options = { title: 'Probe', data: rows, x: 'day', y: 'value' };",
    "const result = {};",
    "for (const specifier of ['axylo', 'axylo/static', 'axylo/stream']) {",
    "  const m = await import(specifier);",
    "  result[specifier] = { exports: Object.keys(m).sort(), diagnostics: m.validate('line', options) };",
    "}",
    "console.log(JSON.stringify(result));",
  ].join('\n'));
  type Probe = Record<string, { exports: string[]; diagnostics: unknown[] }>;
  const probe = nodeJson<Probe>(cwd, [script]);

  it('imports axylo/static and axylo/stream and runs validate as the root entry does', () => {
    const rootResult = probe['axylo']!;
    expect(rootResult.diagnostics.length).toBeGreaterThan(0);
    for (const specifier of ['axylo/static', 'axylo/stream']) {
      expect(probe[specifier]!.exports).toEqual(rootResult.exports);
      expect(probe[specifier]!.diagnostics).toEqual(rootResult.diagnostics);
    }
  });
});

describe('Node SSR import of every entry, one fresh process per entry and condition (no DOM)', () => {
  // W4 integration: each JS entry is imported alone in a new Node process, under the default and the development
  // condition. The DOM globals a browser has must be absent before and after the import (the entry neither needs
  // nor installs them), and the entry must have exports.
  const SPECIFIERS = ['axylo', 'axylo/static', 'axylo/stream', 'axylo/cartesian', 'axylo/stats', 'axylo/sync', 'axylo/export', 'axylo/finance', 'axylo/spatial', 'axylo/hierarchy'];
  const DOM_GLOBALS = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'customElements', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'matchMedia'];
  const dir = path.join(cwd, '.out', 'subpaths-ssr');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'probe.mjs');
  fs.writeFileSync(script, [
    `const globals = ${JSON.stringify(DOM_GLOBALS)};`,
    "const present = () => globals.filter(name => typeof globalThis[name] !== 'undefined');",
    'const before = present();',
    'const m = await import(process.argv[2]);',
    "console.log(JSON.stringify({ before, after: present(), exports: Object.keys(m).sort(), resolved: import.meta.resolve(process.argv[2]) }));",
  ].join('\n'));
  type Probe = { before: string[]; after: string[]; exports: string[]; resolved: string };

  for (const specifier of SPECIFIERS) {
    for (const condition of ['default', 'development'] as const) {
      it(`imports ${specifier} (${condition}) with no DOM globals before or after`, () => {
        const args = condition === 'development' ? ['--conditions=development', script, specifier] : [script, specifier];
        const probe = nodeJson<Probe>(cwd, args);
        expect(probe.before).toEqual([]);
        expect(probe.after).toEqual([]);
        expect(probe.exports.length).toBeGreaterThan(0);
        expect(probe.resolved.endsWith(condition === 'development' ? '.dev.js' : '.js') && probe.resolved.includes('/dist/')).toBe(true);
        if (condition === 'default') expect(probe.resolved.endsWith('.dev.js')).toBe(false);
      });
    }
  }
});
