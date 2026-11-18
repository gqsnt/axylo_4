import { expect, it } from 'vitest';
import { stepAcross, targetOf } from '../../src/core/focus';
import { at, axes, chart, codes, committed, lastModel, marks, pixel, plot, reading, refAt, rows, scene, seriesRows, types, walk, type Type } from './model';

const fixture = (type: Type) => type === 'donut' ? [{ x: 'A', y: 2 }, { x: 'B', y: 6 }] : [{ x: 1, y: 2 }, { x: 2, y: 6 }];
const full = ['line', 'area', 'bar', 'scatter', 'donut'] as const;

for (const type of types) {
  it(`A1 ${type}: model preserves the author’s heading, uses an existing label when given and adds the description to the data summary`, () => {
    const r = chart(type, fixture(type), { title: { text: 'Sales', level: 4, visible: false }, description: 'From the ledger.' });
    r.frames();
    expect(lastModel(r)).toMatchObject({ name: 'Sales', title: { text: 'Sales', level: 4, visible: false } });
    expect(lastModel(r).summary).toContain(type === 'donut' ? '2 slices. Total 8.' : 'minimum 2, maximum 6, last 6.');
    expect(lastModel(r).summary).toContain('From the ledger.');
    r.ids['card-heading'] = 'Card heading';
    r.controller.handle.update({ labelledBy: 'card-heading' });
    r.frames();
    expect(lastModel(r)).toMatchObject({ labelledBy: 'card-heading', title: null });
    expect(codes(r)).toEqual([]);
  });

  it(`L7 ${type}: loading, empty and error draw no data marks and each state change is announced once`, () => {
    const data = fixture(type);
    const r = chart(type, data);
    r.frames();
    const handle = r.controller.handle;
    for (const [patch, message] of [
      [{ state: 'loading' }, 'Loading chart.'],
      [{ state: 'ready', data: [] }, 'No data to show.'],
      [{ state: { error: 'Query failed.' } }, 'Query failed.'],
    ] as const) {
      handle.update(patch);
      r.frames();
      expect(lastModel(r).message).toBe(message);
      expect(scene(r).marks).toEqual([]);
      expect(r.texts.at(-1)).toEqual([]);
      handle.update({ description: 'State stays the same.' });
      r.frames();
      expect(r.announcements.filter(text => text === message)).toEqual([message]);
    }
    handle.update({ state: 'ready', data });
    r.frames();
    expect(lastModel(r).message).toBeNull();
    expect(r.announcements).toEqual(['Loading chart.', 'No data to show.', 'Query failed.', 'Measurements']);
  });

  it(`L4 ${type}: a new scheme from the host repaints the committed scene within one frame`, () => {
    const r = chart(type, fixture(type));
    const resolve = r.host.theme;
    let scheme: 'light' | 'dark' = 'light';
    r.host.theme = (keys, colors) => {
      const result = resolve(keys, colors);
      return { ...result, theme: { ...result.theme, scheme } };
    };
    r.frames();
    expect(committed(r).theme.scheme).toBe('light');
    const first = scene(r);
    const draws = r.draws.length;
    scheme = 'dark';
    r.controller.invalidate.theme();
    expect(r.frames()).toBeLessThanOrEqual(1);
    expect(committed(r).theme.scheme).toBe('dark');
    expect(r.draws).toHaveLength(draws + 1);
    expect(scene(r)).toEqual(first);
  });

  it(`I5 ${type}: the first model frame has final geometry and an update commits without intervening model frames`, () => {
    const r = chart(type, fixture(type));
    expect(r.draws).toEqual([]);
    expect(r.frames()).toBe(1);
    expect(r.draws).toHaveLength(1);
    const first = scene(r);
    r.controller.handle.update({ data: fixture(type).map(row => ({ ...row, y: row.y + 3 })) });
    expect(scene(r)).toBe(first);
    expect(r.frames()).toBe(1);
    expect(r.draws).toHaveLength(2);
    expect(lastModel(r).summary).toContain(type === 'donut' ? 'Total 14.' : 'minimum 5, maximum 9, last 9.');
    expect(r.frames()).toBe(0);
    expect(r.draws).toHaveLength(2);
  });

  it(`A10 ${type}: author messages replace the model’s generated name and warning and keep built-in state text tagged English`, () => {
    const r = chart(type, [{ x: type === 'donut' ? 'A' : 1, y: 5 }, { x: type === 'donut' ? 'B' : 2, y: Infinity }], {
      title: undefined, messages: { chartName: 'Diagramm {x}', valuesNotShown: 'Ausgelassen: {count}.' },
    });
    r.host.pageLang = () => 'de';
    r.frames();
    expect(lastModel(r).name).toBe(type === 'donut' ? 'Diagramm Category' : 'Diagramm x');
    expect(lastModel(r).note).toBe('Ausgelassen: 1.');
    expect(lastModel(r).noteLang).toBeNull();
    expect(lastModel(r).summary).toContain('Ausgelassen: 1.');
    r.controller.handle.update({ state: 'loading' });
    r.frames();
    expect(lastModel(r)).toMatchObject({ message: 'Loading chart.', messageLang: 'en' });
  });
}

