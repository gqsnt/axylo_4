import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  ContinuousScale, DiagnosticInput, LabelRemedy, Layout, PlacedText, Rect, TextStyle, TickCandidates,
} from '../../src/core/contracts';
import { computeLayout } from '../../src/layout';
import type { BandAxis, LayoutInput, ScaleConstructors } from '../../src/layout';

type Span = readonly [number, number];
type Plot = Extract<Layout, { kind: 'plot' }>;

const style: TextStyle = { font: '16px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 16 };
const measurer = {
  width(text: string, style: TextStyle): number {
    return [...text].length * (7 + style.letterSpacing) + (text.match(/ /gu)?.length ?? 0) * style.wordSpacing;
  },
};

function continuous(type: ContinuousScale['type'], domain: Span, range: Span): ContinuousScale {
  const [min, max] = domain;
  const [start, end] = range;
  return {
    type, domain, range,
    map: value => start + (end - start) * (value - min) / (max - min),
    invert: pixel => min + (max - min) * (pixel - start) / (end - start),
  };
}

const scales: ScaleConstructors = {
  linear: (domain, range) => continuous('linear', domain, range),
  time: (domain, range) => continuous('time', domain, range),
  band(count, range, padding) {
    const [start, end] = range;
    const direction = Math.sign(end - start);
    const step = Math.abs(end - start) / (count + padding);
    const bandwidth = step * (1 - padding);
    const center = (index: number) => start + direction * ((index + padding) * step + bandwidth / 2);
    return {
      type: 'band', count, range, step, bandwidth, center,
      map: index => center(index) - bandwidth / 2,
      invert: pixel => Math.max(0, Math.min(count - 1, Math.round(((pixel - start) * direction - bandwidth / 2) / step - padding))),
    };
  },
};

const valueCandidates: TickCandidates = [
  Array.from({ length: 11 }, (_, i) => ({ value: i * 10, label: String(i * 10) })),
  [0, 25, 50, 75, 100].map(value => ({ value, label: String(value) })),
  [0, 50, 100].map(value => ({ value, label: String(value) })),
  [{ value: 50, label: '50' }],
];

function axis(labels: readonly string[], mayThin: boolean, title?: string): BandAxis {
  const dense = labels.map((label, value) => ({ label, value }));
  return {
    type: 'band', count: labels.length, padding: 0, mayThin, title,
    candidates: [dense, dense.filter(tick => tick.value % 3 === 0), dense.slice(0, 1)],
  };
}

function input(labels: readonly string[], width = 720, height = 320, mayThin = false, diagnostics: DiagnosticInput[] = []) {
  return {
    kind: 'xy', width, height, scales, style, measurer,
    diagnostics: { add: (diagnostic: DiagnosticInput) => diagnostics.push(diagnostic) },
    x: axis(labels, mayThin, 'Team'),
    y: { domain: [0, 100] as const, candidates: valueCandidates, mayThin: true, title: 'Value (USD)' },
  } satisfies LayoutInput;
}

function plot(result: Layout): Plot {
  expect(result.kind).toBe('plot');
  if (result.kind !== 'plot') throw new Error('Expected a plot');
  return result;
}

function tickLabels(result: Plot, role: PlacedText['role'] = 'tick-x'): readonly PlacedText[] {
  return result.texts.filter(text => text.role === role);
}

function intersection(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
}

function boxesFit(result: Plot): void {
  for (const [i, { box }] of result.texts.entries()) {
    expect(box.x).toBeGreaterThanOrEqual(-1e-6);
    expect(box.y).toBeGreaterThanOrEqual(-1e-6);
    expect(box.x + box.width).toBeLessThanOrEqual(result.width + 1e-6);
    expect(box.y + box.height).toBeLessThanOrEqual(result.height + 1e-6);
    for (const other of result.texts.slice(0, i)) expect(intersection(box, other.box)).toBe(false);
  }
}

function distinct(texts: readonly PlacedText[]): void {
  expect(new Set(texts.map(text => text.lines.join(' '))).size).toBe(texts.length);
}

function identifiable(texts: readonly PlacedText[], originals: readonly string[]): void {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const text of texts) {
    const shown = text.lines.join(' ');
    if (shown === text.full) continue;
    expect(text.lines).toHaveLength(1);
    const parts = Array.from(shown.matchAll(/…/gu), match => match.index);
    const splits = parts.map(i => [shown.slice(0, i), shown.slice(i + 1)] as const)
      .filter(([prefix, suffix]) => text.full.startsWith(prefix) && text.full.endsWith(suffix));
    expect(splits.some(([prefix, suffix]) => [...segmenter.segment(prefix)].length >= 2 &&
      [...segmenter.segment(suffix)].length >= 2)).toBe(true);
    const matches = [...new Set(originals)].filter(label => label === shown ||
      splits.some(([prefix, suffix]) => label.startsWith(prefix) && label.endsWith(suffix)));
    expect(matches).toEqual([text.full]);
  }
}

