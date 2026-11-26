/**
 * Normalization stage for `axylo/cartesian` (C4.3, RFC §2.2 & §4.4).
 * Reuses `normalizeAligned` zero-copy typed-column borrowing, attaches `axisId` and `axisIndex` onto each
 * `Series`, and emits aggregated full-frame `AX171` (nonpositive log values) directly into `dataSink` so
 * `ChartController` preserves it stably across zoom, pan, and legend toggles.
 */
import { SLOT_VALUE, type AlignedFrame, type DiagnosticSink, type Series } from '../core/contracts';
import { normalizeAligned, type DataEnvironment, type FrameVersion } from '../data/normalize';
import type { ChartType, ResolvedOptions } from '../data/options';
import { reportCartesian } from './diagnostics';
import type { CartesianStateRef } from './meta';

export function normalizeCartesian(
  stateRef: CartesianStateRef,
  kind: ChartType,
  resolved: ResolvedOptions,
  env: DataEnvironment,
  sink: DiagnosticSink,
  version: FrameVersion,
): AlignedFrame {
  const raw = normalizeAligned('line', resolved, env, sink, version);
  void kind;
  const { meta } = stateRef;
  meta.fullPositiveDomains.clear();

  const annotated: Series[] = raw.series.map(s => {
    const spec = meta.seriesByField.get(s.field);
    if (!spec) return s;
    const axis = meta.axisById.get(spec.axisId);
    if (axis?.scale === 'log' && s.drawable) {
      let count = 0;
      const sampleRows: number[] = [];
      const { y, slot, row } = s;
      for (let i = 0; i < raw.length; i++) {
        if (slot[i] !== SLOT_VALUE) continue;
        if (!(y[i]! > 0)) {
          count++;
          if (sampleRows.length < 10) {
            const srcRow = row ? row[i]! : i;
            if (srcRow >= 0) sampleRows.push(srcRow);
          }
        }
      }
      if (count > 0) {
        reportCartesian(sink, 'AX171', 'omitted', {
          field: s.field,
          rows: sampleRows.length ? sampleRows : undefined,
          count,
        });
      }
    }
    return {
      ...s,
      axisId: spec.axisId,
      axisIndex: spec.axisIndex,
    };
  });

  // C5.1: validate range/errorBar intervals for reversed bounds (`low > high`) without copying borrowed columns.
  if (meta.intervals.length > 0) {
    const byField = new Map(annotated.map(s => [s.field, s]));
    for (const iv of meta.intervals) {
      const lowS = byField.get(iv.lowField);
      const highS = byField.get(iv.highField);
      if (!lowS || !highS) continue;
      let reversed = 0;
      const sampleRows: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        if (lowS.slot[i] !== SLOT_VALUE || highS.slot[i] !== SLOT_VALUE) continue;
        const lo = lowS.y[i]!;
        const hi = highS.y[i]!;
        if (Number.isFinite(lo) && Number.isFinite(hi) && lo > hi) {
          reversed++;
          if (sampleRows.length < 10) {
            const srcRow = lowS.row ? lowS.row[i]! : i;
            if (srcRow >= 0) sampleRows.push(srcRow);
          }
        }
      }
      if (reversed > 0) {
        reportCartesian(sink, 'AX176', 'none', {
          field: iv.label,
          rows: sampleRows.length ? sampleRows : undefined,
          count: reversed,
        });
      }
    }
  }

  return {
    ...raw,
    series: annotated,
  };
}