for (const type of full) {
  it(`A2 ${type}: the interaction model reaches every fixture datum and can go directly to either end`, () => {
    const r = chart(type, fixture(type));
    r.frames();
    const refs = walk(r);
    const { lookup } = committed(r);
    expect(refs).toHaveLength(2);
    expect(refs.map(ref => lookup.ordinal(ref))).toEqual([0, 1]);
    expect(lookup.step(refs[0]!, 'last')).toEqual(refs[1]);
    expect(lookup.step(refs[1]!, 'first')).toEqual(refs[0]);
    expect(lookup.step(refs[0]!, 'previous')).toBeNull();
    expect(lookup.step(refs[1]!, 'next')).toBeNull();
  });

  it(`A3 ${type}: the pure keyboard value text conveys identity, value with unit and position`, () => {
    const key = type === 'donut' ? 'value' : 'y';
    const r = chart(type, fixture(type), { [key]: { field: 'y', label: 'Mass', unit: 'kg' } });
    r.frames();
    const text = reading(r, walk(r)[1]!);
    expect(text).toContain(type === 'donut' ? 'B' : '2');
    if (type !== 'donut') expect(text).toContain('Mass');
    expect(text).toContain('6 kg');
    expect(text).toContain('Point 2 of 2');
  });

  it(`A4 ${type}: the lazy table uses the heading and units and reaches rows on the current range’s second page`, () => {
    const data = Array.from({ length: type === 'donut' ? 120 : 141 }, (_, i) => ({ x: type === 'donut' ? 'Label ' + i : i, y: i + 1 }));
    const opts = type === 'donut' ? { value: { field: 'y', label: 'Mass', unit: 'kg' } } : {
      x: { field: 'x', label: 'Distance', unit: 'm' }, y: { field: 'y', label: 'Mass', unit: 'kg' },
    };
    const r = chart(type, data, opts);
    if (type !== 'donut') r.controller.handle.zoom([20, 139]);
    r.frames();
    const table = committed(r).reader.table!;
    expect(table.caption).toBe('Measurements');
    expect(table.pageSize).toBe(100);
    expect(table.rowCount).toBe(120);
    expect(table.headers).toContain('Mass (kg)');
    expect(table.pageForX(type === 'donut' ? 'Label 101' : 121)).toBe(1);
    expect(table.row(101)?.[type === 'scatter' ? 2 : 1]).toBe(type === 'donut' ? '102 kg' : '122 kg');
    expect(table.row(120)).toBeNull();
    if (type !== 'donut') expect(table.headers[0]).toBe('Distance (m)');
  });

  it(`A7 ${type}: appended data is quiet and the lookup resolves a reader’s datum until it leaves the window`, () => {
    const r = chart(type, fixture(type));
    r.frames();
    const first = walk(r)[0]!;
    const donut = type === 'donut';
    r.controller.handle.append([{ x: donut ? 'C' : 3, y: 9 }], { keep: 3 });
    r.frames();
    expect(committed(r).lookup.resolve(first)).toEqual(first);
    expect(r.announcements).toEqual([]);
    r.controller.handle.append([{ x: donut ? 'D' : 4, y: 11 }], { keep: 3 });
    r.frames();
    expect(committed(r).lookup.resolve(first)).not.toEqual(first);
    expect(rows(r).map(row => row[0])).toEqual(donut ? ['B', 'C', 'D'] : ['2', '3', '4']);
    expect(r.announcements).toEqual([]);
  });

  it(`I6 ${type}: the streaming model offers pause, buffers appends while paused, and commits them on resume`, () => {
    const r = chart(type, fixture(type));
    r.frames();
    expect(committed(r).streaming).toBe(false);
    const handle = r.controller.handle;
    handle.append([{ x: type === 'donut' ? 'C' : 3, y: 9 }]);
    r.frames();
    expect(committed(r)).toMatchObject({ streaming: true, paused: false });
    r.controller.actions.pause(true);
    r.frames();
    expect(committed(r).paused).toBe(true);
    handle.append([{ x: type === 'donut' ? 'D' : 4, y: 11 }]);
    r.frames();
    expect(rows(r)).toHaveLength(3);
    r.controller.actions.pause(false);
    r.frames();
    expect(committed(r).paused).toBe(false);
    expect(rows(r)).toHaveLength(4);
    expect(r.announcements).toEqual([]);
  });

  it(`L3 ${type}: a zero-sized plot draws when the host acquires room and follows measured resizes both ways`, () => {
    const r = chart(type, fixture(type), {}, { container: { width: 0, height: 0 } });
    r.frames();
    expect(r.draws).toEqual([]);
    for (const width of [720, 360, 720]) {
      r.container = { width, height: 400 };
      r.controller.invalidate.resize();
      r.frames();
      expect(plot(r).width).toBe(width);
      expect(scene(r).width).toBe(width);
      expect(lastModel(r).message).toBeNull();
    }
  });

  it(`L8 ${type}: the undersized model keeps its title, summary and table while omitting marks`, () => {
    const r = chart(type, fixture(type), {}, { container: { width: 95, height: 150 } });
    r.frames();
    expect(codes(r)).toEqual(['AX142']);
    expect(lastModel(r)).toMatchObject({ title: { text: 'Measurements' }, summaryVisible: true });
    expect(lastModel(r).summary).toContain(type === 'donut' ? 'Total 8.' : 'minimum 2, maximum 6');
    expect(committed(r)).toMatchObject({ tooSmall: true, interactive: true });
    expect(rows(r)).toHaveLength(2);
    expect(scene(r).marks).toEqual([]);
    expect(r.texts.at(-1)).toEqual([]);
  });
}

