/**
 * The Cartesian entry's swatch (cartesian/mark-swatch.ts) replaces dom/mark-swatch.ts so that a bare
 * `import 'axylo/cartesian'` bundles to nothing (tests/dist/subpaths.test.ts). Until the DOM owner retires the
 * DOM copy, the two must describe the same swatch for every layer kind: same colour, line/fill flags, pattern,
 * shape key and cache key. (Drawing the shapes needs a DOM; n2-mark-swatch.test.ts covers that in Chrome.)
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, SeriesCue } from '../../src/core/contracts';
import { parseCartesianInput } from '../../src/cartesian/options';
import { createMarkSwatch as cartesianSwatch } from '../../src/cartesian/mark-swatch';
import { createMarkSwatch as domSwatch } from '../../src/dom/mark-swatch';

const cue: SeriesCue = { marker: 'square', dash: { normal: [6, 3], contrast: [2, 2] } };

function viewOf(fields: readonly string[], visible: readonly boolean[]): AlignedView {
  return {
    kind: 'line', visible, cues: fields.map(() => cue),
    frame: { series: fields.map(field => ({ field, key: field, label: field })) },
  } as unknown as AlignedView;
}

describe('N4 Cartesian swatch parity with dom/mark-swatch.ts', () => {
  const input = {
    data: [{ x: 1, l: 1, b: 2, a: 3, lo: 1, hi: 4, mid: 2, elo: 1, ehi: 3 }], x: 'x',
    axes: { v: { position: 'left' } },
    layers: [
      { type: 'line', y: 'l', yAxis: 'v' },
      { type: 'bar', y: 'b', yAxis: 'v' },
      { type: 'area', y: 'a', yAxis: 'v' },
      { type: 'range', low: 'lo', high: 'hi', yAxis: 'v' },
      { type: 'errorBar', y: 'mid', low: 'elo', high: 'ehi', yAxis: 'v', capWidth: 0 },
    ],
  };
  // N5: the swatch is asked about published series only, one per layer (cartesian/boxplot.ts): a range is its
  // `low` field and an error bar its centre. The other carriers (hi, elo, ehi) have no legend entry, and the
  // error bar's centre is hidden only with the whole error bar.
  const fields = ['l', 'b', 'a', 'lo', 'mid'];

  for (const hidden of [-1, 4]) {
    it(`describes every layer's swatch identically${hidden >= 0 ? ' with the error bar hidden' : ''}`, () => {
      const parsed = parseCartesianInput(input);
      const stateRef = { meta: parsed.meta };
      const ours = cartesianSwatch(stateRef);
      const theirs = domSwatch(stateRef);
      const view = viewOf(fields, fields.map((_, i) => i !== hidden));
      for (let i = 0; i < fields.length; i++) {
        for (const hollow of [false, true]) {
          const a = ours(i, cue, hollow, view);
          const b = theirs(i, cue, hollow, view);
          const plain = (s: typeof a) => ({ ...s, shape: s.shape?.key });
          expect(plain(a)).toEqual(plain(b));
        }
        expect(ours.key!(i, view)).toBe(theirs.key!(i, view));
      }
    });
  }
});
