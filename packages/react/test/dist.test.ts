/**
 * The shipped package (review findings 1 and 8): built by build.mjs, then used through its package name, as
 * an application would: the directive, no bare __DEV__, the size budget, server rendering in Node, a
 * consumer bundle that imports only Line, and the declarations.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

const pkg = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(pkg, '../..');
const read = (file: string) => fs.readFileSync(path.join(pkg, 'dist', file), 'utf8');

beforeAll(() => {
  execFileSync('node', [path.join(pkg, 'build.mjs')], { cwd: repo, stdio: 'pipe' });
}, 120000);

describe('shipped files', () => {
  for (const file of ['index.js', 'index.dev.js']) {
    it(`${file} starts with the 'use client' directive and has no bare __DEV__`, () => {
      const code = read(file);
      expect(code.startsWith("'use client';\n")).toBe(true);
      expect(code.match(/use client/g)).toHaveLength(1);
      expect(code).not.toMatch(/\b__DEV__\b/);
      expect(code).not.toMatch(/axylo-figure|ResizeObserver/);
    });
  }

  it('the production file drops the development hint, the development file keeps it', () => {
    expect(read('index.js')).not.toContain('[axylo/react]');
    expect(read('index.dev.js')).toContain('[axylo/react]');
  });

  it('the production file is at most 2 KiB gzipped', () => {
    const code = fs.readFileSync(path.join(pkg, 'dist/index.js'));
    const gzip = gzipSync(code, { level: 9 }).length;
    console.info(`@axylo/react dist/index.js: ${code.length} B, ${gzip} B gzip (level 9)`);
    expect(gzip).toBeLessThanOrEqual(2048);
  });

  it('the declarations are what a consumer type-checks against', () => {
    expect(read('index.d.ts')).toContain('export declare const Line: <Row>(props: LineProps<Row>) => ReactElement | null;');
    // test/consumer imports '@axylo/react' with no path mapping, so it reaches dist/index.d.ts.
    execFileSync('npx', ['tsc', '-p', path.join(pkg, 'test/consumer')], { cwd: repo, stdio: 'pipe' });
  });
});

describe('server rendering through the package name', () => {
  // Types from source, so `tsc -p packages/react` does not need dist; the runtime import is the shipped one.
  type Components = typeof import('../src/index');
  const shipped = (specifier: string) => import(specifier) as Promise<Components>;
  const rows = [{ day: '2026-01-01', channel: 'Direct', sessions: 10, visits: 4 }, { day: '2026-01-02', channel: 'Direct', sessions: 12, visits: 5 }];
  type Row = (typeof rows)[number];

  const elements = ({ Area, Bar, Donut, Line, Scatter }: Components): [string, ReactElement][] => [
    ['Line', createElement(Line<Row>, { data: rows, x: 'day', y: 'sessions', series: 'channel', title: 'Sessions' })],
    ['Area', createElement(Area<Row>, { data: rows, x: 'day', y: 'sessions', stacked: true })],
    ['Bar', createElement(Bar<Row>, { data: rows, x: 'channel', y: 'sessions' })],
    ['Scatter', createElement(Scatter<Row>, { data: rows, x: 'visits', y: 'sessions' })],
    ['Donut', createElement(Donut<Row>, { data: rows, label: 'channel', value: 'sessions' })],
  ];

  it('runs without a DOM', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  });

  for (const [label, load] of [
    ['@axylo/react', () => shipped('@axylo/react')],
    ['dist/index.js', () => shipped('../dist/index.js')],
  ] as const) {
    it(`${label}: each component renders its empty container`, async () => {
      const components = await load();
      for (const [, element] of elements(components)) expect(renderToString(element)).toBe('<div class="axylo"></div>');
    });

    it(`${label}: id, className, style and data-* render on the container; aria-* and options do not`, async () => {
      const { Line } = await load();
      const html = renderToString(createElement(Line<Row>, {
        data: rows, x: 'day', y: 'sessions', title: 'T', id: 'card', className: 'card wide', style: { height: 300 }, 'data-testid': 'chart',
        ...{ 'aria-label': 'Not forwarded' },
      }));
      expect(html).toBe('<div class="axylo card wide" id="card" style="height:300px" data-testid="chart"></div>');
    });
  }
});

describe('a consumer that imports only Line (finding 8)', () => {
  // Stand-ins for the core with one marker each, so what the consumer's bundler kept can be read off.
  const core: Plugin = {
    name: 'core-stand-in',
    setup(b) {
      b.onResolve({ filter: /^axylo$/ }, () => ({ path: 'axylo', namespace: 'stand-in' }));
      b.onLoad({ filter: /.*/, namespace: 'stand-in' }, () => ({
        contents: ['line', 'area', 'bar', 'scatter', 'donut'].map(k => `export function ${k}() { return 'core-${k}'; }`).join('\n'),
        loader: 'js',
      }));
    },
  };

  for (const conditions of [[], ['development']]) {
    it(`keeps only the line chart (conditions: ${conditions.join(', ') || 'default'})`, async () => {
      const result = await build({
        stdin: { contents: "import { Line } from '@axylo/react'; console.log(Line);", resolveDir: repo, loader: 'js' },
        bundle: true, format: 'esm', write: false, logLevel: 'silent', conditions, external: ['react', 'react/jsx-runtime'], plugins: [core],
      });
      const code = result.outputFiles[0]!.text;
      expect(code).toContain('core-line');
      for (const other of ['area', 'bar', 'scatter', 'donut']) expect(code).not.toContain(`core-${other}`);
      for (const other of ['"Area"', '"Bar"', '"Scatter"', '"Donut"']) expect(code).not.toContain(other);
    });
  }
});
