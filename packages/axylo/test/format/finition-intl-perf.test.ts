import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChart } from '../../src/core/chart';
import * as controller from '../../src/core/controller';
import * as environment from '../../src/core/environment';
import { DiagnosticCollector } from '../../src/diagnostics';
import * as figure from '../../src/dom/figure';
import * as interaction from '../../src/dom/interaction';
import { visibleRegion } from '../../src/dom/mapping';
import { dateTimeFormat, numberFormat } from '../../src/format/intl';
import { LINE } from '../../src/kinds/line';
import { defaultMessages } from '../../src/messages';
import { buildReader } from '../../src/reader';
import * as svg from '../../src/render/svg';
import * as textLayer from '../../src/render/text';
import * as theme from '../../src/theme';
import { buildDonut } from '../../src/view/donut';
import { aligned, formatter, frame } from '../lookup/fixtures';

afterEach(() => vi.restoreAllMocks());

describe('Intl formatter cache', () => {
  it.each([true, false])('lets Intl read getters exactly once per construction (enumerable: %s)', enumerable => {
    let numberReads = 0;
    const numberOptions = Object.defineProperty({}, 'minimumFractionDigits', { enumerable, get: () => ++numberReads });
    expect(numberFormat('en-US', numberOptions).format(1)).toBe('1.0');
    expect(numberFormat('en-US', numberOptions).format(1)).toBe('1.00');
    expect(numberReads).toBe(2);

    let dateReads = 0;
    const dateOptions = Object.defineProperty({ timeZone: 'UTC' }, 'year', {
      enumerable, get: () => ++dateReads === 1 ? 'numeric' : '2-digit',
    });
    const date = Date.UTC(2026, 0, 1);
    expect(dateTimeFormat('en-US', dateOptions).format(date)).toBe('2026');
    expect(dateTimeFormat('en-US', dateOptions).format(date)).toBe('26');
    expect(dateReads).toBe(2);

    const unused = Object.defineProperty({}, 'toJSON', { enumerable, get: () => { throw new Error('Unexpected option read'); } });
    expect(numberFormat('en-US', unused)).not.toBe(numberFormat('en-US', unused));
  });

  it('leaves inherited options and coercions to Intl and caches null-prototype records', () => {
    const plain = numberFormat('en-US', {});
    const prototype = { minimumFractionDigits: 1 };
    const custom: Intl.NumberFormatOptions = Object.create(prototype);
    expect(numberFormat('en-US', custom).format(1)).toBe('1.0');
    prototype.minimumFractionDigits = 2;
    expect(numberFormat('en-US', custom).format(1)).toBe('1.00');
    expect(numberFormat('en-US', {})).toBe(plain);

    let coercions = 0;
    const objectValue = { valueOf: () => ++coercions };
    const coerced = { minimumFractionDigits: objectValue } as unknown as Intl.NumberFormatOptions;
    expect(numberFormat('en-US', coerced).format(1)).toBe('1.0');
    expect(numberFormat('en-US', coerced).format(1)).toBe('1.00');
    expect(coercions).toBe(2);

    const bare: Intl.NumberFormatOptions = Object.create(null);
    bare.minimumFractionDigits = 2;
    expect(numberFormat('en-US', bare)).toBe(numberFormat('en-US', { minimumFractionDigits: 2 }));
  });

  it('distinguishes signed zeros, primitive types and absent fields', () => {
    // Intl ignores marker, so object identity exposes key collisions without relying on Intl coercions.
    const values = [0, -0, '0', false, undefined, null, 0n, NaN, Infinity, Symbol('same'), Symbol('same')];
    const formats = values.map(marker => {
      const options = { style: 'decimal' as const, marker };
      const format = numberFormat('en-US', options);
      expect(numberFormat('en-US', { ...options })).toBe(format);
      return format;
    });
    expect(new Set([...formats, numberFormat('en-US', { style: 'decimal' })]).size).toBe(values.length + 1);
  });

  it('preserves names and order for equal copies of option records', () => {
    const field = fc.tuple(fc.constantFrom('flag', 'tag', 'extra', '__proto__'),
      fc.oneof(fc.string(), fc.double(), fc.boolean(), fc.constant(undefined)));
    fc.assert(fc.property(fc.uniqueArray(field, { minLength: 2, selector: ([name]) => name }), fields => {
      const options = Object.fromEntries(fields);
      const format = numberFormat('en-US', options);
      expect(numberFormat('en-US', { ...options })).toBe(format);
      expect(numberFormat('en-US', Object.fromEntries([...fields].reverse()))).not.toBe(format);
    }), { numRuns: 1000 });
  });

  it('evicts at 256 entries per formatter cache and bypasses records wider than 32 fields', async () => {
    vi.resetModules();
    const intl = await import('../../src/format/intl');
    const options = (i: number) => ({ timeZone: 'UTC', useGrouping: true, marker: i });
    const firstNumber = intl.numberFormat('en-US', options(0));
    const firstDate = intl.dateTimeFormat('en-US', options(0));
    for (let i = 1; i < 256; i++) {
      intl.numberFormat('en-US', options(i));
      intl.dateTimeFormat('en-US', options(i));
    }
    expect(intl.numberFormat('en-US', options(0))).toBe(firstNumber);
    expect(intl.dateTimeFormat('en-US', options(0))).toBe(firstDate);

    const atLimit = { ...options(256), ...Object.fromEntries(Array.from({ length: 29 }, (_, i) => [`f${i}`, i])) };
    const wide = { ...atLimit, extra: true };
    expect(intl.numberFormat('en-US', wide)).not.toBe(intl.numberFormat('en-US', wide));
    expect(intl.dateTimeFormat('en-US', wide)).not.toBe(intl.dateTimeFormat('en-US', wide));
    expect(intl.numberFormat('en-US', options(0))).toBe(firstNumber);
    expect(intl.dateTimeFormat('en-US', options(0))).toBe(firstDate);

    expect(intl.numberFormat('en-US', atLimit)).toBe(intl.numberFormat('en-US', atLimit));
    expect(intl.dateTimeFormat('en-US', options(0))).toBe(firstDate);
    expect(intl.dateTimeFormat('en-US', atLimit)).toBe(intl.dateTimeFormat('en-US', atLimit));
    expect(intl.numberFormat('en-US', options(0))).not.toBe(firstNumber);
    expect(intl.dateTimeFormat('en-US', options(0))).not.toBe(firstDate);
  });

  it('looks up cached number and date formats faster than JSON.stringify keys', () => {
    compareLookups(numberFormat, Intl.NumberFormat, [
      { maximumFractionDigits: 2 }, { notation: 'compact', maximumFractionDigits: 1 },
      { style: 'currency', currency: 'USD', minimumFractionDigits: 1 }, { style: 'percent', maximumSignificantDigits: 3 },
    ]);
    compareLookups(dateTimeFormat, Intl.DateTimeFormat, [
      { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }, { timeZone: 'UTC' },
      { month: 'numeric', day: '2-digit', timeZone: 'UTC' }, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' },
    ]);
  });
});

