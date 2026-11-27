/**
 * W3 integration repair 4, finding 4 (repeated-x scatter) under `missing: 'zero'`. Expected values are worked
 * out from the spec, not from a run:
 * - F2: `missing: 'zero'` on the field turns absent and null values into zeros; an explicit null without it is a
 *   silent gap; a value that cannot be read (a stray string) is omitted with its diagnostic (AX106).
 * - F11: on a scatter, rows that share an x are ordinary data, so each row is its own point whichever comes first.
 * - Spec 3.6 / I3: the event names the caller's row (`index`, `row`) and the plotted x and y.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef } from '../../src/core/contracts';
import { controllerFor } from '../../src/core/controller';
import type { Composition } from '../../src/core/composition';
import { createCartesianResolver, parseCartesianInput } from '../../src/cartesian/options';
import { normalizeCartesian } from '../../src/cartesian/normalize';
import { buildCartesianView } from '../../src/cartesian/view';
import { createCartesianLayoutStage } from '../../src/cartesian/layout';
import { buildCartesianScene } from '../../src/cartesian/scene';
import { createCartesianLookup } from '../../src/cartesian/lookup';
import { createCartesianReader } from '../../src/cartesian/reader';
import { createCartesianOverlay } from '../../src/cartesian/overlay';
import { createMarkSwatch } from '../../src/cartesian/mark-swatch';
import type { CartesianStateRef } from '../../src/cartesian/meta';
import { createTimeReadout } from '../../src/format/time';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { position } from '../../src/scene/geometry';
import { record } from '../finance/host';
import { marksOf, n5run, plotOf, xPixel, yScaleOf } from './n5-pipeline';

function chart(input: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  const parsed = parseCartesianInput(input);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const composition = {
    kind: 'line',
    resolve: createCartesianResolver(stateRef, { list: parsed.issues }),
    normalize: ((k, r, e, s, v) => normalizeCartesian(stateRef, k, r, e, s, v)) as Composition['normalize'],
    view: ((f, st, s) => buildCartesianView(stateRef, f as never, st as never, s)) as Composition['view'],
    layout: createCartesianLayoutStage(stateRef),
    timeReadout: createTimeReadout,
    scene: (v, l, d) => buildCartesianScene(stateRef, v, l, d),
    lookup: (v, l, f, m) => createCartesianLookup(stateRef, v, l, f, m),
    reader: createCartesianReader(stateRef),
    interaction: { overlay: createCartesianOverlay(stateRef), swatch: createMarkSwatch(stateRef), stepInSeries: null, sliceList: null },
    svg: { area: svgArea, band: svgBand, path: svgPath, points: svgPoints, rects: svgRects, rule: svgRule },
  } as Composition;
  const controller = controllerFor(composition, parsed.translated, rec.host);
  rec.frames();
  return { rec, controller, handle: controller.handle };
}

type Row = Record<string, unknown>;
const spec = (data: Row[], missing?: 'zero') => ({
  data, x: 'x',
  // The domain keeps 0 inside the plot, so a zero point is not on the plot's edge.
  axes: { v: { position: 'left', domain: [-1, 5] } },
  layers: [{ type: 'scatter', y: missing ? { field: 'y', missing } : 'y', yAxis: 'v' }],
});

/** The drawn points as [x slot, value] pairs, read back through the scales and sorted. */
function drawn(run: ReturnType<typeof n5run>): [number, number][] {
  const [points] = marksOf(run, 'points', 0);
  const scale = yScaleOf(run.layout, 0), x1 = xPixel(run.layout, run.view, 0), x2 = xPixel(run.layout, run.view, 1);
  const top = position(scale, 5), bottom = position(scale, -1);
  const out: [number, number][] = [];
  for (let i = 0; points && i < points.xy.length; i += 2) {
    const px = points.xy[i]!, py = points.xy[i + 1]!;
    const slot = Math.abs(px - x1) < 1e-3 ? 0 : Math.abs(px - x2) < 1e-3 ? 1 : -1;
    out.push([slot, Math.round((-1 + 6 * (bottom - py) / (bottom - top)) * 1000) / 1000 + 0]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const codes = (run: ReturnType<typeof n5run>) => run.diagnostics.map(d => d.code);

describe('W3 repair 4: missing: \'zero\' on repeated scatter rows, in either row order', () => {
  const nullSecond: Row[] = [{ x: 1, y: 2 }, { x: 1, y: null }, { x: 2, y: 4 }];
  const nullFirst: Row[] = [{ x: 1, y: null }, { x: 1, y: 2 }, { x: 2, y: 4 }];
  const absentFirst: Row[] = [{ x: 1 }, { x: 1, y: 2 }, { x: 2, y: 4 }];
  const absentSecond: Row[] = [{ x: 1, y: 2 }, { x: 1 }, { x: 2, y: 4 }];

  it('draws the filled zero as a point whichever row comes first, with no AX108', () => {
    for (const data of [nullSecond, nullFirst, absentFirst, absentSecond]) {
      const run = n5run(spec(data, 'zero'));
      expect(codes(run), JSON.stringify(data)).not.toContain('AX108');
      expect(drawn(run), JSON.stringify(data)).toEqual([[0, 0], [0, 2], [1, 4]]);
    }
  });

  it('reports an absent field as changed (AX102), once, and a null silently', () => {
    for (const data of [absentFirst, absentSecond]) {
      const ax102 = n5run(spec(data, 'zero')).diagnostics.filter(d => d.code === 'AX102');
      expect(ax102).toHaveLength(1);
      expect(ax102[0]!.effect).toBe('changed');
      expect(ax102[0]!.count).toBe(1);
    }
    for (const data of [nullSecond, nullFirst]) expect(codes(n5run(spec(data, 'zero')))).toEqual([]);
  });

  it('picks, reads and anchors each point by its own source row, the filled one included', () => {
    for (const [data, zeroRow, twoRow] of [[nullSecond, 1, 0], [nullFirst, 0, 1], [absentFirst, 0, 1]] as const) {
      const run = n5run(spec(data, 'zero'));
      const scale = yScaleOf(run.layout, 0), x1 = xPixel(run.layout, run.view, 0);
      const zero = run.lookup.pick(x1, position(scale, 0)), two = run.lookup.pick(x1, position(scale, 2));
      const zeroRef: DatumRef = { kind: 'point', seriesKey: 'y', row: zeroRow, x: 1 };
      const twoRef: DatumRef = { kind: 'point', seriesKey: 'y', row: twoRow, x: 1 };
      expect(zero).toEqual({ kind: 'point', refs: [zeroRef], count: 1 });
      expect(two).toEqual({ kind: 'point', refs: [twoRef], count: 1 });
      expect(run.lookup.datum(zeroRef)).toMatchObject({ value: '0', row: zeroRow, x: '1' });
      expect(run.lookup.datum(twoRef)).toMatchObject({ value: '2', row: twoRow, x: '1' });
      // No point is named by the "no source row" index the aligned frame uses for a filled slot.
      expect(run.lookup.datum({ kind: 'point', seriesKey: 'y', row: -1, x: 1 })).toBeNull();
      const anchor = run.lookup.anchor(zeroRef)!;
      expect(anchor.y + anchor.height / 2).toBeCloseTo(position(scale, 0), 4);
      expect(run.lookup.datum({ kind: 'aligned', seriesKey: 'y', x: 1 })!.value).toBe(zeroRow === 0 ? '0, 2' : '2, 0');
      expect(run.reader.table!.row(0)).toEqual(['1', zeroRow === 0 ? '0, 2' : '2, 0']);
    }
  });

  it('raises hover and select with the filled zero, its caller row and its index, in both orders', () => {
    for (const [data, zeroRow] of [[nullSecond, 1], [nullFirst, 0]] as const) {
      const { rec, controller, handle } = chart(spec(data, 'zero'));
      const hovers: unknown[] = [], selects: unknown[] = [];
      handle.on('hover', p => { hovers.push(p); });
      handle.on('select', p => { selects.push(p); });
      const d = rec.committed!, proj = plotOf(d.layout).projection;
      if (proj.kind !== 'xy') throw new Error('xy');
      const view = d.view as AlignedView, scale = proj.yAxes?.[0] ?? proj.y;
      for (const [slot, v] of [[0, 0], [0, 2], [1, 4]] as const) {
        const target = d.lookup.pick(proj.x.map(view.frame.x.values[slot]!), position(scale, v));
        expect(target, `pick ${v}`).not.toBeNull();
        const ref = d.lookup.primary(target!)!;
        controller.actions.hover(ref);
        controller.actions.select(ref);
      }
      const twoRow = 1 - zeroRow;
      const expected = [
        { series: 'y', x: 1, y: 0, row: data[zeroRow], index: zeroRow },
        { series: 'y', x: 1, y: 2, row: data[twoRow], index: twoRow },
        { series: 'y', x: 2, y: 4, row: data[2], index: 2 },
      ];
      expect(hovers).toEqual(expected);
      expect(selects).toEqual(expected);
      expect(handle.diagnostics.map(x => x.code)).not.toContain('AX108');
      handle.destroy();
    }
  });

  it('still omits a value that cannot be read (AX106), in either order, and fills nothing for it', () => {
    for (const data of [[{ x: 1, y: 2 }, { x: 1, y: 'abc' }, { x: 2, y: 4 }], [{ x: 1, y: 'abc' }, { x: 1, y: 2 }, { x: 2, y: 4 }]]) {
      const run = n5run(spec(data, 'zero'));
      expect(drawn(run)).toEqual([[0, 2], [1, 4]]);
      expect(codes(run)).toContain('AX106');
      expect(codes(run)).not.toContain('AX108');
      const scale = yScaleOf(run.layout, 0), x1 = xPixel(run.layout, run.view, 0);
      const validRow = data[0]!.y === 2 ? 0 : 1;
      // The readable row is the one point at x = 1 (a slot's own row or a repeat), read as its own row.
      const target = run.lookup.pick(x1, position(scale, 2));
      expect(target).not.toBeNull();
      expect(run.lookup.datum(run.lookup.primary(target!)!)).toMatchObject({ value: '2', row: validRow });
      // Nothing is drawn or picked at zero.
      const atZero = run.lookup.pick(x1, position(scale, 0));
      expect(atZero === null || atZero.kind === 'x').toBe(true);
    }
  });

  it('keeps a null without missing: \'zero\' a silent gap in either order', () => {
    for (const [data, twoRow] of [[nullSecond, 0], [nullFirst, 1]] as const) {
      const run = n5run(spec(data));
      expect(codes(run)).toEqual([]);
      expect(drawn(run)).toEqual([[0, 2], [1, 4]]);
      const scale = yScaleOf(run.layout, 0), x1 = xPixel(run.layout, run.view, 0);
      const target = run.lookup.pick(x1, position(scale, 2))!;
      expect(run.lookup.datum(run.lookup.primary(target)!)).toMatchObject({ value: '2', row: twoRow });
      expect(run.lookup.datum({ kind: 'point', seriesKey: 'y', row: 1 - twoRow, x: 1 })).toBeNull();
    }
  });
});
