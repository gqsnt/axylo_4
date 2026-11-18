import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  ContinuousScale, DiagnosticInput, LabelRemedy, Layout, PlacedText, Rect, ResolvedReference, TextStyle, TickCandidates,
} from '../../src/core/contracts';
import { createNumberTickLabeler, type NumberTickSpec } from '../../src/format';
import { computeLayout } from '../../src/layout';
import type { BandAxis, ContinuousAxis, LayoutInput, ScaleConstructors, ValueAxis } from '../../src/layout';
import { linearTickCandidates, timeTickCandidates, valueDomain, type TimeTickOptions } from '../../src/scale';
import { record } from '../core/host';

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

function temporalAxis(domain: Span, options: TimeTickOptions): ContinuousAxis {
  return { type: 'time', domain, candidates: timeTickCandidates(domain, options), mayThin: true };
}

function numericAxis(domain: Span, format: NumberTickSpec, title?: string): ContinuousAxis {
  const label = createNumberTickLabeler(format);
  return { type: 'linear', domain, candidates: linearTickCandidates(domain, label), mayThin: true, title };
}

function exampleValueAxis(values: readonly number[], title: string, format: Omit<NumberTickSpec, 'locale'> = {}): ValueAxis {
  const { domain } = valueDomain({ min: Math.min(...values), max: Math.max(...values), includeZero: false, valueScale: format.scale });
  return numericAxis(domain, { locale: 'en-US', ...format }, title);
}

function plot(result: Layout): Plot {
  expect(result.kind).toBe('plot');
  if (result.kind !== 'plot') throw new Error('Expected a plot');
  return result;
}

function tickLabels(result: Plot, role: PlacedText['role'] = 'tick-x'): readonly PlacedText[] {
  return result.texts.filter(text => text.role === role);
}

