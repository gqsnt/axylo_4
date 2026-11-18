import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, expect, it } from 'vitest';
import path from 'node:path';
import type { createController } from '../../src/core/controller';
import type { record } from '../core/host';
import { aligned, codes, defaultMessages, lastModel, message, scene } from './model';

let production: typeof record;
let productionController: typeof createController;

beforeAll(async () => {
  // Bundle the same controller and recording host with the production define, without writing build files.
  const host = fileURLToPath(new URL('../core/host.ts', import.meta.url));
  const controller = fileURLToPath(new URL('../../src/core/controller.ts', import.meta.url));
  const bundle = await build({
    stdin: { contents: `export { record } from ${JSON.stringify(host)};\nexport { createController } from ${JSON.stringify(controller)};`, resolveDir: path.dirname(host), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, define: { __DEV__: 'false' },
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0]!.contents).toString('base64');
  ({ record: production, createController: productionController } = await import(/* @vite-ignore */ url) as {
    record: typeof record; createController: typeof createController;
  });
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
  for (const kind of aligned) {
    const r = production(kind, {
      x: 'x', y: 'y', compact: true, title: 'Measured', data: [{ x: 1, y: 3 }, { x: 2, y: Infinity }, { x: 3, y: 8 }],
    });
    r.frames();
    expect(codes(r)).toEqual(['AX103']);
    expect(lastModel(r).compact).toBe(true);
    expect(lastModel(r).note).toContain('Values not shown: 1.');
    expect(lastModel(r).summary).toContain('Values not shown: 1.');
  }
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

it('F3 line: AX140 reaches the reader and prints once without a title in production', () => {
  const receive: string[] = [];
  const r = production('line', {
    x: 'x', y: 'y', data: [{ x: 1, y: 3 }, { x: 2, y: 8 }],
    onDiagnostic: (d: { code: string }) => receive.push(d.code),
  });
  r.frames();
  r.controller.invalidate.resize();
  r.frames();
  expect(codes(r)).toEqual(['AX140']);
  expect(receive).toEqual(['AX140']);
  expect(r.printed.filter(printed => printed.includes('AX140'))).toHaveLength(1);
  expect(lastModel(r).name).toBe(message('chartName', { type: defaultMessages.typeLine, x: 'x', y: 'y' }));
  expect(scene(r).marks.some(mark => mark.type === 'path')).toBe(true);
});

// Spec 3.5 (delivery): errors and warnings print once per code per page in every build; hints print only in
// development builds; onDiagnostic receives every diagnostic a chart newly finds.
const deliveryKinds = [['line', 'line'], ['area', 'area'], ['bar', 'bar'], ['scatter', 'scatter'], ['donut', 'donut'],
  ['compact line', 'line'], ['compact area', 'area'], ['compact bar', 'bar']] as const;
const encodingOf = (kind: string) => kind === 'donut' ? { label: 'x', value: 'y' } : { x: 'x', y: 'y' };
const xs = (kind: string) => kind === 'donut' ? ['A', 'B', 'C'] : [1, 2, 3];

for (const [type, kind] of deliveryKinds) {
  const compact = type.startsWith('compact') ? { compact: true } : {};
  it(`F3 ${type}: an error prints once in a production build and the chart shows its error state`, () => {
    const r = production(kind, { title: 'Measured', ...encodingOf(kind), ...compact, y: undefined, ...(kind === 'donut' ? { value: 'mass' } : { y: 'mass' }),
      data: xs(kind).map((x, i) => ({ x, y: i + 1 })) });
    r.frames();
    expect(r.controller.handle.diagnostics).toMatchObject([{ code: 'AX101', level: 'error' }]);
    expect(r.printed.filter(printed => printed.startsWith('[axylo AX101]'))).toHaveLength(1);
    expect(scene(r).marks).toEqual([]);
    expect(lastModel(r).message).toBe(defaultMessages.error);
  });

  it(`F3 ${type}: in production a code prints once per page across two charts`, () => {
    const options = (title: string) => ({ title, ...encodingOf(kind), ...compact, data: xs(kind).map((x, i) => ({ x, y: i === 1 ? Infinity : i + 1 })) });
    const first = production(kind, options('First'));
    const second = productionController(kind, options('Second'), { ...first.host, id: 'axylo-test-second' });
    first.frames();
    expect(first.controller.handle.diagnostics.map(d => d.code)).toEqual(['AX103']);
    expect(second.handle.diagnostics.map(d => d.code)).toEqual(['AX103']);
    // Both charts share the page (and its console): the warning is printed by whichever reports it first.
    expect(first.printed.filter(printed => printed.startsWith('[axylo AX103]'))).toHaveLength(1);
  });

  it(`F3 ${type}: in production a hint is delivered to onDiagnostic and not printed`, () => {
    const received: string[] = [];
    const r = production(kind, { title: 'Measured', ...encodingOf(kind), ...compact, data: xs(kind).map((x, i) => ({ x, y: String(i + 1) })),
      onDiagnostic: (d: { code: string }) => received.push(d.code) });
    r.frames();
    expect(codes(r)).toEqual(['AX104']);
    expect(r.controller.handle.diagnostics[0]?.level).toBe('hint');
    expect(received).toEqual(['AX104']);
    expect(r.printed).toEqual([]);
  });
}