function compareLookups<O, T extends object>(
  lookup: (locale: string, options: O) => T, Format: new (locale: string, options: O) => T, options: readonly O[],
) {
  const cache = new Map<string, T>();
  const json = (locale: string, options: O) => {
    const key = locale + '\u0000' + JSON.stringify(options);
    let value = cache.get(key);
    if (!value) cache.set(key, value = new Format(locale, options));
    return value;
  };
  const time = (find: typeof lookup) => {
    const lastOptions = options[3]!;
    const hit = find('en-US', lastOptions);
    let last: T | undefined;
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) last = find('en-US', options[i & 3]!);
    const elapsed = performance.now() - start;
    expect(last).toBe(hit);
    return elapsed;
  };
  time(lookup);
  time(json);
  // Alternate order and compare medians to reduce the effect of warmup and scheduling noise.
  const samples = [[], []] as [number[], number[]];
  for (let i = 0; i < 5; i++) {
    for (const index of i % 2 === 0 ? [0, 1] as const : [1, 0] as const) {
      samples[index].push(time(index === 0 ? lookup : json));
    }
  }
  const [cached, baseline] = samples.map(times => times.sort((a, b) => a - b)[2]!);
  expect(cached, `${Format.name} cached: ${cached} ms, JSON.stringify: ${baseline} ms`).toBeLessThan(baseline!);
}