for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
  it(`L6 ${type}: numeric axis titles use labels and units, with title, subtitle and reference label in the model`, () => {
    const r = chart(type, fixture(type), {
      title: 'Measurements', subtitle: 'Field readings', x: { field: 'x', label: 'Distance', unit: 'm' }, y: { field: 'y', label: 'Mass', unit: 'kg' },
      reference: [{ y: 5, label: 'Target' }],
    });
    r.frames();
    const titles = r.texts.at(-1)?.filter(text => ['title-x', 'title-y', 'reference'].includes(text.role)).map(text => text.full);
    expect(titles).toEqual(expect.arrayContaining(['Distance (m)', 'Mass (kg)', 'Target']));
    expect(lastModel(r)).toMatchObject({ title: { text: 'Measurements' }, subtitle: 'Field readings' });
  });

  it(`I3 ${type}: touch is opt-in and disabling zoom hides controls (reading: the author can still call zoom explicitly)`, () => {
    const r = chart(type, fixture(type), { zoom: 'touch' });
    r.frames();
    expect(committed(r).zoom).toBe('touch');
    r.controller.handle.update({ zoom: false });
    r.frames();
    expect(committed(r)).toMatchObject({ zoom: false, zoomed: false });
    expect(rows(r)).toHaveLength(2);
    r.controller.handle.zoom([1, 1.5]);
    r.frames();
    expect(committed(r)).toMatchObject({ zoom: false, zoomed: true });
    expect(rows(r)).toHaveLength(1);
  });

  it(`I2 ${type}: toggling a legend key removes that series from marks and picking and leaves its table column or rows`, () => {
    const r = chart(type, seriesRows(2), { series: 's' });
    r.frames();
    const { lookup } = committed(r);
    const first = walk(r)[0]!;
    if (first.kind === 'slice') throw new Error('Expected a Cartesian series');
    const label = lookup.datum(first)?.seriesLabel;
    r.controller.actions.toggle(first.seriesKey);
    r.frames();
    const mark = type === 'bar' ? 'rects' : type === 'scatter' ? 'points' : 'path';
    expect(marks(r, mark)).toHaveLength(1);
    const next = committed(r).lookup;
    if (type === 'scatter') {
      expect(walk(r).map(ref => next.datum(ref)?.seriesLabel)).toEqual(['Series 1', 'Series 1']);
      expect(rows(r).map(row => row[1])).toContain(label);
    } else {
      expect(at(r, 1).rows.map(row => row.seriesLabel)).toEqual(['Series 1']);
      expect(committed(r).reader.table?.headers).toContain(label);
    }
  });
}