function hiddenCategories(result: Plot, count: number): number {
  const shown = tickLabels(result);
  const truncated = shown.filter(text => text.lines.join(' ') !== text.full).length;
  return count - shown.length + truncated;
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
    expect(medium.fit.x.hidden).toBe(hiddenCategories(medium, 1000));
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
    expect(result.fit.x.hidden).toBe(hiddenCategories(result, 100_000));
    boxesFit(result);
  });

  it('hides categories when fewer than two characters would fit on either side', () => {
    const labels = Array.from({ length: 200 }, (_, i) => `Category number ${i + 1}`);
    const result = plot(computeLayout(input(labels, 240)));
    expect(result.xTicks.length).toBeLessThan(labels.length);
    expect(result.fit.x.hidden).toBe(hiddenCategories(result, labels.length));
    identifiable(tickLabels(result), labels);
  });

  it('shows the distinguishing part of a label or counts the label as hidden', () => {
    const labels = ['Region North Total', 'Region South Total'];
    const result = plot(computeLayout({ ...input(labels, 260), kind: 'bands', horizontal: true }));
    expect(result.fit.x.hidden).toBe(hiddenCategories(result, labels.length));
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

  it.each([
    { name: 'dates.ts instants in Los Angeles', timeZone: 'America/Los_Angeles', last: Date.UTC(2026, 1, 28),
      values: [120, 135, 128, 150, 162] },
    { name: 'AX111 minimal input in UTC', timeZone: 'UTC', last: Date.UTC(2026, 1, 26), values: [120, 130, 125] },
  ])('discloses no hidden ticks for $name', ({ timeZone, last, values }) => {
    const result = plot(computeLayout({
      ...input([], 752, 752 * 9 / 16),
      x: temporalAxis([Date.UTC(2026, 1, 24), last], { kind: 'time', timeZone, locale: 'en-US' }),
      y: exampleValueAxis(values, 'sessions'),
    }));
    expect(tickLabels(result).length).toBeGreaterThan(0);
    expect([result.fit.x.hidden, result.fit.y.hidden]).toEqual([0, 0]);
    boxesFit(result);
  });

  it('shows the date once for line-time.ts at phone width without disclosing hidden labels', () => {
    const start = Date.UTC(2026, 2, 10);
    const at = (i: number) => start + i * 600_000;
    const values = Array.from({ length: 144 }, (_, i) => [320, 180].map((base, series) =>
      Math.round(base + 60 * Math.sin(i / 12 + series) + (i >= 84 && i < 96 ? 400 : 0)))).flat();
    const result = plot(computeLayout({
      ...input([], 364, 364 * 9 / 16),
      x: temporalAxis([at(0), at(143)], { kind: 'time', timeZone: 'UTC', locale: 'en-US' }),
      y: exampleValueAxis(values, 'Response time (ms)'),
      references: [
        { axis: 'y', from: 500, to: 500, label: 'Objective' },
        { axis: 'x', from: at(84), to: at(96), label: 'Incident' },
      ],
    }));
    const labels = tickLabels(result);
    expect(labels.length).toBeGreaterThan(1);
    expect(labels[0]?.full).toContain('Mar 10');
    expect(labels.slice(1).every(text => !text.full.includes('Mar 10'))).toBe(true);
    expect([result.fit.x.hidden, result.fit.y.hidden]).toEqual([0, 0]);
    boxesFit(result);
  });

  it.each([
    { name: 'ratio', y: exampleValueAxis([0.031, 0.034, 0.029, 0.038], 'Conversion', { scale: 'ratio' }) },
    { name: 'latency', y: exampleValueAxis([412, 388, 455, 1210], 'Latency (p95) (ms)', { tickFormat: { notation: 'compact' } }) },
  ])('shows all four months at 364 px for units.ts $name without disclosing hidden labels', ({ y }) => {
    const result = plot(computeLayout({
      ...input([], 364, 364 * 9 / 16),
      x: temporalAxis([Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1)], { kind: 'date', dateUnit: 'month', locale: 'en-US' }),
      y,
    }));
    expect(tickLabels(result).map(text => text.lines)).toEqual([['Jan 2026'], ['Feb'], ['Mar'], ['Apr']]);
    expect([result.fit.x.hidden, result.fit.y.hidden]).toEqual([0, 0]);
    boxesFit(result);
  });

  it.each([false, true])('counts blank and duplicate category labels only (horizontal %s)', horizontal => {
    const labels = ['Same', 'Same', '', 'Other', ' '];
    const result = plot(computeLayout({ ...input(labels, 400, 200), kind: 'bands', horizontal }));
    expect(result.fit.x).toEqual({ remedies: [], hidden: 3 });
    expect(result.xTicks.map(tick => tick.value)).toEqual([0, 3]);
    expect(tickLabels(result).map(text => text.lines)).toEqual([['Same'], ['Other']]);

    const settings = input(['Team A', 'Team B']);
    const yTicks = [{ label: 'Zero', value: 0 }, { label: 'Zero', value: 40 },
      { label: '', value: 50 }, { label: 'Hundred', value: 100 }];
    const value = plot(computeLayout({ ...settings, kind: 'bands', horizontal, y: { ...settings.y, candidates: [yTicks] } }));
    expect(value.fit.y).toEqual({ remedies: [], hidden: 0 });
    expect(value.yTicks.map(tick => tick.value)).toEqual([0, 100]);
  });

  it('counts only omitted categories when the minimum-sized plot needs the no-tick fallback', () => {
    const x = axis(['A', 'B'], false);
    const y = numericAxis([0, 100], { locale: 'en-US' });
    const settings = { ...input([], 128, 88), x, y };
    const categories = plot(computeLayout(settings));
    expect(categories.texts).toEqual([]);
    expect([categories.fit.x.hidden, categories.fit.y.hidden]).toEqual([2, 0]);
    const continuous = plot(computeLayout({ ...settings, x: y }));
    expect(continuous.texts).toEqual([]);
    expect([continuous.fit.x.hidden, continuous.fit.y.hidden]).toEqual([0, 0]);
  });

  it('reserves the hidden-label count for axis categories when a reference label cannot fit', () => {
    const label = 'A'.repeat(60) + 'goal' + 'Z'.repeat(60);
    const result = plot(computeLayout({
      ...input([], 260, 180),
      x: numericAxis([0, 100], { locale: 'en-US' }),
      references: [{ axis: 'x', from: 40, to: 40, label }, { axis: 'y', from: 40, to: 40, label: label.replace('goal', 'limit') }],
    }));
    expect(tickLabels(result, 'reference')).toHaveLength(0);
    expect([result.fit.x.hidden, result.fit.y.hidden]).toEqual([0, 0]);
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
    expect(small.fit.x).toEqual({ remedies: ['wrapped', 'rotated', 'truncated'], hidden: hiddenCategories(small, teams.length) });
    expect(small.fit.x.hidden).toBeGreaterThan(0);
    distinct(tickLabels(small));
    boxesFit(small);
  });

  it('wraps only the long category to three lines before rotating a seven-bar chart', () => {
    const labels = ['North', 'South', 'Infrastructure', 'Customer Success & Onboarding', 'Administration', 'Field', 'Ops'];
    const result = plot(computeLayout({ ...input(labels, 760), kind: 'bands', horizontal: false }));
    expect(result.fit.x).toEqual({ remedies: ['wrapped'], hidden: 0 });
    expect(tickLabels(result).map(text => text.lines)).toEqual(labels.map((label, i) =>
      i === 3 ? ['Customer', 'Success &', 'Onboarding'] : [label]));
    for (const text of tickLabels(result)) expect(text.rotate).toBe(0);
    boxesFit(result);
  });

  it('uses up to 40% of the container for the bottom margin before truncating a rotated label', () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
    const labels = ['', '', '', long, 'Next', '', ''];
    const tall = plot(computeLayout(input(labels, 910, 720)));
    expect(tickLabels(tall).find(text => text.full === long)).toMatchObject({ lines: [long], rotate: -45 });
    expect(tall.fit.x.remedies).toEqual(['rotated']);

    const short = plot(computeLayout(input(labels, 910, 420)));
    expect(short.fit.x.remedies).toEqual(['rotated', 'truncated']);
    const label = tickLabels(short).find(text => text.full === long);
    expect(label?.lines[0]).toMatch(/^ABC.*….*nop$/u);
    expect(label?.rotate).toBe(-45);
    for (const result of [tall, short]) {
      expect(result.height - (result.plot.y + result.plot.height)).toBeLessThanOrEqual(result.height * 0.4 + 1e-6);
      boxesFit(result);
    }
  });

  it.each([false, true])('keeps tick label boxes at least 6 px from the axis lines (horizontal %s)', horizontal => {
    const result = plot(computeLayout({ ...input(['A', 'B', 'C']), kind: 'bands', horizontal }));
    const left = tickLabels(result, horizontal ? 'tick-x' : 'tick-y');
    const bottom = tickLabels(result, horizontal ? 'tick-y' : 'tick-x');
    expect(left.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    for (const { box } of left) expect(result.plot.x - box.x - box.width).toBeGreaterThanOrEqual(6 - 1e-6);
    for (const { box } of bottom) expect(box.y - result.plot.y - result.plot.height).toBeGreaterThanOrEqual(6 - 1e-6);
    boxesFit(result);
  });

  it('places reference lines and bands beside their projected edges and flips at plot boundaries', () => {
    const references: readonly ResolvedReference[] = [
      { axis: 'y', from: 35, to: 35, label: 'Goal' },
      { axis: 'y', from: 90, to: 100, label: 'High range' },
      { axis: 'x', from: 1, to: 1, label: 'Milestone' },
      { axis: 'x', from: 3, to: 4, label: 'Window' },
    ];
    const settings = {
      ...input([], 440, 280), references,
      x: { type: 'linear' as const, domain: [0, 4] as const, candidates: [], mayThin: true },
    };
    const result = plot(computeLayout(settings));
    const { projection, plot: rect } = result;
    if (projection.kind !== 'xy' || projection.x.type === 'band') throw new Error('Expected continuous axes');
    const [goal, high, milestone, window] = tickLabels(result, 'reference');
    expect([goal?.full, high?.full, milestone?.full, window?.full]).toEqual(references.map(reference => reference.label));
    expect(goal!.box.x + goal!.box.width).toBeCloseTo(rect.x + rect.width - 4);
    expect(goal!.box.y + goal!.box.height).toBeCloseTo(projection.y.map(35) - 4);
    expect(high!.box.y).toBeCloseTo(projection.y.map(90) + 4);
    expect(milestone!.box.x).toBeCloseTo(projection.x.map(1) + 4);
    expect(milestone!.box.y).toBeCloseTo(rect.y + 4);
    expect(window!.box.x + window!.box.width).toBeCloseTo(projection.x.map(3) - 4);
    boxesFit(result);
  });

  it('fits overlapping reference labels and truncates overlong labels in the middle', () => {
    const long = 'Start ' + 'long reference '.repeat(10) + 'End';
    const references: readonly ResolvedReference[] = [
      { axis: 'y', from: 100, to: 100, label: 'First' },
      { axis: 'y', from: 100, to: 100, label: 'Second' },
      { axis: 'y', from: 35, to: 35, label: long },
    ];
    const result = plot(computeLayout({ ...input(['A', 'B'], 340, 240), references }));
    const labels = tickLabels(result, 'reference');
    expect(labels.map(label => label.full)).toEqual(['First', 'Second', long]);
    expect(labels.map(label => label.lines[0])).toMatchObject(['First', 'Second', expect.stringMatching(/^Start.*….*End$/u)]);
    for (const { box } of labels) {
      expect(box.x).toBeGreaterThanOrEqual(result.plot.x);
      expect(box.y).toBeGreaterThanOrEqual(result.plot.y);
      expect(box.x + box.width).toBeLessThanOrEqual(result.plot.x + result.plot.width + 1e-6);
      expect(box.y + box.height).toBeLessThanOrEqual(result.plot.y + result.plot.height + 1e-6);
    }
    boxesFit(result);
  });

  it('labels a plot-spanning band just inside its edge when both outside positions are clipped', () => {
    const references: readonly ResolvedReference[] = [
      { axis: 'y', from: 0, to: 100, label: 'Full height' },
      { axis: 'x', from: 0, to: 100, label: 'Full width' },
    ];
    const result = plot(computeLayout({
      ...input([], 440, 280), references,
      x: { type: 'linear' as const, domain: [0, 100] as const, candidates: [], mayThin: true },
    }));
    const [horizontal, vertical] = tickLabels(result, 'reference');
    expect([horizontal?.lines, vertical?.lines]).toEqual([['Full height'], ['Full width']]);
    expect(horizontal!.box.y).toBeCloseTo(result.plot.y + 4);
    expect(vertical!.box.x).toBeCloseTo(result.plot.x + 4);
    boxesFit(result);
  });

  it('clips reference labels to the visible x bounds on a padded bar axis', () => {
    const result = plot(computeLayout({
      ...input([], 440, 280), kind: 'bands', horizontal: false,
      x: { type: 'linear', domain: [-1, 11], candidates: [], mayThin: true },
      referenceXDomain: [0, 10],
      references: [{ axis: 'x', from: -1, to: -1, label: 'Outside' }, { axis: 'x', from: -1, to: 2, label: 'Clipped band' }],
    }));
    expect(tickLabels(result, 'reference').map(text => text.full)).toEqual(['Clipped band']);
    expect(result.fit.x.hidden).toBe(0);
    boxesFit(result);
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
    expect(horizontal.fit.x).toEqual({ remedies: ['truncated'], hidden: similar.length });
    expect(onLeft[0]?.lines[0]).toMatch(/….*EMEA$/u);
    expect(onLeft[1]?.lines[0]).toMatch(/….*APAC$/u);
    for (const text of onLeft) expect(text.box.width).toBeLessThanOrEqual(320 * 0.4);
    boxesFit(horizontal);
  });

  it('thins ordered categories before changing their text and tries all applicable remedies for plain categories', () => {
    const plain = plot(computeLayout(input(teams, 340)));
    expect(plain.fit.x.remedies).toEqual(['wrapped', 'rotated', 'truncated']);
    const ordered = plot(computeLayout(input(teams, 420, 320, true)));
    expect(ordered.fit.x).toEqual({ remedies: ['thinned'], hidden: teams.length - 3 });
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
    expect(result.xTicks.map(tick => tick.value)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
    expect(result.fit.x.hidden).toBe(12);
    if (result.projection.kind !== 'bands') throw new Error('Expected a bar projection');
    expect(result.projection.horizontal).toBe(true);
    expect(result.projection.band.range).toEqual([result.plot.y, result.plot.y + result.plot.height]);
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

  it('only reports hidden category labels over generated widths, locales and axis kinds', () => {
    const cases = fc.record({
      kind: fc.constantFrom('number', 'time', 'date', 'wall'),
      locale: fc.constantFrom('en-US', 'de-DE', 'ja-JP'),
      width: fc.integer({ min: 120, max: 1920 }),
      height: fc.integer({ min: 88, max: 480 }),
      start: fc.integer({ min: -366, max: 366 }),
      length: fc.integer({ min: 1, max: 366 }),
      labels: fc.array(fc.constantFrom('Ops', 'Field', 'Customer Success & Onboarding', 'Web Services International', '', 'Legal'),
        { minLength: 1, maxLength: 40, size: 'large' }),
      horizontal: fc.boolean(),
      mayThin: fc.boolean(),
    });
    const day = 86_400_000;
    fc.assert(fc.property(cases, ({ kind, locale, width, height, start, length, labels, horizontal, mayThin }) => {
      const domain = [start * 100, (start + length) * 100] as const;
      const startDate = Date.UTC(2026, 0, 1) + start * day;
      const x = kind === 'number' ? numericAxis(domain, { locale }) : temporalAxis(
        [startDate, startDate + length * (kind === 'date' ? day : 3_600_000)], { kind, locale, timeZone: 'UTC' },
      );
      const y = numericAxis(domain, { locale });
      const settings = { ...input(labels, width, height, mayThin), kind: 'bands', horizontal, y } as const;
      const continuous = computeLayout({ ...settings, x });
      if (continuous.kind === 'plot') expect([continuous.fit.x.hidden, continuous.fit.y.hidden]).toEqual([0, 0]);
      else expect(continuous.kind).toBe('too-small');

      const categorical = computeLayout(settings);
      if (categorical.kind === 'plot') {
        expect(categorical.fit.x.hidden).toBe(hiddenCategories(categorical, labels.length));
        expect(categorical.fit.y.hidden).toBe(0);
      } else expect(categorical.kind).toBe('too-small');
    }), { numRuns: 1000 });
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
      if (texts.some(text => text.rotate === -45)) {
        expect(height - result.plot.y - result.plot.height).toBeLessThanOrEqual(height * 0.4 + 1e-6);
      }
      if (!mayThin) expect(remedies).not.toContain('thinned');
      expect(result.fit.x.hidden).toBe(mode === 'linear' || mode === 'time' ? 0 : hiddenCategories(result, labels.length));
      expect(remedies).toEqual(expectedOrder.filter(remedy => remedies.includes(remedy)));
    }), { numRuns: 1000 });
  });
});