describe('reader summaries', () => {
  it('keeps 64 locale lists, including the default, and retries invalid locales without evicting hits', async () => {
    vi.resetModules();
    const { buildReader } = await import('../../src/reader');
    const view = aligned(frame('line', {
      x: 'x', y: [{ field: 'a', label: 'Visits' }, { field: 'b', label: 'Signups' }],
      data: [{ x: 1, a: 2, b: 3 }],
    }));
    const formatters = formatter(view.frame);
    const nativeDefault = new Intl.ListFormat().format(['Visits', 'Signups']);
    const construct = vi.spyOn(Intl, 'ListFormat');
    const read = (locale?: string) => {
      const model = buildReader({ view, formatters, locale, type: 'Line', messages: defaultMessages, table: false });
      return model.name + ' ' + model.summary;
    };
    for (const [locale, list] of [[undefined, nativeDefault], ['en-US', 'Visits and Signups'], ['de-DE', 'Visits und Signups']] as const) {
      for (let i = 0; i < 2; i++) {
        expect(read(locale)).toContain(`Line chart of ${list} by x Line chart with 2 series. x from 1 to 1. ${list} from 2 to 3.`);
      }
    }
    expect(construct.mock.calls.map(([locale]) => locale)).toEqual([undefined, 'en-US', 'de-DE']);
    for (let i = 0; i < 61; i++) read(`en-US-x-${i}`);
    expect(construct).toHaveBeenCalledTimes(64);
    read();
    expect(construct).toHaveBeenCalledTimes(64);

    expect(read('en_US')).toContain('Line chart of Visits, Signups by x');
    expect(read('en_US')).toContain('Visits, Signups from 2 to 3.');
    read();
    expect(construct).toHaveBeenCalledTimes(68);

    read('en-US-x-61');
    read('en-US-x-61');
    expect(construct).toHaveBeenCalledTimes(69);
    read();
    expect(construct).toHaveBeenCalledTimes(70);
  });

  it('includes a positive donut slice even when both angles round to the full turn', () => {
    const data = frame('donut', {
      data: [{ cat: 'Large', hits: 1 }, { cat: 'Tiny', hits: Number.EPSILON / 4 }, { cat: 'Zero', hits: 0 }],
      label: 'cat', value: 'hits',
    });
    const view = buildDonut(data, String, undefined, new DiagnosticCollector());
    expect(view.slices.map(slice => slice.angles)).toEqual([[0, 2 * Math.PI], [2 * Math.PI, 2 * Math.PI], null]);
    const formatters = {
      ...formatter(data), value: (_series: number, value: number) => value === 1 ? '1' : 'tiny',
    };
    expect(buildReader({ view, formatters, type: 'Donut', messages: defaultMessages, table: false }).summary)
      .toBe('Donut chart with 2 slices. Total 1. Large: 1 (100%). Tiny: tiny (0%).');
  });
});

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

it('reads each clipping ancestor once and clips on the correct axis inside scaled borders and scrollbars', () => {
  const root = { clientWidth: 300, clientHeight: 250 };
  const getComputedStyle = vi.fn((element: { style: object }) => element.style);
  const ownerDocument = { defaultView: { getComputedStyle }, documentElement: root };
  const open = { parentElement: root, style: { overflowX: 'visible', overflowY: 'visible' }, getBoundingClientRect: vi.fn() };
  const clipX = {
    parentElement: open, offsetWidth: 101, clientWidth: 91,
    getBoundingClientRect: vi.fn(() => rect(10.125, 20.25, 150.75, 37.6875)),
    style: { boxSizing: 'border-box', width: '100.5px', height: '50.25px', borderLeftWidth: '1.25px', borderRightWidth: '2.75px',
      overflowX: 'hidden', overflowY: 'visible' },
  };
  const clipY = {
    parentElement: clipX, offsetHeight: 61, clientHeight: 51,
    getBoundingClientRect: vi.fn(() => rect(0, 55.125, 100.5, 45.375)),
    style: { boxSizing: 'border-box', width: '100.5px', height: '60.5px', borderTopWidth: '0.75px', borderBottomWidth: '1.25px',
      overflowX: 'visible', overflowY: 'scroll' },
  };
  const from = { ownerDocument, parentElement: clipY } as unknown as Element;
  expect(visibleRegion(from)).toEqual({ x: 12, y: 55.6875, width: 135.75, height: 37.875 });
  expect(getComputedStyle.mock.calls).toEqual([[clipY], [clipX], [open]]);
  expect(clipX.getBoundingClientRect).toHaveBeenCalledOnce();
  expect(clipY.getBoundingClientRect).toHaveBeenCalledOnce();
  expect(open.getBoundingClientRect).not.toHaveBeenCalled();
});