for (const type of ['line', 'area', 'bar'] as const) {
  it(`I1 ${type}: a pointer readout has eight rows, a remaining count and distinct missing text`, () => {
    const r = chart(type, seriesRows(10).map(row => row.x === 1 && row.s === 'Series 2' ? { ...row, y: null } : row), { series: 's' });
    r.frames();
    const { x } = axes(r);
    const { plot: box } = plot(r);
    const { lookup } = committed(r);
    const tooltip = lookup.tooltip(lookup.pick(pixel(x, 1), box.y + box.height / 2)!);
    expect(tooltip.rows).toHaveLength(8);
    expect(tooltip.count - tooltip.rows.length).toBe(2);
    expect(tooltip.rows[2]?.value).toBe('No data');
    const view = committed(r).view;
    if (view.kind === 'scatter' || view.kind === 'donut') throw new Error('Expected an aligned view');
    expect(stepAcross(view, null, 'first')).toBe(1);
    expect(reading(r, refAt(r, 1))).toContain('Series 9 10');
  });
}

for (const type of ['scatter', 'donut'] as const) {
  it(`I1 ${type}: picking a visible mark provides the same value as the keyboard tooltip model`, () => {
    const r = chart(type, fixture(type));
    r.frames();
    const { lookup } = committed(r);
    const first = walk(r)[0]!;
    const mark = lookup.anchor(first)!;
    const hit = lookup.pick(mark.x + mark.width / 2, mark.y + mark.height / 2)!;
    expect(lookup.tooltip(hit).rows[0]?.value).toBe('2');
    expect(lookup.tooltip(targetOf(first)).rows[0]?.value).toBe('2');
  });
}

for (const type of ['line', 'area'] as const) {
  it(`L5 ${type}: sparse points all have markers and a dense stroke retains sparse marker cues (reading: A5 still requires sparse cues)`, () => {
    const sparse = chart(type, [{ x: 1, y: 2 }, { x: 2, y: 6 }, { x: 3, y: 4 }]);
    const dense = chart(type, Array.from({ length: 150 }, (_, x) => ({ x, y: 2 + x % 5 })));
    sparse.frames();
    dense.frames();
    expect(marks(sparse, 'points')[0]?.xy).toHaveLength(6);
    const markers = marks(dense, 'points')[0]!.xy;
    expect(markers.length).toBeLessThan(150 * 2);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.at(-2)).toBeCloseTo(pixel(axes(dense).x, 149), 3);
  });
}