describe('a value axis too short for any whole tick set of its domain (F7, controller review)', () => {
  // Domain [0, 250] on a step of 50, ticks only at multiples of 50 (each set ends at 250); its wider domains
  // [0, 300] at 100 and [0, 400] at 200 have sparser sets that do.
  const at = (domain: Span, step: number) => {
    const ticks = [];
    for (let v = domain[0]; v <= domain[1]; v += step) ticks.push({ value: v, label: String(v) });
    return ticks;
  };
  const y: ValueAxis = {
    domain: [0, 250], candidates: [at([0, 250], 50)], mayThin: true, title: 'Value',
    coarser: [{ domain: [0, 300], candidates: [at([0, 300], 100)] }, { domain: [0, 400], candidates: [at([0, 400], 200)] }],
  };

  it('takes the first wider domain whose ticks fit whole, so the axis ends at drawn ticks', () => {
    // With 16 px lines a label needs 16 px plus an 8 px gap: six ticks need about 144 px, four about 96.
    const short = plot(computeLayout({ ...input(['a', 'b'], 720, 150), y }));
    const ticks = short.yTicks.map(t => t.value);
    const domain = short.projection.kind === 'xy' ? short.projection.y.domain : null;
    expect(domain).not.toEqual([0, 250]);
    expect(ticks[0]).toBe(domain![0]);
    expect(ticks.at(-1)).toBe(domain![1]);
  });

  it('keeps the domain itself when its ticks fit', () => {
    const tall = plot(computeLayout({ ...input(['a', 'b'], 720, 400), y }));
    expect(tall.projection.kind === 'xy' ? tall.projection.y.domain : null).toEqual([0, 250]);
    expect(tall.yTicks.map(t => t.value)).toEqual([0, 50, 100, 150, 200, 250]);
  });
});

