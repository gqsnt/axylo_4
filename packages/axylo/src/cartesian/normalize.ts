/**
 * Normalization stage for `axylo/cartesian` (C4.3, RFC §2.2 & §4.4).
 * Reuses `normalizeAligned` zero-copy typed-column borrowing, attaches `axisId` and `axisIndex` onto each
 * `Series`, and emits aggregated full-frame `AX171` (nonpositive log values) directly into `dataSink` so
 * `ChartController` preserves it stably across zoom, pan, and legend toggles.
 */
import { SLOT_VALUE, type AlignedFrame, type DiagnosticInput, type DiagnosticSink, type Series } from '../core/contracts';
import { normalizeAligned, type DataEnvironment, type FrameVersion } from '../data/normalize';
import type { ChartType, ResolvedOptions } from '../data/options';
import { reportCartesian } from './diagnostics';
import type { CartesianStateRef } from './meta';
import { markOf } from './boxplot';
import { collectRepeats, repeatsOf, visitRepeats } from './repeats';

export function normalizeCartesian(
  stateRef: CartesianStateRef,
  kind: ChartType,
  resolved: ResolvedOptions,
  env: DataEnvironment,
  sink: DiagnosticSink,
  version: FrameVersion,
): AlignedFrame {
  const { meta } = stateRef;
  // A scatter row that repeats an x is a point of its own (spec F11); every other layer keeps AX108.
  const scatter = (field: string) => markOf(meta, field)?.kind === 'scatter';
  const held: DiagnosticInput[] = [];
  const raw = normalizeAligned('line', resolved, env, meta.series.some(s => scatter(s.field)) ? { add: d => { if (d.code === 'AX108') held.push(d); else sink.add(d); } } : sink, version);
  void kind;
  meta.fullPositiveDomains.clear();
  // data/normalize.ts reports one AX108 per series it could not draw, in series order.
  const repeated: Series[] = [];
  for (const s of raw.series) {
    if (s.drawable) continue;
    const d = held.shift();
    if (scatter(s.field)) repeated.push(s);
    else if (d) sink.add(d);
  }
  for (const d of held) sink.add(d);
  if (repeated.length && resolved.valid) collectRepeats(resolved, env, repeated, raw.x.values, raw.length);

  const annotated: Series[] = raw.series.map(s => {
    const spec = meta.seriesByField.get(s.field);
    if (!spec) return s;
    const drawable = s.drawable || repeated.includes(s);
    const axis = meta.axisById.get(spec.axisId);
    if (axis?.scale === 'log' && drawable) {
      let count = 0;
      const sampleRows: number[] = [];
      const { y, slot, row } = s, more = repeatsOf(s);
      for (let i = 0; i < raw.length; i++) {
        visitRepeats(more, i, (v, k) => {
          if (v > 0) return;
          count++;
          if (sampleRows.length < 10) sampleRows.push(more!.row[k]!);
        });
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
      drawable,
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
