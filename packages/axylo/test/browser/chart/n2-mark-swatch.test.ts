/**
 * Node unit test (it runs under `npm test`; it lives beside the N2 browser suite because Cycle N2 owns only
 * test/browser): the Cartesian swatch of each series repeats the mark of the layer that declared its field
 * (spec A5), in the colour the scene paints that mark with (cartesian/scene.ts: a range or error bar is painted in
 * its centre field's colour, else its low field's), and a hidden series is an outline of the same shape (spec I2).
 * The expected shapes are read from the options (layer types, `capWidth`, centre `y`), not from the module.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, SeriesCue } from '../../../src/core/contracts';
import { parseCartesianInput } from '../../../src/cartesian/options';
import { createMarkSwatch } from '../../../src/dom/mark-swatch';
import { createSwatch, type SwatchSpec } from '../../../src/dom/swatch';
import { collectControlInputs } from '../../../src/dom/interaction-controls';
import type { ControlsState } from '../../../src/dom/interaction-types';
import { sameKey } from '../../../src/core/composition';
import { defaultMessages } from '../../../src/messages';

/** Just enough of an SVG document for createSwatch: elements with attributes, children and a style. */
class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly style = { props: new Map<string, string>(), color: '', setProperty(k: string, v: string) { this.props.set(k, v); } };
  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string) {}
  setAttribute(k: string, v: string): void { this.attributes.set(k, v); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  appendChild(c: FakeElement): FakeElement { this.children.push(c); return c; }
}
class FakeDocument {
  createElementNS(_ns: string, tag: string): FakeElement { return new FakeElement(this, tag); }
}

const cue = (marker: SeriesCue['marker'], dash: readonly number[] | null = null): SeriesCue => ({ marker, dash: { normal: dash, contrast: dash ?? [2, 2] } });

