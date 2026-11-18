import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, expect, it } from 'vitest';
import type { record } from '../core/host';
import { codes, lastModel, scene } from './model';

let production: typeof record;

beforeAll(async () => {
  // Bundle the same controller and recording host with the production define, without writing build files.
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../core/host.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, define: { __DEV__: 'false' },
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0]!.contents).toString('base64');
  production = (await import(/* @vite-ignore */ url) as { record: typeof record }).record;
});

for (const type of ['line', 'area', 'bar', 'scatter', 'donut'] as const) {
  it(`F12 ${type}: production still reports omitted values in the figure and summary`, () => {
    const data = [{ x: 1, y: 8 }, { x: 2, y: Infinity }, { x: 3, y: 5 }];
    const options = type === 'donut' ? { label: 'x', value: 'y' } : { x: 'x', y: 'y' };
    const r = production(type, { ...options, data, title: 'Measured', locale: 'en-US' });
    r.frames();
    expect(codes(r)).toEqual(['AX103']);
    expect(r.printed.filter(message => message.includes('AX103'))).toHaveLength(1);
    expect(lastModel(r).note).toBe('Values not shown: 1. See table.');
    expect(lastModel(r).summary).toContain('Values not shown: 1. See table.');
    expect(scene(r).marks.some(mark => ['arcs', 'points', 'path', 'rects'].includes(mark.type))).toBe(true);
  });
}

it('C5 compact: production supplies the omission count to both the corner marker and summary', () => {
  const r = production('line', {
    x: 'x', y: 'y', compact: true, title: 'Measured', data: [{ x: 1, y: 3 }, { x: 2, y: Infinity }, { x: 3, y: 8 }],
  });
  r.frames();
  expect(codes(r)).toEqual(['AX103']);
  expect(lastModel(r).compact).toBe(true);
  expect(lastModel(r).note).toContain('Values not shown: 1.');
  expect(lastModel(r).summary).toContain('Values not shown: 1.');
});

it('DX4 line: production delivers hint AX104 to the callback while keeping the console quiet', () => {
  const received: string[] = [];
  const r = production('line', {
    x: 'x', y: 'y', data: [{ x: 1, y: '3' }, { x: 2, y: '8' }], title: 'Measured',
    onDiagnostic: (d: { code: string }) => received.push(d.code),
  });
  r.frames();
  expect(codes(r)).toEqual(['AX104']);
  expect(received).toEqual(['AX104']);
  expect(r.printed).toEqual([]);
});