for (const type of ['line', 'area'] as const) {
  it(`A5 ${type}: two drawn series have different marker shapes and contrast dashes with their series bindings`, () => {
    const r = chart(type, seriesRows(2), { series: 's' });
    r.frames();
    const [a, b] = marks(r, 'points');
    expect(a?.shape).not.toBe(b?.shape);
    expect(a?.fill).toEqual({ kind: 'series', index: 0 });
    expect(b?.fill).toEqual({ kind: 'series', index: 1 });
    const [first, second] = marks(r, 'path');
    expect(first?.dash.contrast).not.toEqual(second?.dash.contrast);
  });
}

it('A5 bar: adjacent stacked bars leave one pixel for the background while preserving the outer total', () => {
  const r = chart('bar', [{ x: 'A', a: 3, b: 4 }], { y: ['a', 'b'], layout: 'stacked' });
  r.frames();
  const { y } = axes(r);
  const [a, b] = marks(r, 'rects');
  const innerEdge = b!.xywh[1]! + b!.xywh[3]!;
  expect(a!.xywh[1]! - innerEdge).toBeCloseTo(1, 3);
  expect(b!.xywh[1]).toBeCloseTo(y.map(7), 3);
});

it('A5 donut: adjacent slices carry a background separator in the scene handed to the renderer', () => {
  const r = chart('donut', fixture('donut'));
  r.frames();
  const arc = marks(r, 'arcs')[0]!;
  expect(arc.angles).toHaveLength(4);
  expect(arc.gap).toBeGreaterThanOrEqual(1);
});

it('A5 scatter: separate series have distinct marker shapes as well as paint bindings', () => {
  const r = chart('scatter', seriesRows(2), { series: 's' });
  r.frames();
  const [a, b] = marks(r, 'points');
  expect(a?.shape).not.toBe(b?.shape);
  expect(a?.fill).toEqual({ kind: 'series', index: 0 });
  expect(b?.fill).toEqual({ kind: 'series', index: 1 });
});

it('A5 compact: when there is no legend two series remain distinguishable by dash with their paint bindings', () => {
  const r = chart('compact', seriesRows(2), { series: 's' });
  r.frames();
  const [a, b] = marks(r, 'path');
  expect(a?.dash.normal).not.toEqual(b?.dash.normal);
  expect(a?.stroke).toEqual({ kind: 'series', index: 0 });
  expect(b?.stroke).toEqual({ kind: 'series', index: 1 });
});

it('L6 donut: title and subtitle are part of the figure model without Cartesian axis titles', () => {
  const r = chart('donut', fixture('donut'), { title: 'Parts', subtitle: 'Field readings' });
  r.frames();
  expect(lastModel(r)).toMatchObject({ title: { text: 'Parts' }, subtitle: 'Field readings' });
  expect(r.texts.at(-1)?.filter(text => text.role === 'title-x' || text.role === 'title-y')).toEqual([]);
});

for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
  it(`L1 ${type}: measured plot labels fit inside the modeled canvas without intersecting at three widths`, () => {
    const data = [{ x: 1, y: 24 }, { x: 2, y: 32 }, { x: 3, y: 48 }];
    for (const width of [240, 720, 1920]) {
      const r = chart(type, data, {}, { container: { width, height: 400 } });
      r.frames();
      const layout = plot(r);
      if (layout.kind !== 'plot') throw new Error('Expected labeled plot');
      const labels = r.texts.at(-1)!;
      expect(labels.some(label => label.role === 'tick-x')).toBe(true);
      expect(labels.some(label => label.role === 'tick-y')).toBe(true);
      for (const [i, { box }] of labels.entries()) {
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.y).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(layout.height + 1);
        for (const { box: next } of labels.slice(i + 1)) {
          const width = Math.min(box.x + box.width, next.x + next.width) - Math.max(box.x, next.x);
          const height = Math.min(box.y + box.height, next.y + next.height) - Math.max(box.y, next.y);
          expect(width <= 1 || height <= 1).toBe(true);
        }
      }
    }
  });
}
