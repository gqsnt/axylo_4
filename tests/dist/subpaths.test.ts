/**
 * The opt-in subpaths `axylo/static` and `axylo/stream`, as packed (C3.1). Node only: bundles are built with
 * esbuild from the npm fixture that installed the tarball, declarations are checked with tsc there, and the
 * Node import runs plain Node through the fixture guard.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { check, fixture, fixtureGuard, installed, nodeJson, out, packedJson } from './paths';

const cwd = fixture('npm');

async function consumer(contents: string, extra: Parameters<typeof build>[0] = {}): Promise<string> {
  const r = await build({
    stdin: { contents, resolveDir: cwd, loader: 'ts' }, absWorkingDir: cwd, bundle: true, minify: true, format: 'esm', target: 'es2022',
    write: false, conditions: ['production'], logLevel: 'silent', outdir: path.join(out, 'subpaths'), plugins: [fixtureGuard([cwd])], ...extra,
  });
  return r.outputFiles?.[0]?.text ?? '';
}
const gzip = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length;
const STREAMING_MARKERS = ['adoptNormalized', 'StreamSession'];

describe('package.json', () => {
  it('exports ./static, ./stream, ./cartesian, ./stats, ./sync, ./export and ./finance with types, development and default files that were packed', () => {
    const json = packedJson('axylo');
    for (const name of ['static', 'stream', 'cartesian', 'stats', 'sync', 'export', 'finance']) {
      expect(json.exports?.[`./${name}`]).toEqual({ types: `./dist/${name}.d.ts`, development: `./dist/${name}.dev.js`, default: `./dist/${name}.js` });
      for (const file of [`${name}.js`, `${name}.dev.js`, `${name}.d.ts`]) expect(fs.existsSync(installed('axylo', 'dist', file)), file).toBe(true);
    }
  });
});

describe('import for effect, with side-effect hints ignored', () => {
  for (const specifier of ['axylo', 'axylo/static', 'axylo/stream', 'axylo/cartesian', 'axylo/stats', 'axylo/sync', 'axylo/export', 'axylo/finance']) {
    it(`"import '${specifier}'" bundles to 0 raw bytes`, async () => {
      expect((await consumer(`import '${specifier}';`, { ignoreAnnotations: true })).length).toBe(0);
    });
  }
});

describe('axylo/cartesian, axylo/finance, axylo/stats, axylo/sync and axylo/export packed sizes stay under caps', () => {
  it('cartesian and finance standalone bundles omit streaming storage and stay <= 127,000 B gzip-9', async () => {
    const cart = await consumer("export { cartesian } from 'axylo/cartesian';");
    const fin = await consumer("export { candlestick } from 'axylo/finance';");
    for (const marker of STREAMING_MARKERS) {
      expect(cart, `axylo/cartesian contains ${marker}`).not.toContain(marker);
      expect(fin, `axylo/finance contains ${marker}`).not.toContain(marker);
    }
    const cartGz = gzip(cart), finGz = gzip(fin);
    console.info(`cartesian: ${cartGz} B, finance: ${finGz} B gzip-9`);
    expect(cartGz).toBeLessThanOrEqual(127_000);
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

describe('axylo/static carries no streaming storage and is smaller than the root entry', () => {
  // C4/C5+ zero-legacy-tax regression guard anchored to the clean C3-sealed b097f1a baseline.
  const LEGACY_CAPS = { line: 135_293, everything: 158_096, staticLine: 120_729, staticEverything: 140_988, iife: 158_425 } as const;

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
      expect(fullGz, `legacy axylo ${label} exceeded <= +0 B cap`).toBeLessThanOrEqual(fullCap);
      expect(fixedGz, `legacy axylo/static ${label} exceeded <= +0 B cap`).toBeLessThanOrEqual(staticCap);
    });
  }

  it('IIFE bundle stays <= +0 B vs C3-sealed b097f1a baseline', () => {
    const iifeGz = gzipSync(fs.readFileSync(installed('axylo', 'dist', 'axylo.iife.min.js')), { level: 9 }).length;
    expect(iifeGz).toBeLessThanOrEqual(LEGACY_CAPS.iife);
  });
});

describe('declarations', () => {
  const configs = [
    ['Bundler', { module: 'ESNext', moduleResolution: 'Bundler' }],
    ['NodeNext', { module: 'NodeNext', moduleResolution: 'NodeNext' }],
  ] as const;

  for (const [label, resolution] of configs) {
    it(`compile under ${label} against packed dist/static.d.ts and dist/stream.d.ts: StaticChart omits append, axylo/stream keeps it`, () => {
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
        "import { boxplot, quantile, quantiles } from 'axylo/stats';",
        "import { createSyncGroup, syncCharts } from 'axylo/sync';",
        "import { exportSvg, exportPng, exportCsv, parseCsv } from 'axylo/export';",
        "import { candlestick, validateCandlestick } from 'axylo/finance';",
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
        "const d: Diagnostic[] = fixed.validate('line', options).concat(stream.validate('line', options), validateCartesian({ data: [{ m: 'Jan', orders: 100, ms: 20 }], x: 'm', axes: { orders: { position: 'left' } }, layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }] }));",
        "const q = quantile([1, 2, 3, 4], 0.5); const qs = quantiles([1, 2, 3], [0.25, 0.75]); const bx = boxplot([{ g: 'A', v: 1 }], { x: 'g', y: 'v' });",
        "const sg = createSyncGroup(); sg.attach(a); sg.destroy(); const sc = syncCharts([a, b]); sc.destroy();",
        "const csvText = exportCsv([{ x: 1, y: 2 }]); const parsedCsv = parseCsv(csvText);",
        "const fin = candlestick(el, { data: [{ d: '2026-01-01', o: 10, h: 12, l: 9, c: 11 }], x: 'd', open: 'o', high: 'h', low: 'l', close: 'c' });",
        "const finD = validateCandlestick({ data: [{ d: '2026-01-01', o: 10, h: 12, l: 9, c: 11 }], x: 'd', open: 'o', high: 'h', low: 'l', close: 'c' });",
        "export { a, b, c, d, q, qs, bx, exportSvg, exportPng, csvText, parsedCsv, fin, finD };",
      ].join('\n'));
      const result = check(project, 'tsconfig.json');
      expect(result.errors).toEqual([]);
      expect(result.status).toBe(0);
      expect(result.files).toContain(installed('axylo', 'dist', 'static.d.ts'));
      expect(result.files).toContain(installed('axylo', 'dist', 'stream.d.ts'));
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