describe('plot layout', () => {
  const teams = ['North', 'South', 'East', 'Customer Success & Onboarding', 'West', 'Coast', 'Field', 'Ops'];

  it('measures each string once and jumps straight to a spread of very dense categories', () => {
    const settings = (count: number, width: number) => input(
      Array.from({ length: count }, (_, i) => `Customer Success International Services ${i}`), width, 400,
    );
    const calls = new Map<string, number>();
    const medium = plot(computeLayout({
      ...settings(1000, 720),
      measurer: { width(text, style) {
        calls.set(text, (calls.get(text) ?? 0) + 1);
        return measurer.width(text, style);
      } },
    }));
    expect(Math.max(...calls.values())).toBe(1);
    expect(calls.size).toBeLessThan(500);
    expect(medium.fit.x.hidden).toBe(1000 - medium.xTicks.length);
    console.info(`Measured ${calls.size} strings for 1,000 categories`);

    const large = settings(100_000, 1200);
    const before = performance.now();
    const result = plot(computeLayout(large));
    const ms = performance.now() - before;
    console.info(`Laid out 100,000 categories in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(650);
    expect(result.xTicks.length).toBeGreaterThan(2);
    expect(result.xTicks[0]!.value).toBeLessThan(20_000);
    expect(result.xTicks.at(-1)!.value).toBeGreaterThan(80_000);
    expect(result.fit.x.hidden).toBe(100_000 - result.xTicks.length);
    boxesFit(result);
  });

  it('hides categories when fewer than two characters would fit on either side', () => {
    const labels = Array.from({ length: 200 }, (_, i) => `Category number ${i + 1}`);
    const result = plot(computeLayout(input(labels, 240)));
    expect(result.fit.x.hidden).toBe(labels.length - result.xTicks.length);
    identifiable(tickLabels(result), labels);
  });

  it('shows the distinguishing part of a label or counts the label as hidden', () => {
    const labels = ['Region North Total', 'Region South Total'];
    const result = plot(computeLayout({ ...input(labels, 260), kind: 'bands', horizontal: true }));
    expect(result.fit.x.hidden).toBe(labels.length - result.xTicks.length);
    identifiable(tickLabels(result), labels);
  });

  it('finds a distinct truncation when both ends need more room than the minimum', () => {
    const labels = ['abcdefghijklmnoPQR', 'abcdefghijklmZPQR', 'abcdefgZijklmnoPQR'];
    const result = plot(computeLayout({ ...input(labels, 245), kind: 'bands', horizontal: true }));
    expect(tickLabels(result).find(text => text.full === labels[0])?.lines).toEqual(['abcdefgh…oPQR']);
    identifiable(tickLabels(result), labels);
  });

  it('reserves room for a 120 px plot before sizing horizontal category labels', () => {
    const labels = ['Customer Success & Onboarding', 'Engineering Platform Services', 'Sales', 'Marketing Operations'];
    const result = plot(computeLayout({ ...input(labels, 240, 300), kind: 'bands', horizontal: true }));
    expect(result.plot.width).toBeGreaterThanOrEqual(120);
    expect(result.xTicks).toHaveLength(labels.length);
    boxesFit(result);
  });

  it.each([NaN, Infinity, -Infinity])('treats %s dimensions as unmeasured for every layout kind', invalid => {
    const settings = input(teams);
    const kinds: LayoutInput[] = [settings, { ...settings, compact: true },
      { kind: 'ring', width: 720, height: 320, diagnostics: settings.diagnostics }, { ...settings, kind: 'bands', horizontal: true },
      { kind: 'message', width: 720, height: 320, style, measurer, message: 'Loading' }];
    for (const variant of kinds) {
      expect(computeLayout({ ...variant, width: invalid }).kind).toBe('unmeasured');
      expect(computeLayout({ ...variant, height: invalid }).kind).toBe('unmeasured');
    }
  });

  it('keeps a rotated label at the last continuous tick', () => {
    const ticks = Array.from({ length: 13 }, (_, value) => ({ value, label: `Week ${value} total` }));
    const result = plot(computeLayout({ ...input([], 600), x: {
      type: 'linear', domain: [0, 12], candidates: [ticks], mayThin: true,
    } }));
    expect(result.fit.x.remedies).toContain('rotated');
    expect(result.xTicks.at(-1)?.value).toBe(12);
    boxesFit(result);
  });

  it('counts blank and later duplicate labels as hidden without changing their neighbours', () => {
    const labels = ['Same', 'Same', '', 'Other', ' '];
    const result = plot(computeLayout(input(labels, 400, 200)));
    expect(result.fit.x).toEqual({ remedies: [], hidden: 3 });
    expect(result.xTicks.map(tick => tick.value)).toEqual([0, 3]);
    expect(tickLabels(result).map(text => text.lines)).toEqual([['Same'], ['Other']]);

    const settings = input(['Team A', 'Team B']);
    const yTicks = [{ label: 'Zero', value: 0 }, { label: 'Zero', value: 40 },
      { label: '', value: 50 }, { label: 'Hundred', value: 100 }];
    const value = plot(computeLayout({ ...settings, y: { ...settings.y, candidates: [yTicks] } }));
    expect(value.fit.y).toEqual({ remedies: [], hidden: 2 });
    expect(value.yTicks.map(tick => tick.value)).toEqual([0, 100]);
  });

  it('returns layout diagnostics as data and leaves a reused legacy sink alone', () => {
    const diagnostics: DiagnosticInput[] = [];
    const small = input(teams, 100, 60, false, diagnostics);
    const labels = Array.from({ length: 24 }, (_, i) => `Row ${i + 1}`);
    const crowded = { ...input(labels, 410, 290, false, diagnostics), kind: 'bands', horizontal: true } as const;
    for (let i = 0; i < 2; i++) {
      expect(computeLayout(small).kind).toBe('too-small');
      expect(plot(computeLayout(crowded)).fit.x.hidden).toBe(12);
    }
    expect(diagnostics).toEqual([]);
  });

  it('wraps a long label at 720 px and preserves distinct labels at 340 px', () => {
    const large = plot(computeLayout(input(teams)));
    const wrapped = tickLabels(large).find(text => text.full === teams[3]);
    expect(wrapped?.lines).toEqual(['Customer Success', '& Onboarding']);
    expect(large.fit.x).toEqual({ remedies: ['wrapped'], hidden: 0 });
    expect(large.xTicks).toHaveLength(teams.length);
    boxesFit(large);

    const small = plot(computeLayout(input(teams, 340)));
    expect(small.xTicks).toHaveLength(teams.length);
    expect(small.fit.x).toEqual({ remedies: ['wrapped', 'rotated', 'truncated'], hidden: 0 });
    distinct(tickLabels(small));
    boxesFit(small);
  });

  it('keeps the distinctive ends of two middle-truncated labels', () => {
    const similar = ['Customer Success – EMEA', 'Customer Success – APAC'];
    const categories = ['North', ...similar, 'South', 'Ops', 'Field', 'Web', 'West'];
    const result = plot(computeLayout(input(categories, 340)));
    const texts = tickLabels(result).filter(text => similar.includes(text.full));
    expect(texts).toHaveLength(2);
    expect(texts[0]?.lines[0]).toContain('…');
    expect(texts[1]?.lines[0]).toContain('…');
    distinct(texts);
    boxesFit(result);

    const horizontal = plot(computeLayout({ ...input(similar, 320), kind: 'bands', horizontal: true }));
    const onLeft = tickLabels(horizontal);
    expect(onLeft).toHaveLength(2);
    expect(horizontal.fit.x).toEqual({ remedies: ['truncated'], hidden: 0 });
    expect(onLeft[0]?.lines[0]).toMatch(/….*EMEA$/u);
    expect(onLeft[1]?.lines[0]).toMatch(/….*APAC$/u);
    for (const text of onLeft) expect(text.box.width).toBeLessThanOrEqual(320 * 0.4);
    boxesFit(horizontal);
  });

  it('thins ordered categories before changing their text and tries all applicable remedies for plain categories', () => {
    const plain = plot(computeLayout(input(teams, 340)));
    expect(plain.fit.x.remedies).toEqual(['wrapped', 'rotated', 'truncated']);
    const ordered = plot(computeLayout(input(teams, 420, 320, true)));
    expect(ordered.fit.x).toEqual({ remedies: ['thinned'], hidden: 0 });
    expect(ordered.xTicks.map(tick => tick.value)).toEqual([0, 3, 6]);
    expect(tickLabels(ordered).map(text => text.lines)).toEqual([[teams[0]], [teams[3]], [teams[6]]]);
    boxesFit(ordered);
  });

  it('chooses the densest value tick set that fits the final ranges and keeps title lanes clear', () => {
    const result = plot(computeLayout(input(teams, 720, 180)));
    expect(result.yTicks.map(tick => tick.value)).toEqual([0, 25, 50, 75, 100]);
    expect(result.fit.y.remedies).toEqual(['thinned']);
    const ticks = [...tickLabels(result, 'tick-y')].sort((a, b) => a.y - b.y);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.box.y - (ticks[i - 1]!.box.y + ticks[i - 1]!.box.height)).toBeGreaterThanOrEqual(style.lineHeight / 2);
    }
    expect(result.texts.filter(text => text.role.startsWith('title')).map(text => text.full)).toEqual(['Value (USD)', 'Team']);
    const { projection, plot: rect } = result;
    expect(projection.kind).toBe('xy');
    if (projection.kind === 'xy') {
      expect(projection.x.range).toEqual([rect.x, rect.x + rect.width]);
      expect(projection.y.range).toEqual([rect.y + rect.height, rect.y]);
      expect(ticks.map(tick => tick.y)).toEqual([...result.yTicks].reverse().map(tick => projection.y.map(tick.value)));
    }
    boxesFit(result);
  });

  it('anchors the rotated text at category centers and uses the rotated bounds', () => {
    const result = plot(computeLayout(input(teams, 340)));
    if (result.projection.kind !== 'xy' || result.projection.x.type !== 'band') throw new Error('Expected a band scale');
    const band = result.projection.x;
    for (const [index, text] of tickLabels(result).entries()) {
      expect(text.rotate).toBe(-45);
      expect(text.anchor).toBe('end');
      expect(text.x).toBe(band.center(result.xTicks[index]!.value));
      const width = Math.max(...text.lines.map(line => measurer.width(line, style)));
      const height = text.lines.length * style.lineHeight;
      expect(text.box.x).toBeCloseTo(text.x - width * Math.SQRT1_2);
      expect(text.box.y).toBeCloseTo(text.y);
      expect(text.box.width).toBeCloseTo((width + height) * Math.SQRT1_2);
      expect(text.box.height).toBeCloseTo((width + height) * Math.SQRT1_2);
    }
  });

  it('uses the injected time scale for continuous x and the same ranges for vertical bars', () => {
    const common = input(['A', 'B', 'C']);
    const time = plot(computeLayout({
      ...common,
      x: { type: 'time', domain: [1000, 2000], candidates: [[{ value: 1500, label: 'Middle' }]], mayThin: true },
    }));
    expect(time.projection.kind).toBe('xy');
    if (time.projection.kind === 'xy') {
      expect(time.projection.x.type).toBe('time');
      expect(time.projection.x.map(1500)).toBe(time.plot.x + time.plot.width / 2);
    }
    const bars = plot(computeLayout({ ...common, kind: 'bands', horizontal: false }));
    expect(bars.projection.kind).toBe('bands');
    if (bars.projection.kind === 'bands') {
      expect(bars.projection.horizontal).toBe(false);
      expect(bars.projection.band.range).toEqual([bars.plot.x, bars.plot.x + bars.plot.width]);
      expect(bars.projection.value.range).toEqual([bars.plot.y + bars.plot.height, bars.plot.y]);
    }
    boxesFit(time);
    boxesFit(bars);
  });

  it('hides evenly spaced horizontal bar labels when there is no room for every row', () => {
    const labels = Array.from({ length: 24 }, (_, i) => `Row ${i + 1}`);
    const result = plot(computeLayout({ ...input(labels, 410, 290), kind: 'bands', horizontal: true }));
    expect(result.xTicks.map(tick => tick.value)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);
    expect(result.fit.x.hidden).toBe(12);
    if (result.projection.kind !== 'bands') throw new Error('Expected a bar projection');
    expect(result.projection.horizontal).toBe(true);
    expect(result.projection.band.range).toEqual([result.plot.y + result.plot.height, result.plot.y]);
    expect(result.projection.value.range).toEqual([result.plot.x, result.plot.x + result.plot.width]);
    boxesFit(result);
  });

  it('returns too-small, compact, and unmeasured layouts', () => {
    const small = input(teams, 100, 60);
    expect(computeLayout(small)).toEqual({ kind: 'too-small', width: 100, height: 60 });
    expect(computeLayout({ ...small, width: 24, height: 16, compact: true })).toEqual({
      kind: 'compact', width: 24, height: 16,
      plot: { x: 2, y: 2, width: 20, height: 12 },
      projection: expect.objectContaining({ kind: 'xy' }),
    });
    expect(computeLayout({ ...small, width: 0, height: 0 })).toEqual({ kind: 'unmeasured', width: 0, height: 0 });
    expect(computeLayout({ ...small, width: 0 })).toEqual({ kind: 'unmeasured', width: 0, height: 60 });
  });

  it('centers a ring of the largest radius and omits axes', () => {
    const result = plot(computeLayout({ kind: 'ring', width: 360, height: 200 }));
    expect(result.projection).toEqual({ kind: 'ring', cx: 180, cy: 100, r0: 60, r1: 100 });
    expect(result.xTicks).toEqual([]);
    expect(result.yTicks).toEqual([]);
    expect(result.texts).toEqual([]);
  });

  it('centers and wraps a message within an inset', () => {
    const message = 'Loading QuarterlyTotals';
    const result = computeLayout({ kind: 'message', width: 84, height: 80, style, measurer, message });
    expect(result.kind).toBe('message');
    if (result.kind !== 'message') throw new Error('Expected a message');
    expect(result.text).toMatchObject({
      role: 'message', full: message, lines: ['Loading', 'QuarterlyT', 'otals'],
      x: 42, y: 40, anchor: 'middle', baseline: 'middle',
      box: { x: 7, y: 16, width: 70, height: 48 },
    });
  });

  it('ends an overflowing message with an ellipsis and draws no lines in a tiny tile', () => {
    const message = 'This is a long error message that does not fit on two lines';
    const settings = { kind: 'message', width: 60, height: 40, style, measurer, message } as const;
    const result = computeLayout(settings);
    if (result.kind !== 'message') throw new Error('Expected a message');
    expect(result.text.lines).toEqual(['This is', 'a long…']);
    expect(result.text.box).toEqual({ x: 5.5, y: 4, width: 49, height: 32 });
    const tiny = computeLayout({ ...settings, width: 10, height: 10 });
    if (tiny.kind !== 'message') throw new Error('Expected a message');
    expect(tiny.text.lines).toEqual([]);
  });

  it('checks every layout kind, minimum plots and label attribution across generated sizes', () => {
    const unbroken = fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 60 }).filter(text => !/\s/u.test(text));
    const shared = fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 20 })
      .map(suffix => `Customer Success International Services ${suffix}`);
    const words = fc.array(fc.constantFrom('Team', 'Success', 'Onboarding', 'EMEA', 'Accounts', 'Web'), { minLength: 1, maxLength: 5 })
      .map(words => words.join(' '));
    const labels = fc.array(fc.oneof(unbroken, shared, words, fc.constant('')), { minLength: 1, maxLength: 40, size: 'large' });
    const cases = fc.record({
      labels,
      width: fc.oneof(fc.integer({ min: 100, max: 1920 }), fc.constantFrom(100, 120, 148, NaN, Infinity)),
      height: fc.oneof(fc.integer({ min: 60, max: 600 }), fc.constantFrom(60, 80, 108, 124, NaN, Infinity)),
      letterSpacing: fc.constantFrom(0, 1.5), wordSpacing: fc.constantFrom(0, 2),
      lineHeight: fc.constantFrom(16, 22, 28),
      mode: fc.constantFrom('plain', 'ordered', 'linear', 'time', 'vertical', 'horizontal', 'compact', 'ring', 'message'),
    });
    const expectedOrder: LabelRemedy[] = ['thinned', 'wrapped', 'rotated', 'truncated'];

    fc.assert(fc.property(cases, ({ labels, width, height, letterSpacing, wordSpacing, lineHeight, mode }) => {
      const mayThin = mode === 'ordered' || mode === 'linear' || mode === 'time';
      const common = {
        ...input(labels, width, height, mayThin),
        style: { ...style, letterSpacing, wordSpacing, lineHeight },
      };
      // Short titles make the space needed for a plot with hidden ticks independently calculable.
      const cartesian = {
        ...common, x: { ...common.x, title: 'X' }, y: { ...common.y, title: 'Y' },
      };
      let settings: LayoutInput = cartesian;
      if (mode === 'horizontal' || mode === 'vertical') settings = { ...cartesian, kind: 'bands', horizontal: mode === 'horizontal' };
      if (mode === 'linear' || mode === 'time') settings = { ...cartesian, x: {
          type: mode, domain: [0, Math.max(1, labels.length - 1)], candidates: common.x.candidates, mayThin, title: 'X',
      } };
      if (mode === 'compact') settings = { ...cartesian, compact: true };
      if (mode === 'ring') settings = { kind: 'ring', width, height };
      if (mode === 'message') settings = { ...common, kind: 'message', message: labels.join(' ') };
      const result = computeLayout(settings);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        expect(result.kind).toBe('unmeasured');
        return;
      }
      if (mode === 'compact' || mode === 'message') {
        expect(result.kind).toBe(mode);
        if (result.kind === 'message') {
          const { box } = result.text;
          expect(box.x).toBeGreaterThanOrEqual(4);
          expect(box.y).toBeGreaterThanOrEqual(4);
          expect(box.x + box.width).toBeLessThanOrEqual(width - 4);
          expect(box.y + box.height).toBeLessThanOrEqual(height - 4);
        }
        return;
      }
      expect(['plot', 'too-small']).toContain(result.kind);
      const titleLane = 4 + lineHeight;
      if (mode === 'ring' ? width >= 120 && height >= 80
        : width >= 120 + 8 + titleLane && height >= 80 + 8 + titleLane) {
        expect(result.kind).toBe('plot');
      }
      if (result.kind !== 'plot') return;

      expect(result.plot.width).toBeGreaterThanOrEqual(120 - 1e-6);
      expect(result.plot.height).toBeGreaterThanOrEqual(80 - 1e-6);
      const texts = tickLabels(result);
      distinct(texts);
      boxesFit(result);
      if (mode === 'ring') {
        expect(result.texts).toEqual([]);
        expect(result.projection).toEqual({ kind: 'ring', cx: width / 2, cy: height / 2,
          r0: Math.min(width, height) / 2 * 0.6, r1: Math.min(width, height) / 2 });
        return;
      }
      identifiable(texts, labels);
      expect(result.xTicks).toHaveLength(texts.length);
      const remedies = result.fit.x.remedies;
      if (!mayThin) expect(remedies).not.toContain('thinned');
      if (!remedies.includes('thinned')) expect(result.fit.x.hidden).toBe(labels.length - texts.length);
      expect(remedies).toEqual(expectedOrder.filter(remedy => remedies.includes(remedy)));
    }), { numRuns: 500 });
  });
});
