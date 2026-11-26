/**
 * The opt-in entries (C3.1): `axylo/static` drives the same controller with no stream factory, and
 * `axylo/stream` is the root entry named for pages that append. The recording host (test/core/host.ts) builds
 * its controller with `createController`; here that is the static controller over the static compositions, so
 * every call below runs the code a static chart runs, in Node.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Composition } from '../../src/core/composition';
import type { ChartKind, Controller, Host } from '../../src/core/controller';
import type { LineOptions, Point } from '../../src/public';
import * as root from '../../src/index';
import * as staticEntry from '../../src/static';
import * as streamEntry from '../../src/stream';
import { AREA, AREA_STATIC } from '../../src/kinds/area';
import { BAR, BAR_STATIC } from '../../src/kinds/bar';
import { DONUT, DONUT_STATIC } from '../../src/kinds/donut';
import { HISTOGRAM, HISTOGRAM_STATIC } from '../../src/kinds/histogram';
import { LINE, LINE_STATIC } from '../../src/kinds/line';
import { SCATTER, SCATTER_STATIC } from '../../src/kinds/scatter';
import { record } from './host';

vi.mock('../../src/core/controller', async original => {
  const actual = await original<typeof import('../../src/core/controller')>();
  const statics: Record<string, Composition> = {
    line: (await import('../../src/kinds/line')).LINE_STATIC,
    area: (await import('../../src/kinds/area')).AREA_STATIC,
    bar: (await import('../../src/kinds/bar')).BAR_STATIC,
    histogram: (await import('../../src/kinds/histogram')).HISTOGRAM_STATIC,
    scatter: (await import('../../src/kinds/scatter')).SCATTER_STATIC,
    donut: (await import('../../src/kinds/donut')).DONUT_STATIC,
  };
  return {
    ...actual,
    createController: (kind: ChartKind, input: unknown, page: Host): Controller => actual.staticControllerFor(statics[kind]!, input, page),
  };
});

const PAIRS: [string, Composition, Composition][] = [
  ['line', LINE, LINE_STATIC], ['area', AREA, AREA_STATIC], ['bar', BAR, BAR_STATIC],
  ['histogram', HISTOGRAM, HISTOGRAM_STATIC], ['scatter', SCATTER, SCATTER_STATIC], ['donut', DONUT, DONUT_STATIC],
];
const APPEND_MESSAGE = 'append() is not available on charts created from axylo/static; import from axylo/stream or axylo for streaming.';
const KEYS = ['kind', 'resolve', 'normalize', 'view', 'timeReadout', 'scene', 'lookup', 'reader'] as const;

describe('static compositions', () => {
  for (const [kind, streaming, fixed] of PAIRS) {
    it(`${kind}: has no openStore and agrees with the streaming composition on every other stage`, () => {
      expect(fixed.openStore).toBeUndefined();
      expect(typeof streaming.openStore).toBe('function');
      expect(Object.keys(fixed).sort()).toEqual(Object.keys(streaming).filter(k => k !== 'openStore').sort());
      // The same function, or (scatter and donut wrap their normalization in an arrow in each literal) the same source.
      for (const key of KEYS) {
        const same = fixed[key] === streaming[key] || (typeof fixed[key] === 'function' && String(fixed[key]) === String(streaming[key]));
        expect(same, key).toBe(true);
      }
      expect(fixed.interaction).toEqual(streaming.interaction);
      expect(fixed.svg).toEqual(streaming.svg);
      // The layout is a getter in some kinds: both give a stage with the same functions.
      expect(Object.keys(fixed.layout).sort()).toEqual(Object.keys(streaming.layout).sort());
    });
  }
});

describe('staticControllerFor', () => {
  const data = [0, 1, 2, 3].map(x => ({ x, y: x * 10 }));
  const describeOf = (r: ReturnType<typeof record>) => r.controller.handle.__bench!.describe();

  it('creates, draws, updates and zooms as a streaming chart does', () => {
    const r = record('line', { title: 'Static', data, x: 'x', y: 'y' });
    r.frames();
    expect(r.draws.length).toBeGreaterThan(0);
    expect(r.controller.handle.diagnostics).toEqual([]);
    expect(describeOf(r).series.map(s => s.key)).toEqual(['y']);
    expect(describeOf(r).series[0]!.newestX).toBe(3);

    r.controller.handle.update({ data: [...data, { x: 4, y: 40 }] });
    r.frames();
    expect(describeOf(r).series[0]!.newestX).toBe(4);

    const zooms: unknown[] = [];
    r.controller.handle.on('zoom', z => zooms.push(z));
    r.controller.handle.zoom([1, 3]);
    r.frames();
    expect(zooms.length).toBe(1);
    r.controller.handle.zoom(null);
    r.frames();
    expect(zooms.length).toBe(2);
  });

  it('rejects a strict update and keeps the last valid state', () => {
    const r = record('line', { title: 'Strict', strict: true, data, x: 'x', y: 'y' });
    r.frames();
    const before = { diagnostics: r.controller.handle.diagnostics, describe: describeOf(r), revision: r.controller.handle.__bench!.revision };
    // A y field the rows do not have: a finding under strict, so the update is rejected (spec 3.5).
    expect(() => r.controller.handle.update({ y: 'missing' })).toThrow();
    r.frames();
    expect(r.controller.handle.diagnostics).toEqual(before.diagnostics);
    expect(describeOf(r)).toEqual(before.describe);
    expect(r.controller.handle.__bench!.revision).toBe(before.revision);
  });

  it('hover reads the row under the pointer', () => {
    const r = record('line', { title: 'Hover', data, x: 'x', y: 'y' });
    r.frames();
    const hovers: (Point<unknown> | null)[] = [];
    r.controller.handle.on('hover', p => hovers.push(p));
    r.controller.actions.hover({ kind: 'aligned', seriesKey: 'y', x: 2 });
    expect(hovers[0]).toEqual({ series: 'y', x: 2, y: 20, row: data[2], index: 2 });
  });

  it('append() throws a clear error and leaves the chart as it was', () => {
    const r = record('line', { title: 'Append', data, x: 'x', y: 'y' });
    r.frames();
    const before = { diagnostics: r.controller.handle.diagnostics, describe: describeOf(r), revision: r.controller.handle.__bench!.revision };
    expect(() => r.controller.handle.append([{ x: 9, y: 90 }])).toThrow(APPEND_MESSAGE);
    expect(() => r.controller.handle.append([])).toThrow(APPEND_MESSAGE);
    expect(r.pending).toBe(0);
    r.frames();
    expect(r.controller.handle.diagnostics).toEqual(before.diagnostics);
    expect(describeOf(r)).toEqual(before.describe);
    expect(r.controller.handle.__bench!.revision).toBe(before.revision);
    // Still a working chart after the refused call.
    r.controller.handle.update({ data: data.slice(0, 2) });
    r.frames();
    expect(describeOf(r).series[0]!.newestX).toBe(1);
  });
});

describe('entry modules in Node', () => {
  const names = ['area', 'bar', 'donut', 'histogram', 'line', 'scatter', 'validate'];

  it('axylo/static and axylo/stream export the same names as the root entry', () => {
    expect(Object.keys(root).sort()).toEqual(names);
    expect(Object.keys(staticEntry).sort()).toEqual(names);
    expect(Object.keys(streamEntry).sort()).toEqual(names);
  });

  it('axylo/stream is the root entry; axylo/static has its own chart functions and the same validate', () => {
    for (const name of names) expect((streamEntry as Record<string, unknown>)[name]).toBe((root as Record<string, unknown>)[name]);
    expect(staticEntry.validate).toBe(root.validate);
    expect(staticEntry.line).not.toBe(root.line);
  });

  it('validate gives the same diagnostics from every entry', () => {
    type Row = { x: number; y: number; nope?: number };
    const rows: Row[] = [{ x: 1, y: 2 }];
    // The y field names no column of the rows: a finding (spec 3.5) every entry must report alike.
    const good: LineOptions<Row> = { data: rows, x: 'x', y: 'y', title: 'Ok' };
    const bad: LineOptions<Row> = { data: rows, x: 'x', y: 'nope' };
    for (const options of [good, bad]) {
      const expected = root.validate('line', options);
      expect(staticEntry.validate('line', options)).toEqual(expected);
      expect(streamEntry.validate('line', options)).toEqual(expected);
    }
    expect(root.validate('line', bad).length).toBeGreaterThan(0);
  });
});
