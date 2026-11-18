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

describe('plot layout', () => {
  const teams = ['North', 'South', 'East', 'Customer Success & Onboarding', 'West', 'Coast', 'Field', 'Ops'];

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
    const diagnostics: DiagnosticInput[] = [];
    const labels = Array.from({ length: 24 }, (_, i) => `Row ${i + 1}`);
    const result = plot(computeLayout({ ...input(labels, 410, 290, false, diagnostics), kind: 'bands', horizontal: true }));
    expect(result.xTicks.map(tick => tick.value)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);
    expect(result.fit.x.hidden).toBe(12);
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'AX143', count: 12, origin: 'presentation' })]);
    if (result.projection.kind !== 'bands') throw new Error('Expected a bar projection');
    expect(result.projection.horizontal).toBe(true);
    expect(result.projection.band.range).toEqual([result.plot.y + result.plot.height, result.plot.y]);
    expect(result.projection.value.range).toEqual([result.plot.x, result.plot.x + result.plot.width]);
    boxesFit(result);
  });

  it('returns too-small, compact, and unmeasured layouts and emits the too-small diagnostic', () => {
    const diagnostics: DiagnosticInput[] = [];
    const small = input(teams, 100, 60, false, diagnostics);
    expect(computeLayout(small)).toEqual({ kind: 'too-small', width: 100, height: 60 });
    expect(computeLayout({ ...small, width: 24, height: 16, compact: true })).toEqual({
      kind: 'compact', width: 24, height: 16,
      plot: { x: 2, y: 2, width: 20, height: 12 },
      projection: expect.objectContaining({ kind: 'xy' }),
    });
    expect(computeLayout({ ...small, width: 0, height: 0 })).toEqual({ kind: 'unmeasured', width: 0, height: 0 });
    expect(computeLayout({ ...small, width: 0 })).toEqual({ kind: 'unmeasured', width: 0, height: 60 });
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'AX142', origin: 'presentation' })]);
  });

  it('centers a ring of the largest radius and omits axes', () => {
    const result = plot(computeLayout({ kind: 'ring', width: 360, height: 200, diagnostics: { add() {} } }));
    expect(result.projection).toEqual({ kind: 'ring', cx: 180, cy: 100, r0: 60, r1: 100 });
    expect(result.xTicks).toEqual([]);
    expect(result.yTicks).toEqual([]);
    expect(result.texts).toEqual([]);
  });

  it('centers and wraps a message without clipping a long word horizontally', () => {
    const message = 'Loading QuarterlyTotals';
    const result = computeLayout({ kind: 'message', width: 84, height: 80, style, measurer, message });
    expect(result.kind).toBe('message');
    if (result.kind !== 'message') throw new Error('Expected a message');
    expect(result.text).toMatchObject({
      role: 'message', full: message, lines: ['Loading', 'QuarterlyTot', 'als'],
      x: 42, y: 40, anchor: 'middle', baseline: 'middle',
      box: { x: 0, y: 16, width: 84, height: 48 },
    });
  });

  it('fits generated labels and titles without clipping, overlaps, or repeated text', () => {
    const unbroken = fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 60 }).filter(text => !/\s/u.test(text));
    const shared = fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 20 })
      .map(suffix => `Customer Success International Services ${suffix}`);
    const words = fc.array(fc.constantFrom('Team', 'Success', 'Onboarding', 'EMEA', 'Accounts', 'Web'), { minLength: 1, maxLength: 5 })
      .map(words => words.join(' '));
    const labels = fc.array(fc.oneof(unbroken, shared, words), { minLength: 1, maxLength: 40, size: 'large' });
    const cases = fc.record({
      labels, width: fc.integer({ min: 240, max: 1920 }), height: fc.integer({ min: 160, max: 600 }),
      letterSpacing: fc.constantFrom(0, 1.5), wordSpacing: fc.constantFrom(0, 2),
      lineHeight: fc.constantFrom(16, 22, 28),
    });
    const expectedOrder: LabelRemedy[] = ['thinned', 'wrapped', 'rotated', 'truncated'];

    fc.assert(fc.property(cases, ({ labels, width, height, letterSpacing, wordSpacing, lineHeight }) => {
      const diagnostics: DiagnosticInput[] = [];
      const settings = {
        ...input(labels, width, height, false, diagnostics),
        style: { ...style, letterSpacing, wordSpacing, lineHeight },
      };
      const result = computeLayout(settings);
      expect(['plot', 'too-small']).toContain(result.kind);
      if (result.kind !== 'plot') return;

      const texts = tickLabels(result);
      distinct(texts);
      boxesFit(result);
      expect(result.fit.x.hidden).toBe(labels.length - texts.length);
      expect(result.xTicks).toHaveLength(texts.length);
      const remedies = result.fit.x.remedies;
      expect(remedies).not.toContain('thinned');
      expect(remedies).toEqual(expectedOrder.filter(remedy => remedies.includes(remedy)));
      expect(diagnostics.find(diagnostic => diagnostic.code === 'AX143')?.count ?? 0)
        .toBe(result.fit.x.hidden + result.fit.y.hidden);
    }), { numRuns: 150 });
  });
});
