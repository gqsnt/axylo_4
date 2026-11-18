import { expect, it } from 'vitest';
import { validate } from '../../src/index';
import type { ChartKind } from '../../src/core/controller';
import type { Diagnostic } from '../../src/public';
import { at, chart, codes, committed, compactKinds, defaultMessages, lastModel, marks, rows, scene, types, type Recording, type Type } from './model';

const validateOptions = validate as (type: ChartKind, options: unknown) => Diagnostic[];
const input = (type: Type) => type === 'donut' ? [{ x: 'A', y: 6 }, { x: 'B', y: 8 }] : [{ x: 1, y: 6 }, { x: 2, y: 8 }];
const encodingFor = (type: Type) => type === 'donut' ? 'value' : 'y';
const valueColumn = (type: Type) => type === 'scatter' ? 2 : 1;

function checkValues(r: Recording, type: Type, expected: readonly string[]) {
  if (type === 'compact') {
    expect(lastModel(r).summary).toContain(expected.at(-1));
  } else {
    expect(rows(r).map(row => row[valueColumn(type)])).toEqual(expected);
  }
}

for (const type of types) {
  it(`DX2 ${type}: supported row and column forms draw the same fixture and preserve caller row indexes in diagnostics`, () => {
    for (const kind of compactKinds(type)) {
      const donut = type === 'donut';
      const xs = donut ? ['A', 'B', 'C'] : [1, 2, 3];
      const wide = [{ x: xs[0], y: 6 }, { x: xs[1], y: Infinity }, { x: xs[2], y: 8 }];
      const columns = { columns: { x: donut ? xs : new Float64Array(xs as number[]), y: new Float32Array([6, Infinity, 8]) } };
      const long = wide.map(row => ({ ...row, s: 'y' }));
      const data = [chart(type, wide, {}, undefined, kind), chart(type, columns, {}, undefined, kind)];
      if (!donut) data.push(chart(type, long, { series: 's' }, undefined, kind));
      if (!donut && type !== 'scatter') data.push(chart(type, wide, { y: ['y'] }, undefined, kind));
      for (const r of data) {
        r.frames();
        expect(r.controller.handle.diagnostics).toMatchObject([{ code: 'AX103', field: 'y', rows: [1] }]);
        expect(lastModel(r).summary).toContain('Values not shown: 1.');
        const expected = ['6', defaultMessages.noData, '8'];
        if (type === 'scatter') expect(rows(r).map(row => row[0])).toEqual(['1', '2', '3']);
        checkValues(r, type, expected);
      }
      for (const r of data.slice(1)) expect(scene(r)).toEqual(scene(data[0]!));
    }
  });

  it(`DX3 ${type}: untyped misspelled fields, strings mixed with numbers and inapplicable keys report their codes`, () => {
    for (const kind of compactKinds(type)) {
      const encoding = encodingFor(type);
      const data = input(type);
      const misspelled = chart(type, data, { [encoding]: 'wrong' }, undefined, kind);
      expect(codes(misspelled)).toEqual(['AX101']);
      misspelled.frames();
      expect(lastModel(misspelled).message).toBe(defaultMessages.error);
      const mixed = chart(type, [data[0], { ...data[1], y: 'oops' }], {}, undefined, kind);
      expect(codes(mixed)).toEqual(['AX106']);
      mixed.frames();
      expect(lastModel(mixed).summary).toContain('Values not shown: 1.');
      const unsupported = chart(type, data, (type === 'bar' || type === 'compact' && kind === 'bar') ? { stacked: true } : { horizontal: true }, undefined, kind);
      expect(codes(unsupported)).toEqual(['AX150']);
      unsupported.frames();
      expect(lastModel(unsupported).message).toBeNull();
      checkValues(unsupported, type, ['6', '8']);
    }
  });

  it(`DX4 ${type}: reports one field, caller row index, chart name and a fix synchronously`, () => {
    for (const kind of compactKinds(type)) {
      const received: Diagnostic[] = [];
      const r = chart(type, [...input(type), { x: type === 'donut' ? 'C' : 3, y: Infinity }], {
        onDiagnostic: (d: Diagnostic) => received.push(d),
      }, undefined, kind);
      expect(received).toMatchObject([{
        code: 'AX103', level: 'warning', chart: 'Measurements', field: 'y', rows: [2],
        message: expect.stringMatching(/y.*row 2.*check the calculation.*send null/i),
      }]);
      r.frames();
      r.frames();
      expect(received).toHaveLength(1);
      expect(r.printed.filter(message => message.includes('AX103'))).toHaveLength(1);
      expect(lastModel(r).summary).toContain('Values not shown: 1.');
    }
  });

  it(`DX5 ${type}: replace then append then zoom in one turn switches marks, text and lookup together`, () => {
    for (const kind of compactKinds(type)) {
      const donut = type === 'donut';
      const r = chart(type, input(type), {}, undefined, kind);
      r.frames();
      const before = committed(r);
      const oldScene = scene(r);
      const oldText = r.texts.at(-1);
      const count = r.commits;
      const handle = r.controller.handle;
      handle.update({ data: [{ x: donut ? 'C' : 10, y: 21 }, { x: donut ? 'D' : 20, y: 35 }] });
      handle.append([{ x: donut ? 'E' : 30, y: 72 }]);
      handle.zoom([20, 30]);
      expect(r.committed).toBe(before);
      expect(scene(r)).toBe(oldScene);
      expect(r.texts.at(-1)).toBe(oldText);
      expect(lastModel(r).summary).not.toContain('72');
      expect(r.frames()).toBe(1);
      expect(r.commits).toBe(count + 1);
      expect(scene(r)).not.toEqual(oldScene);
      expect(lastModel(r).summary).toContain('72');
      checkValues(r, type, donut || type === 'compact' ? ['21', '35', '72'] : ['35', '72']);
      if (type !== 'compact') expect(committed(r).lookup.count).toBe(donut ? 3 : 2);
      if (!donut && type !== 'compact') expect(r.texts.at(-1)).not.toEqual(oldText);
    }
  });

  it(`DX5 ${type}: a present patch key replaces the whole field, undefined restores the default, and absent keys stay`, () => {
    for (const kind of compactKinds(type)) {
      const key = encodingFor(type);
      const r = chart(type, input(type), { [key]: { field: 'y', unit: 'old unit' }, title: 'Retained', table: false }, undefined, kind);
      r.frames();
      expect(lastModel(r).summary).toContain('8 old unit');
      expect(committed(r).reader.table).toBeNull();
      r.controller.handle.update({ [key]: { field: 'y', label: 'Measure' }, table: undefined });
      r.frames();
      expect(lastModel(r).summary).not.toContain('old unit');
      expect(lastModel(r).title?.text).toBe('Retained');
      checkValues(r, type, ['6', '8']);
      if (type !== 'compact') expect(committed(r).reader.table?.headers).toContain('Measure');
    }
  });

  it(`DX5 ${type}: strict create, update and append reject warnings synchronously and keep the last valid chart`, () => {
    for (const kind of compactKinds(type)) {
      const bad = { x: type === 'donut' ? 'C' : 3, y: Infinity };
      expect(() => chart(type, [...input(type), bad], { strict: true }, { console: false }, kind)).toThrow(/AX103/);
      const r = chart(type, input(type), { strict: true }, { console: false }, kind);
      const handle = r.controller.handle;
      r.frames();
      const before = committed(r);
      const drawn = scene(r);
      expect(() => handle.update({ data: [...input(type), bad] })).toThrow(/AX103/);
      expect(() => handle.append([bad])).toThrow(/AX103/);
      expect(codes(r)).toEqual([]);
      expect(r.committed).toBe(before);
      r.frames();
      expect(scene(r)).toBe(drawn);
      handle.append([{ ...bad, y: 10 }]);
      r.frames();
      checkValues(r, type, ['6', '8', '10']);
    }
  });

  it(`DX5 ${type}: destroy cancels the pending frame and later calls have no effect`, () => {
    for (const kind of compactKinds(type)) {
      const r = chart(type, input(type), {}, undefined, kind);
      const handle = r.controller.handle;
      expect('resize' in handle).toBe(false);
      handle.destroy();
      handle.update({ title: 'Late' });
      handle.append(input(type));
      handle.zoom([1, 2]);
      handle.destroy();
      expect(r.disposed).toBe(1);
      expect(r.frames()).toBe(0);
      expect(r.draws).toEqual([]);
      expect(r.texts).toEqual([]);
      expect(r.models).toEqual([]);
      expect(r.committed).toBeNull();
    }
  });

  it(`DX8 ${type}: Node import and validate give the same call-time diagnostics as the controller`, () => {
    for (const kind of compactKinds(type)) {
      expect(typeof document).toBe('undefined');
      const end = [...input(type), { x: type === 'donut' ? 'C' : 3, y: NaN }];
      const options = {
        title: 'Measurements', data: end, ...(type === 'donut' ? { label: 'x', value: 'y' } : { x: 'x', y: 'y' }),
        ...(type === 'compact' ? { compact: true } : {}),
      };
      const r = chart(type, end, {}, undefined, kind);
      const found = validateOptions(type === 'compact' ? kind : type, options);
      expect(found).toMatchObject([{ code: 'AX103', field: 'y', rows: [2], chart: 'Measurements' }]);
      expect(found).toEqual(r.controller.handle.diagnostics);
      expect(r.draws).toEqual([]);
    }
  });

  it(`DX6 ${type}: a named color reaches the theme by series key as other entries change`, () => {
    for (const kind of compactKinds(type)) {
      const donut = type === 'donut';
      const target = donut ? 'B' : 'North';
      const colors = { [target]: 'rebeccapurple' };
      const data = donut ? [{ x: 'A', y: 4 }, { x: 'B', y: 6 }] :
        [{ x: 1, y: 4, s: 'South' }, { x: 1, y: 6, s: 'North' }, { x: 2, y: 7, s: 'North' }];
      const r = chart(type, data, { colors, ...(donut ? {} : { series: 's' }) }, undefined, kind);
      r.frames();
      expect(r.themeCalls.at(-1)).toEqual({ keys: donut ? ['A', 'B'] : ['South', 'North'], colors });
      r.controller.handle.update({ data: data.filter(row => 's' in row ? row.s === target : row.x === target) });
      r.frames();
      expect(r.themeCalls.at(-1)).toEqual({ keys: [target], colors });
      const painted = donut ? marks(r, 'arcs')[0]?.fills[0] : (type === 'bar' || type === 'compact' && kind === 'bar') ? marks(r, 'rects')[0]?.fill :
        type === 'scatter' ? marks(r, 'points')[0]?.fill : marks(r, 'path')[0]?.stroke;
      expect(painted).toEqual({ kind: 'series', index: 0 });
      if (!donut && type !== 'scatter' && type !== 'compact') expect(at(r, 1).rows[0]?.seriesLabel).toBe(target);
    }
  });
}

it('DX3 line: untyped wide y combined with series raises AX150 and still reads the wide field', () => {
  const r = chart('line', [{ x: 1, y: 4, s: 'Named' }, { x: 2, y: 8, s: 'Named' }], { y: ['y'], series: 's' });
  expect(codes(r)).toEqual(['AX150']);
  r.frames();
  expect(at(r, 1).rows.map(row => [row.seriesLabel, row.value])).toEqual([['y', '4']]);
});

for (const type of types) {
  it(`DX5 ${type}: a strict field error is synchronous and the accepted title, marks and reader survive it`, () => {
    for (const kind of compactKinds(type)) {
      const r = chart(type, input(type), { strict: true }, undefined, kind);
      r.frames();
      const before = scene(r);
      expect(() => r.controller.handle.update({ title: 'Rejected', [encodingFor(type)]: 'doesNotExist' })).toThrow(/AX101/);
      expect(r.frames()).toBe(0);
      expect(scene(r)).toBe(before);
      expect(lastModel(r).title?.text).toBe('Measurements');
      checkValues(r, type, ['6', '8']);
    }
  });
}
