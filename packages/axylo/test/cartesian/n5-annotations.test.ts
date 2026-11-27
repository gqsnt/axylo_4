/**
 * N5: malformed annotations are never dropped silently (spec F3). Each is left out and reported with an existing
 * code (AX150 naming the option, AX103 for a value that is not finite, as references report it); its valid
 * siblings are drawn. Both are warnings, so a strict call that brings one is rejected (core/delivery.ts), and the
 * options signature changes with them, so valid → malformed → corrected updates each build a new view.
 */
import { describe, expect, it, vi } from 'vitest';
import { cartesian, validateCartesian } from '../../src/cartesian';
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
import type { Composition } from '../../src/core/composition';
import { controllerFor, staticControllerFor } from '../../src/core/controller';
import { strictViolations } from '../../src/core/delivery';
import { createTimeReadout } from '../../src/format/time';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { record } from '../finance/host';
import { n5run } from './n5-pipeline';

vi.mock('../../src/core/chart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/chart')>();
  return {
    ...actual,
    createStaticChart: (composition: Composition, target: unknown, input: unknown) =>
      staticControllerFor(composition, input, target as never).handle,
  };
});

const base = {
  data: [{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 9 }], x: 'x',
  axes: { v: { position: 'left' } },
  layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
};
const valid = { type: 'point', x: 2, y: 4, label: 'Peak' };
const malformed = [
  valid,
  { type: 'point', x: 2, y: '4', label: 'String y' },
  { type: 'threshold', axis: 'y', value: Number.NaN, label: 'NaN line' },
  { type: 'wedge', label: 'Unknown type' },
  42,
  { type: 'range', axis: 'x', from: 1, label: 'No end' },
  { type: 'threshold', axis: 'z', value: 3, label: 'Bad axis' },
  { type: 'point', y: 3, label: 'No x' },
];

