import type { AlignedFrame, Frame } from '../../src/core/contracts';
import { normalize, resolveOptions, type ChartType } from '../../src/data';
import { DiagnosticCollector } from '../../src/diagnostics';

export const version = { epoch: 4, revision: 8 };
export const utc = { timeZone: 'UTC' };

export function check(type: ChartType, options: unknown, environment = utc): { frame: Frame; diagnostics: DiagnosticCollector } {
  const diagnostics = new DiagnosticCollector();
  const resolved = resolveOptions(type, options, diagnostics);
  return { frame: normalize(type, resolved, environment, diagnostics, version), diagnostics };
}

export function aligned(options: unknown, environment = utc) {
  const diagnostics = new DiagnosticCollector();
  const resolved = resolveOptions('line', options, diagnostics);
  return { frame: normalize('line', resolved, environment, diagnostics, version), diagnostics, resolved };
}

export function contents(frame: AlignedFrame) {
  return {
    x: { ...frame.x, values: [...frame.x.values] },
    length: frame.length, xLabel: frame.xLabel, yLabel: frame.yLabel,
    series: frame.series.map(({ y, slot, row, ...description }) => ({
      ...description, y: [...y], slot: [...slot], row: row ? [...row] : [...y.keys()],
    })),
  };
}
