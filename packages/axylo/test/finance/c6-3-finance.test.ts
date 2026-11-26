/**
 * C6.3 unit tests for `axylo/finance` (OHLC/candlestick + volume validation `AX180`/`AX181`,
 * batched O(N) hollow-up / filled-down / doji marks, exact tooltip/table/summary parity).
 */
import { describe, expect, it } from 'vitest';
import { validateCandlestick } from '../../src/finance';
import { buildFinanceView, normalizeFinance, parseFinanceInput } from '../../src/finance/core';
import { buildFinanceScene, createFinanceLookup, createFinanceReader } from '../../src/finance/render';
import { alignedLayout, type AxisContext } from '../../src/core/axes';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { resolveOptions } from '../../src/data/options';
import { createFormatters } from '../../src/format';
import { defaultMessages } from '../../src/messages';
import { readerWith } from '../../src/reader';
import type { TextMeasurer, TextStyle } from '../../src/core/contracts';

const measurer: TextMeasurer = { width: text => text.length * 7 };
const style: TextStyle = { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 16 };

describe('C6.3 axylo/finance candlestick + volume', () => {
  it('validates OHLC envelope (AX180) and negative volume (AX181) without DOM and omits only offending marks', () => {
    const rows = [
      { day: '2026-01-01', o: 100, h: 112, l: 98, c: 110, v: 5000 },  // valid up (hollow)
      { day: '2026-01-02', o: 110, h: 111, l: 100, c: 102, v: 4200 }, // valid down (filled)
      { day: '2026-01-03', o: 102, h: 105, l: 99, c: 102, v: 3100 },  // valid doji (unchanged)
      { day: '2026-01-04', o: 105, h: 100, l: 95, c: 104, v: 2000 },  // invalid OHLC: h < max(o,c) -> AX180
      { day: '2026-01-05', o: 104, h: 109, l: 101, c: 108, v: -100 }, // invalid volume: v < 0 -> AX181
    ];
    const opts = {
      title: 'ACME Stock',
      data: rows,
      x: 'day' as const,
      open: 'o' as const,
      high: 'h' as const,
      low: 'l' as const,
      close: 'c' as const,
      volume: 'v' as const,
      yAxis: { unit: 'USD' },
    };

    const nodeDiags = validateCandlestick(opts);
    expect(nodeDiags.some(d => d.code === 'AX180' && d.rows?.includes(3))).toBe(true);
    expect(nodeDiags.some(d => d.code === 'AX181' && d.rows?.includes(4))).toBe(true);

    const parsed = parseFinanceInput(opts);
    const stateRef = { meta: parsed.meta };
    const sink = new DiagnosticCollector();
    const resolved = resolveOptions('line', parsed.translated, sink);
    const frame = normalizeFinance(stateRef, 'line', resolved, { timeZone: 'UTC' }, sink, { epoch: 1, revision: 1 });
    const view = buildFinanceView(stateRef, frame, {
      kind: 'line', hidden: new Set(), zoom: null, xField: resolved.x, xDomain: resolved.x.domain,
      valueDomain: null, valueField: resolved.values[0]?.field, references: [], previous: null,
      stacked: false, horizontal: false, compact: false,
    }, sink);
    const ctx: AxisContext = { resolved, locale: 'en-US', compact: false, xLabelGiven: true, valueTitle: 'Price' };
    const layout = alignedLayout().compute(view, { width: 640, height: 320 }, { measurer, style }, ctx);
    const scene = buildFinanceScene(stateRef, view, layout, 1);

    // Batched marks: 1 wick+doji PathMark, 1 up-hollow PathMark, 1 down-filled RectMark, 1 volume RectMark
    const paths = scene.marks.filter(m => m.type === 'path');
    const rects = scene.marks.filter(m => m.type === 'rects');
    expect(paths).toHaveLength(2);
    expect(rects).toHaveLength(2);
    // Volume rect count: rows 0, 1, 2 only (row 3 omitted due to AX180, row 4 omitted due to AX181 -> 3 bars = 12 floats)
    const volMark = rects.find(r => r.type === 'rects' && r.series === 2);
    expect(volMark && volMark.type === 'rects' ? volMark.xywh.length : 0).toBe(12);

    const formatters = createFormatters({
      series: frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: null })),
      x: { field: resolved.x.field, kind: frame.x.kind, unit: resolved.x.unit, scale: resolved.x.scale, format: null, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories },
      locale: 'en-US',
      messages: { noData: defaultMessages.noData, noObservation: defaultMessages.noObservation },
    }, { locale: 'en-US', timeZone: 'UTC' });

    const lookup = createFinanceLookup(stateRef, view, layout, formatters, defaultMessages, 'en-US');
    const reader = readerWith(createFinanceReader(stateRef), {
      view, formatters, messages: defaultMessages, type: 'Line', title: 'ACME Stock', locale: 'en-US',
    });

    // Tooltip & table parity: exact OHLC, signed change, direction, and volume with invalid qualifiers preserved
    const tip0 = lookup.tooltip({ kind: 'x', x: frame.x.values[0]! });
    expect(tip0.rows.map(r => `${r.seriesLabel}=${r.value}`)).toEqual([
      'Open=100 USD', 'High=112 USD', 'Low=98 USD', 'Close=110 USD', 'Change=+10 USD (up)', 'Volume=5,000',
    ]);
    expect(reader.table!.headers).toEqual(['day', 'Open', 'High', 'Low', 'Close', 'Change', 'Direction', 'Volume']);
    expect(reader.table!.row(3)![1]).toContain('(invalid OHLC)');
    expect(reader.table!.row(4)![7]).toContain('(invalid volume)');
    expect(reader.summary).toContain('Up candles are drawn hollow; down candles are filled; unchanged candles are horizontal ticks.');
  });
});
