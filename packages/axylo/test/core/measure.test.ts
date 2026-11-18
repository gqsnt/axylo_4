/**
 * Text measurement (plan 2.2, spec A6, L1): fonts that finish loading, a cache bound for the whole document,
 * and letter and word spacing applied to the measuring context. Finding 14 of the core review.
 */
import { describe, expect, it } from 'vitest';
import { createMeasurer, measurementCacheSize, MEASUREMENT_CACHE_LIMIT, noteFontLoad } from '../../src/core/environment';
import type { TextStyle } from '../../src/core/contracts';

/** A document whose canvas context measures 7 px per character before a font loads and 17 px after. */
function fakeDocument(options: { spacing: boolean }) {
  const state = { loaded: false, set: [] as string[] };
  const context: Record<string, unknown> = {
    font: '10px sans-serif',
    measureText(text: string) {
      const letter = options.spacing ? parseFloat(String(context.letterSpacing)) : 0;
      const word = options.spacing ? parseFloat(String(context.wordSpacing)) : 0;
      const spaces = text.split(' ').length - 1;
      return { width: text.length * (state.loaded ? 17 : 7) + letter * text.length + word * spaces };
    },
  };
  if (options.spacing) {
    let letterSpacing = '0px';
    let wordSpacing = '0px';
    Object.defineProperty(context, 'letterSpacing', { get: () => letterSpacing, set: (v: string) => { state.set.push(`letter ${v}`); letterSpacing = v; } });
    Object.defineProperty(context, 'wordSpacing', { get: () => wordSpacing, set: (v: string) => { state.set.push(`word ${v}`); wordSpacing = v; } });
  }
  const doc = { createElement: () => ({ getContext: () => context }) } as unknown as Document;
  return { doc, state };
}

const style = (font = '400 12px Inter', letterSpacing = 0, wordSpacing = 0): TextStyle => ({ font, letterSpacing, wordSpacing, lineHeight: 15 });

describe('text measurement (finding 14)', () => {
  it('a font that finishes loading invalidates the widths measured with the fallback, for every measurer of the document', () => {
    const { doc, state } = fakeDocument({ spacing: false });
    const measurer = createMeasurer(doc);
    expect(measurer.width('label', style())).toBe(35);
    state.loaded = true;
    // Until the load is noted, the cached width stands (the cache is what makes layout cheap).
    expect(measurer.width('label', style())).toBe(35);
    noteFontLoad(doc);
    expect(measurer.width('label', style())).toBe(85);
    expect(createMeasurer(doc).width('label', style())).toBe(85);
  });

  it('the cache is bounded for the whole document, across any number of styles', () => {
    const { doc } = fakeDocument({ spacing: false });
    const measurer = createMeasurer(doc);
    for (let s = 0; s < 40; s++) for (let i = 0; i < 400; i++) measurer.width(`t${i}`, style(`400 ${10 + s}px Inter`));
    expect(measurementCacheSize(doc)).toBeLessThanOrEqual(MEASUREMENT_CACHE_LIMIT);
  });

  it('letter and word spacing are set on a context that supports them, and added by hand otherwise', () => {
    const spaced = fakeDocument({ spacing: true });
    expect(createMeasurer(spaced.doc).width('a b', style('400 12px Inter', 2, 4))).toBe(3 * 7 + 2 * 3 + 4);
    expect(spaced.state.set).toEqual(['letter 2px', 'word 4px']);
    const plain = fakeDocument({ spacing: false });
    // CSS adds letter spacing after every character and word spacing after every space.
    expect(createMeasurer(plain.doc).width('a b', style('400 12px Inter', 2, 4))).toBe(3 * 7 + 2 * 3 + 4);
  });
});