it('measures the plot once per pass with fractional scaling, rounding tolerance and a zero-box guard', () => {
  // Capture the real measurement callback without a renderer or frame loop.
  const create = vi.spyOn(controller, 'controllerFor').mockReturnValue({ handle: {} } as controller.Controller);
  vi.spyOn(svg, 'svgRendererWith').mockReturnValue({ destroy() {} } as ReturnType<typeof svg.svgRendererWith>);
  vi.spyOn(textLayer, 'createTextLayer').mockReturnValue({
    element: { appendChild() {} }, destroy() {},
  } as unknown as ReturnType<typeof textLayer.createTextLayer>);
  vi.spyOn(interaction, 'createInteraction').mockReturnValue({ destroy() {} } as interaction.Interaction);
  vi.spyOn(theme, 'ensureStyles').mockImplementation(() => {});
  const timezone = vi.spyOn(environment, 'viewerTimeZone').mockReturnValue('UTC');
  const style = { boxSizing: 'border-box', width: '100.5px', height: '50.25px' };
  const getComputedStyle = vi.fn(() => style);
  const doc = {
    getElementById: () => null, createElement: () => ({}),
    defaultView: { getComputedStyle, ResizeObserver: class { observe() {} disconnect() {} } },
  };
  const target = { nodeType: 1, ownerDocument: doc, isConnected: false, getRootNode: () => doc };
  const boxRect = vi.fn(() => rect(0, 0, 120, 110));
  const plotRect = vi.fn(() => rect(0, 0, 100.5 * 1.015, 50.25 * 0.99));
  const stageRect = vi.fn(() => rect(0, 0, 120.25 * 1.015, 60.5 * 0.99));
  const plot = { ownerDocument: doc, getBoundingClientRect: plotRect };
  const box = { getBoundingClientRect: boxRect, scrollHeight: 130, clientHeight: 110 };
  vi.spyOn(figure, 'createFigure').mockReturnValue({
    figure: box, plot, stage: { getBoundingClientRect: stageRect }, destroy() {},
  } as unknown as figure.Figure);
  createChart(LINE, target, {});
  const host = create.mock.calls[0]![2];
  expect(timezone).not.toHaveBeenCalled();
  expect(host.timeZone).toBe('UTC');
  timezone.mockReturnValue('Europe/Paris');
  expect(host.timeZone).toBe('Europe/Paris');

  target.isConnected = true;
  expect(host.measure()).toEqual({ width: 100.5, height: 50.25, room: { width: 120.25, height: 60.5 } });
  expect(getComputedStyle.mock.calls).toEqual([[plot]]);
  expect(plotRect).toHaveBeenCalledOnce();

  style.height = '0.75px';
  plotRect.mockReturnValue(rect(0, 0, 100.5005, 0.750004));
  stageRect.mockReturnValue(rect(0, 0, 120.125, 60.25));
  expect(host.measure()).toEqual({ width: 100.5005, height: 0.750004 - 20, room: { width: 120.125, height: 60.25 } });
  expect(getComputedStyle).toHaveBeenCalledTimes(2);
  expect(plotRect).toHaveBeenCalledTimes(2);

  box.scrollHeight = 100;
  expect(host.measure()?.height).toBe(0.750004);
  boxRect.mockReturnValueOnce(rect(0, 0, 0, 110)).mockReturnValueOnce(rect(0, 0, 120, -1));
  expect(host.measure()).toBeNull();
  expect(host.measure()).toBeNull();
  expect(plotRect).toHaveBeenCalledTimes(3);
  expect(getComputedStyle).toHaveBeenCalledTimes(3);
});