function chart(capWidth?: number) {
  const parsed = parseCartesianInput({
    data: [], x: 'day',
    axes: { left: { position: 'left' }, right: { position: 'right' } },
    layers: [
      { type: 'bar', y: 'units', yAxis: 'left' },
      { type: 'area', y: 'share', yAxis: 'left' },
      { type: 'line', y: 'temp', yAxis: 'right' },
      { type: 'range', low: 'lo', high: 'hi', yAxis: 'right' },
      { type: 'errorBar', y: 'm', low: 'el', high: 'eh', yAxis: 'right', ...(capWidth === undefined ? {} : { capWidth }) },
    ],
  });
  expect(parsed.issues).toEqual([]);
  // The frame's series follow the carrier fields; give them in a different order from the layers to show that the
  // swatch reads each series' own field, not its position among the layers.
  const fields = ['temp', 'units', 'share', 'el', 'eh', 'm', 'lo', 'hi'];
  const cues = fields.map((_, i) => cue((['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'star', 'triangle-down'] as const)[i]!, i === 2 ? [6, 3] : null));
  const view = { kind: 'line', frame: { series: fields.map(field => ({ field })) }, cues } as unknown as AlignedView;
  const swatch = createMarkSwatch({ meta: parsed.meta });
  const spec = (field: string, hollow = false): SwatchSpec => { const i = fields.indexOf(field); return swatch(i, cues[i]!, hollow, view); };
  return { fields, spec };
}

function drawn(spec: SwatchSpec): { color: string; parts: { tag: string; [k: string]: string }[] } {
  const svg = createSwatch(new FakeDocument() as unknown as Document, spec) as unknown as FakeElement;
  return {
    color: svg.style.color,
    parts: svg.children.map(c => ({ tag: c.tagName, ...Object.fromEntries(c.attributes), ...Object.fromEntries(c.style.props) })),
  };
}

describe('Cartesian mark swatches', () => {
  it('line: the shared line swatch, with its dash and marker', () => {
    const { spec } = chart();
    const s = spec('temp');
    expect(s).toMatchObject({ color: 0, line: true, hollow: false });
    expect(s.shape).toBeUndefined();
    expect(drawn(s).parts.map(p => p.tag)).toEqual(['line', 'path']);
  });

  it('bar: a plain filled square in its own colour (Cartesian bars draw no pattern)', () => {
    const { spec } = chart();
    const s = spec('units');
    expect(s).toMatchObject({ color: 1, line: false, fill: true, pattern: null });
    expect(s.shape).toBeUndefined();
    const d = drawn(s);
    expect(d.color).toBe('var(--axylo-series-color-2)');
    expect(d.parts).toEqual([{ tag: 'path', class: 'axylo-swatch-chip', d: 'M5 1H15V11H5Z', fill: 'currentColor' }]);
  });

  it('area: a translucent region under a full-colour edge that carries the series dash', () => {
    const { spec } = chart();
    const d = drawn(spec('share'));
    expect(d.color).toBe('var(--axylo-series-color-3)');
    expect(d.parts[0]).toMatchObject({ tag: 'path', fill: 'currentColor', 'fill-opacity': '0.22' });
    expect(d.parts[1]).toMatchObject({ tag: 'path', class: 'axylo-swatch-line', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', '--axylo-swatch-dash': '3 1.5' });
    // Hidden: one outline of the region, no edge.
    const hidden = drawn(spec('share', true));
    expect(hidden.parts).toHaveLength(1);
    expect(hidden.parts[0]).toMatchObject({ stroke: 'currentColor', d: d.parts[0]!.d });
    expect(hidden.parts[0]!.fill).not.toBe('currentColor');
  });

  it('range: both fields show the translucent band in the low field\'s colour', () => {
    const { spec, fields } = chart();
    const low = drawn(spec('lo')), high = drawn(spec('hi'));
    expect(low.color).toBe(`var(--axylo-series-color-${fields.indexOf('lo') + 1})`);
    expect(high.color).toBe(low.color);
    expect(low.parts).toHaveLength(1);
    expect(low.parts[0]).toMatchObject({ fill: 'currentColor', 'fill-opacity': '0.22' });
    expect(high.parts).toEqual(low.parts);
    expect(spec('lo').shape!.key).not.toBe(spec('share').shape!.key);
  });

  it('errorBar: every field shows the capped whisker and the centre marker in the centre\'s colour', () => {
    const { spec, fields } = chart();
    const centre = fields.indexOf('m');
    for (const f of ['el', 'eh', 'm']) {
      const d = drawn(spec(f));
      expect(d.color, f).toBe(`var(--axylo-series-color-${centre + 1})`);
      expect(d.parts.map(p => p.class), f).toEqual(['axylo-swatch-whisker', 'axylo-swatch-marker']);
      expect(d.parts[0]!.d, f).toBe('M10 1V11M6 1H14M6 11H14');
      expect(d.parts[0]).toMatchObject({ fill: 'none', stroke: 'currentColor' });
    }
    // The marker is the centre series' marker (plus), not each field's own.
    expect(drawn(spec('el')).parts[1]!.d).toBe(drawn(spec('m')).parts[1]!.d);
    // Hidden: an outlined whisker (a wide stroke with the background inside it) and a hollow marker.
    const hidden = drawn(spec('el', true));
    expect(hidden.parts.map(p => p['stroke-width'])).toEqual(['3.5', '1.5', '1.5']);
    expect(hidden.parts[1]!.stroke).not.toBe('currentColor');
    expect(hidden.parts[2]!.fill).not.toBe('currentColor');
  });

  it('errorBar with capWidth 0 and no centre: an uncapped whisker without a marker', () => {
    const parsed = parseCartesianInput({
      data: [], x: 'day', axes: { left: { position: 'left' } },
      layers: [{ type: 'errorBar', low: 'el', high: 'eh', yAxis: 'left', capWidth: 0 }],
    });
    const view = { kind: 'line', frame: { series: [{ field: 'el' }, { field: 'eh' }] }, cues: [cue('circle'), cue('square')] } as unknown as AlignedView;
    const s = createMarkSwatch({ meta: parsed.meta })(1, cue('square'), false, view);
    const d = drawn(s);
    expect(d.color).toBe('var(--axylo-series-color-1)');
    expect(d.parts.map(p => p.d)).toEqual(['M10 1V11']);
  });

  it('errorBar with its centre series hidden: the whisker keeps the centre colour and loses the marker, and comes back', () => {
    const parsed = parseCartesianInput({
      data: [], x: 'day', axes: { left: { position: 'left' } },
      layers: [{ type: 'errorBar', y: 'm', low: 'el', high: 'eh', yAxis: 'left' }],
    });
    const fields = ['el', 'eh', 'm'];
    const cues = fields.map(() => cue('square'));
    const view = (visible: boolean[]) => ({ kind: 'line', frame: { series: fields.map(field => ({ field })) }, cues, visible }) as unknown as AlignedView;
    const swatch = createMarkSwatch({ meta: parsed.meta });
    const shown = view([true, true, true]);
    const centreHidden = view([true, true, false]);
    const low = drawn(swatch(0, cues[0]!, false, centreHidden));
    expect(low.color).toBe('var(--axylo-series-color-3)');
    expect(low.parts.map(p => p.class)).toEqual(['axylo-swatch-whisker']);
    // The hidden centre's own entry is the outlined whisker, still without a marker.
    expect(drawn(swatch(2, cues[2]!, true, centreHidden)).parts.map(p => p.class)).toEqual(['axylo-swatch-whisker', 'axylo-swatch-whisker']);
    // The drawing key changes, so cached controls redraw on hide and on show.
    expect(swatch.key!(0, centreHidden)).not.toBe(swatch.key!(0, shown));
    expect(drawn(swatch(0, cues[0]!, false, shown)).parts.map(p => p.class)).toEqual(['axylo-swatch-whisker', 'axylo-swatch-marker']);
  });

  it('a field whose layer changes mark gets a swatch with a different drawing key', () => {
    const { spec } = chart();
    const keys = ['temp', 'units', 'share', 'lo', 'el'].map(f => spec(f).shape?.key ?? `${spec(f).line}:${spec(f).fill}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The interaction layer skips redrawing the controls when their inputs are unchanged (#renderControls): the
  // swatch's key must be one of those inputs, or an update that changes only a layer's mark keeps the old swatch.
  it('the cached control inputs change when a layer changes mark, interval colour, caps or centre', () => {
    const layers = (units: 'bar' | 'area', eb: Record<string, unknown>) => parseCartesianInput({
      data: [], x: 'day', axes: { left: { position: 'left' } },
      layers: [{ type: units, y: 'units', yAxis: 'left' }, { type: 'errorBar', low: 'el', high: 'eh', yAxis: 'left', ...eb }],
    }).meta;
    const fields = ['units', 'el', 'eh', 'm'];
    const cues = fields.map(() => cue('circle'));
    const view = {
      kind: 'line', frame: { series: fields.map(field => ({ field, key: field, label: field })) }, cues,
      visible: fields.map(() => true),
    } as unknown as AlignedView;
    const state = {
      view, messages: defaultMessages, english: () => undefined, pageLang: null, legend: 'bottom', streaming: false, paused: false,
      reader: { table: null }, ready: true, tooSmall: false, zoom: false, zoomed: false,
    } as unknown as ControlsState;
    const stateRef = { meta: layers('bar', { y: 'm' }) };
    const swatch = createMarkSwatch(stateRef);
    const inputs = () => { const out: unknown[] = []; collectControlInputs(state, out, false, false, false, swatch); return out; };
    const bar = inputs();
    expect(sameKey(bar, inputs())).toBe(true);
    const changes: [string, Record<string, unknown>, 'bar' | 'area'][] = [
      ['bar to area', { y: 'm' }, 'area'],
      ['caps removed', { y: 'm', capWidth: 0 }, 'bar'],
      ['centre removed (the interval takes its low field\'s colour, no marker)', {}, 'bar'],
    ];
    for (const [name, eb, units] of changes) {
      stateRef.meta = layers(units, eb);
      expect(sameKey(bar, inputs()), name).toBe(false);
      // Rollback restores the layers, and with them the inputs the cached controls were drawn from.
      stateRef.meta = layers('bar', { y: 'm' });
      expect(sameKey(bar, inputs()), `${name}, rolled back`).toBe(true);
    }
  });
});