describe('N5 annotation diagnostics', () => {
  it('reports each malformed annotation by its option path and keeps the valid one', () => {
    const diagnostics = validateCartesian({ ...base, annotations: malformed } as never);
    const found = diagnostics.filter(d => d.code === 'AX150' || d.code === 'AX103').map(d => [d.code, d.field, d.level]);
    expect(found).toEqual(expect.arrayContaining([
      ['AX150', 'annotations[1].y', 'warning'],
      ['AX103', 'annotations[2].value', 'warning'],
      ['AX150', 'annotations[3].type', 'warning'],
      ['AX150', 'annotations[4]', 'warning'],
      ['AX150', 'annotations[5].to', 'warning'],
      ['AX150', 'annotations[6].axis', 'warning'],
      ['AX150', 'annotations[7].x', 'warning'],
    ]));
    expect(found).toHaveLength(7);
    const parsed = parseCartesianInput({ ...base, annotations: malformed });
    expect(parsed.meta.annotations.map(a => a.label)).toEqual(['Peak']);
    // Malformed annotations do not make the chart an error: the options stay valid.
    expect(parsed.meta.invalid).toBe(false);
  });

  it('draws the valid sibling in lenient mode and fails a strict call', () => {
    const run = n5run({ ...base, annotations: malformed });
    expect(run.stateRef.meta.annotations.map(a => a.label)).toEqual(['Peak']);
    expect(run.reader.summary).toContain('Peak');
    expect(strictViolations(run.diagnostics).map(d => d.field)).toContain('annotations[1].y');
    expect(strictViolations(n5run({ ...base, annotations: [valid] }).diagnostics)).toEqual([]);
  });

  it('changes the options signature on valid → malformed → corrected → removed', () => {
    const sig = (annotations: unknown) => {
      const y = parseCartesianInput({ ...base, ...(annotations === undefined ? {} : { annotations }) }).translated.y as Record<string, unknown>;
      return y.__annSig;
    };
    const a = sig([valid]), b = sig(malformed), c = sig([valid]), d = sig(undefined);
    expect(a).not.toBe(b);
    expect(c).toBe(a);
    expect(d).toBeUndefined();
    // Only malformed annotations still change the signature (their findings must be made again).
    expect(sig([{ type: 'wedge' }])).not.toBeUndefined();
  });

  it('reports a non-array annotations option', () => {
    const diagnostics = validateCartesian({ ...base, annotations: { type: 'point' } } as never);
    expect(diagnostics.filter(d => d.code === 'AX150').map(d => d.field)).toEqual(['annotations']);
  });

  it('rejects non-XValue and non-finite/invalid-Date x coordinates before JSON signature without invoking serialization hooks', () => {
    let hookCalls = 0;
    const hooked = {
      toJSON() { hookCalls++; throw new Error('toJSON should not run'); },
      valueOf() { hookCalls++; throw new Error('valueOf should not run'); },
      toString() { hookCalls++; throw new Error('toString should not run'); },
    };
    const cyclic: Record<string, unknown> = { label: 'loop' };
    cyclic.self = cyclic;
    const fakeDate = Object.create(Date.prototype);

    const badX = [
      valid,
      { type: 'point', x: 1n, y: 4, label: 'BigInt x' },
      { type: 'threshold', axis: 'x', value: Symbol('sym'), label: 'Symbol x' },
      { type: 'range', axis: 'x', from: cyclic, to: hooked, label: 'Object x' },
      { type: 'point', x: fakeDate, y: 4, label: 'Fake Date' },
      { type: 'point', x: Number.NaN, y: 4, label: 'NaN x' },
      { type: 'threshold', axis: 'x', value: Number.POSITIVE_INFINITY, label: 'Inf x' },
      { type: 'point', x: new Date('invalid'), y: 4, label: 'Invalid Date' },
      // Valid XValue (string) that is invalid on a numeric x-scale still emits AX107.
      { type: 'point', x: 'not-a-number', y: 4, label: 'Scale mismatch' },
    ];

    const diagnostics = validateCartesian({ ...base, annotations: badX } as never);
    expect(hookCalls).toBe(0);
    const byField = diagnostics
      .filter(d => d.code === 'AX150' || d.code === 'AX103' || d.code === 'AX107')
      .map(d => [d.code, d.field, d.level]);
    expect(byField).toEqual(expect.arrayContaining([
      ['AX150', 'annotations[1].x', 'warning'],
      ['AX150', 'annotations[2].value', 'warning'],
      ['AX150', 'annotations[3].from', 'warning'],
      ['AX150', 'annotations[3].to', 'warning'],
      ['AX150', 'annotations[4].x', 'warning'],
      ['AX103', 'annotations[5].x', 'warning'],
      ['AX103', 'annotations[6].value', 'warning'],
      ['AX103', 'annotations[7].x', 'warning'],
      ['AX107', 'annotations[8].x', 'warning'],
    ]));
    expect(byField).toHaveLength(9);

    // Valid numeric, string (calendar date), and Date x coordinates remain accepted without warnings.
    const timeSpec = {
      title: 'Valid XValue types',
      data: [
        { x: new Date('2026-01-01T00:00:00Z'), y: 1 },
        { x: new Date('2026-01-02T00:00:00Z'), y: 4 },
      ],
      x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
      annotations: [
        { type: 'point', x: new Date('2026-01-02T00:00:00Z'), y: 4, label: 'Date point' },
        { type: 'threshold', axis: 'x', value: '2026-01-01T12:00:00Z', label: 'ISO threshold' },
      ],
    };
    expect(validateCartesian(timeSpec as never).filter(d => d.level !== 'hint')).toEqual([]);
  });

  it('rolls back a strict chart update with malformed x annotation and accepts a follow-up update', () => {
    const initial = { ...base, title: 'Strict chart', strict: true, annotations: [valid] };
    const rec = record({ width: 640, height: 360 });
    const parsed = parseCartesianInput(initial);
    const stateRef: CartesianStateRef = { meta: parsed.meta };
    const pending = { list: parsed.issues };
    const composition: Composition = {
      kind: 'line',
      resolve: createCartesianResolver(stateRef, pending),
      normalize: ((kind, resolved, env, sink, version) => normalizeCartesian(stateRef, kind, resolved, env, sink, version)) as Composition['normalize'],
      view: ((frame, state, sink) => buildCartesianView(stateRef, frame as never, state as never, sink)) as Composition['view'],
      layout: createCartesianLayoutStage(stateRef),
      timeReadout: createTimeReadout,
      scene: (view, lay, dpr) => buildCartesianScene(stateRef, view, lay, dpr),
      lookup: (view, lay, formatters, messages) => createCartesianLookup(stateRef, view, lay, formatters, messages),
      reader: createCartesianReader(stateRef),
      interaction: { overlay: createCartesianOverlay(stateRef), swatch: createMarkSwatch(stateRef), stepInSeries: null, sliceList: null },
      svg: { area: svgArea, band: svgBand, path: svgPath, points: svgPoints, rects: svgRects, rule: svgRule },
    } as Composition;
    const handle = controllerFor(composition, parsed.translated, rec.host).handle as { update(p: unknown): void; destroy(): void };
    let currentRaw: Record<string, unknown> = { ...initial };
    const update = (patch: Record<string, unknown>) => {
      // Mirrors packages/axylo/src/cartesian.ts update() rollback semantics verbatim.
      const prevRaw = currentRaw;
      const prevMeta = stateRef.meta;
      const prevIssues = pending.list;
      currentRaw = { ...currentRaw, ...patch };
      const next = parseCartesianInput(currentRaw, prevMeta);
      stateRef.meta = next.meta;
      pending.list = next.issues;
      try {
        handle.update(next.translated);
      } catch (err) {
        currentRaw = prevRaw;
        stateRef.meta = prevMeta;
        pending.list = prevIssues;
        throw err;
      }
      rec.frames();
    };

    rec.frames();
    expect(rec.committed!.reader.summary).toContain('Peak');

    // Rejected strict update with BigInt x annotation must throw strict rejection (not raw TypeError) and roll back.
    expect(() => update({
      annotations: [{ type: 'point', x: 1n, y: 4, label: 'Bad BigInt' }],
    })).toThrow(/AX150|strict/i);
    expect(stateRef.meta.annotations.map(a => a.label)).toEqual(['Peak']);
    expect(rec.committed!.reader.summary).toContain('Peak');

    // Follow-up accepted update without re-supplying annotations proves currentRaw was rolled back cleanly.
    update({ data: [{ x: 1, y: 2 }, { x: 2, y: 8 }, { x: 3, y: 12 }] });
    expect(stateRef.meta.annotations.map(a => a.label)).toEqual(['Peak']);
    expect(rec.committed!.reader.summary).toContain('Peak');
    expect(rec.committed!.reader.table!.row(1)).toEqual(['2', '8']);
    handle.destroy();
  });

  it('canonicalizes Date coordinates without invoking custom serializers and distinguishes Date from ISO strings in public wrapper updates', () => {
    const iso = '2026-01-01T00:00:00.000Z';
    const iso2 = '2026-01-02T00:00:00.000Z';

    // 1. Structural signature distinguishes Date from identical ISO string across point, threshold, and range.
    const sigOf = (annotations: unknown) =>
      (parseCartesianInput({ ...base, annotations }).translated.y as Record<string, unknown>).__annSig;
    expect(sigOf([{ type: 'point', x: iso, y: 4, label: 'P' }]))
      .not.toBe(sigOf([{ type: 'point', x: new Date(iso), y: 4, label: 'P' }]));
    expect(sigOf([{ type: 'threshold', axis: 'x', value: iso, label: 'T' }]))
      .not.toBe(sigOf([{ type: 'threshold', axis: 'x', value: new Date(iso), label: 'T' }]));
    expect(sigOf([{ type: 'range', axis: 'x', from: iso, to: iso2, label: 'R' }]))
      .not.toBe(sigOf([{ type: 'range', axis: 'x', from: new Date(iso), to: new Date(iso2), label: 'R' }]));

    // 2. Real public cartesian() wrapper: Date with throwing custom serializer hooks never throws and is canonicalized.
    let hookCalls = 0;
    const hostileDate = new Date(iso);
    Object.defineProperties(hostileDate, {
      toJSON: { value() { hookCalls++; throw new Error('custom toJSON must not run'); } },
      valueOf: { value() { hookCalls++; throw new Error('custom valueOf must not run'); } },
      toString: { value() { hookCalls++; throw new Error('custom toString must not run'); } },
      getTime: { value() { hookCalls++; throw new Error('custom getTime must not run'); } },
    });
    const parsedTime = parseCartesianInput({
      ...base,
      annotations: [{ type: 'point', x: hostileDate, y: 4, label: 'Fresh' }],
    });
    const storedX = (parsedTime.meta.annotations[0] as { x: unknown }).x;
    expect(storedX).toBeInstanceOf(Date);
    expect(storedX !== hostileDate).toBe(true);
    expect(Date.prototype.getTime.call(storedX)).toBe(Date.parse(iso));
    expect(hookCalls).toBe(0);

    const timeRec = record({ width: 640, height: 360 });
    const timeChart = cartesian(timeRec.host as never, {
      title: 'Time chart',
      strict: true,
      data: [
        { x: new Date(iso), y: 1 },
        { x: new Date(iso2), y: 4 },
      ],
      x: 'x',
      axes: { v: { position: 'left' } },
      layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
    });
    timeRec.frames();
    expect(() => timeChart.update({
      annotations: [{ type: 'point', x: hostileDate, y: 1, label: 'Hostile' }],
    })).not.toThrow();
    timeRec.frames();
    expect(hookCalls).toBe(0);
    expect(timeRec.committed!.reader.summary).toContain('Hostile');
    // Subsequent title update must also succeed without invoking any hook on the caller's Date.
    expect(() => timeChart.update({ title: 'Time chart updated' })).not.toThrow();
    timeRec.frames();
    expect(hookCalls).toBe(0);
    expect(timeRec.committed!.reader.summary).toContain('Hostile');
    timeChart.destroy();

    // 3. Real public cartesian() wrapper on a categorical axis: replacing an ISO string with the same-instant Date
    // must revalidate and fail strictly with AX107, rolling back so a follow-up update preserves the accepted state.
    const catRec = record({ width: 640, height: 360 });
    const catChart = cartesian(catRec.host as never, {
      title: 'Category chart',
      strict: true,
      data: [
        { x: iso, y: 1 },
        { x: iso2, y: 4 },
      ],
      x: { field: 'x', type: 'category' },
      axes: { v: { position: 'left' } },
      layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
      annotations: [{ type: 'point', x: iso, y: 1, label: 'CatISO' }],
    });
    catRec.frames();
    expect(catRec.committed!.reader.summary).toContain('CatISO');

    expect(() => catChart.update({
      annotations: [{ type: 'point', x: new Date(iso), y: 1, label: 'CatDate' }],
    })).toThrow(/AX107/);
    catRec.frames();
    expect(catRec.committed!.reader.summary).toContain('CatISO');
    expect(catRec.committed!.reader.summary).not.toContain('CatDate');

    // Follow-up accepted update must succeed and keep the previously accepted annotation intact.
    expect(() => catChart.update({ title: 'Category chart updated' })).not.toThrow();
    catRec.frames();
    expect(catRec.committed!.reader.summary).toContain('CatISO');
    expect(catRec.committed!.reader.summary).not.toContain('CatDate');
    catChart.destroy();
  });
});