describe('spec F7: a scatter\'s automatic x domain ends at drawn ticks however narrow the plot (verification, defect 10)', () => {
  // F7: "This rule is for value axes: the y axis of line, area and bar, and both axes of scatter", and the
  // automatic domain "ends at the first tick at or beyond each extreme".
  function scatterX(xs: readonly number[], width: number, height = 400) {
    const r = record('scatter', { title: 'T', data: xs.map((x, i) => ({ x, y: i })), x: 'x', y: 'y' }, { container: { width, height } });
    r.frames();
    const layout = r.layout;
    if (layout?.kind !== 'plot' || layout.projection.kind !== 'xy' || layout.projection.x.type === 'band') return null;
    return { domain: layout.projection.x.domain, ticks: layout.xTicks.map(tick => tick.value), plot: layout.plot };
  }

  it.each([195, 205, 215])('x −3.3, 7.7 and 1001.5 at %i px wide', width => {
    const drawn = scatterX([-3.3, 7.7, 1001.5], width)!;
    // The domain contains the data and ends on drawn ticks; [−500, 1500] needs its end tick 1500, which does
    // not fit at this width, so the next domain on a coarser step is drawn, whole.
    expect(drawn.domain[0]).toBeLessThanOrEqual(-3.3);
    expect(drawn.domain[1]).toBeGreaterThanOrEqual(1001.5);
    expect(drawn.ticks[0]).toBe(drawn.domain[0]);
    expect(drawn.ticks.at(-1)).toBe(drawn.domain[1]);
    expect(drawn.domain).toEqual([-1000, 2000]);
    expect(drawn.ticks).toEqual([-1000, 0, 1000, 2000]);
  });

  it('keeps the data\'s own domain where its ticks fit', () => {
    expect(scatterX([-3.3, 7.7, 1001.5], 600)).toMatchObject({ domain: [-500, 1500], ticks: [-500, 0, 500, 1000, 1500] });
  });

  it('for any automatic numeric x domain and any width at which the plot is drawn, both ends are drawn ticks', () => {
    const value = fc.integer({ min: -100_000_000, max: 100_000_000 }).map(n => n / 100);
    fc.assert(fc.property(fc.array(value, { minLength: 2, maxLength: 6 }), fc.integer({ min: 130, max: 700 }), (xs, width) => {
      const drawn = scatterX(xs, width, 300);
      fc.pre(drawn !== null && drawn.domain[0] < drawn.domain[1]);
      expect(drawn!.ticks[0]).toBe(drawn!.domain[0]);
      expect(drawn!.ticks.at(-1)).toBe(drawn!.domain[1]);
    }), { numRuns: 300 });
  });
});
