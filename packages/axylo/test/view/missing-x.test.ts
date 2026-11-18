/**
 * Scatter observations with an x and no y (`PointSeries.missingX`) reach the automatic x domain, so the
 * default table range lists them (spec F2, A4); the plotted points are unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { PointFrame } from '../../src/core/contracts';
import { DiagnosticCollector } from '../../src/diagnostics';
import { buildView } from '../../src/view';

const series = (x: number[], y: number[], missingX?: number[]) => ({
  key: 'a', label: 'a', drawable: true, x: Float64Array.from(x), y: Float64Array.from(y), row: null,
  ...(missingX ? { missingX: Float64Array.from(missingX) } : {}),
});

function frame(s: ReturnType<typeof series>[]): PointFrame {
  return {
    shape: 'points', revision: 1, epoch: 1, source: { rowAt: () => null }, xKind: 'number', timeZone: null,
    series: s, xLabel: 'x', yLabel: 'y', xUnit: null, yUnit: null,
  };
}

describe('scatter x domain and missingX', () => {
  it('an omission beyond the plotted ends widens the automatic x domain on that side', () => {
    const view = buildView(frame([series([10, 20], [1, 2], [35])]), { kind: 'scatter' }, new DiagnosticCollector());
    expect(view.xFull[1]).toBeGreaterThanOrEqual(35);
    expect(view.xFull[0]).toBeLessThanOrEqual(10);
    // The plotted points stay as they are.
    expect(Array.from(view.frame.series[0]!.x)).toEqual([10, 20]);
  });

  it('a series made only of omissions still gives a domain that holds them', () => {
    const view = buildView(frame([series([], [], [3, 7])]), { kind: 'scatter' }, new DiagnosticCollector());
    expect(view.xFull[0]).toBeLessThanOrEqual(3);
    expect(view.xFull[1]).toBeGreaterThanOrEqual(7);
  });
});
