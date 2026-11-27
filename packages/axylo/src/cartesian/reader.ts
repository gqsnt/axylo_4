/**
 * Reader & table parts for `axylo/cartesian` (C4.3, RFC §2.2 & §5.2).
 * - Formats y-reference lines/bands using the bound axis's own formatter & unit (defaulting omitted
 *   `axisId` explicitly to the `'left'` axis, even when that axis currently has zero series).
 * - Preserves exact raw values in the data table, appending `" (not plotted — log)"` on nonpositive log rows.
 * - Marks incomplete stacks (spec F10) with the core wording: in the table by handing the core table a view whose
 *   `stack` carries the union of the Cartesian stacks' incomplete slots, and in the summary with the core's
 *   "incomplete at" sentence over the visible window. The published view keeps no stack: the core value-extent
 *   helpers would read it as the only data of the chart.
 */
import { SLOT_VALUE, type AlignedView, type Formatters, type ResolvedReference, type TableModel } from '../core/contracts';
import type { Messages } from '../public';
import { fill, fillChartSummary, fillSeriesSummary } from '../messages';
import { seriesNotDrawnSentence, type ReaderParts } from '../reader';
import { alignedTable, withUnit, type ReaderLabels } from '../reader/table';
import { annotationSummarySentences } from './annotations';
import { formatAxisValue, type CartesianStateRef } from './meta';
import { cartesianStacks } from './stacks';
import { axisOf, carrierReadout, intervalText, isCompoundKind, isLogSeries, markOf, visitOutliers, partIndex, physicalOf } from './boxplot';

/** Column headers of one logical series: one per series, five numbers and the outliers per box. */
const BOX_COLUMNS = [['min', 'min'], ['q1', 'Q1'], ['median', 'median'], ['q3', 'Q3'], ['max', 'max']] as const;

// A 'line' composition (cartesian.ts) builds aligned views only.
function cartesianTable(
  stateRef: CartesianStateRef,
  view: AlignedView,
  caption: string,
  formatters: Formatters,
  messages: Messages,
  labels: ReaderLabels,
  locale: string | undefined,
): TableModel {
  const { meta } = stateRef;
  // The core table reads only `incomplete` of a stack.
  const { incomplete } = cartesianStacks(view, meta);
  const base = alignedTable(incomplete ? { ...view, stack: { order: [], positive: [], negative: [], incomplete } } : view,
    caption, formatters, messages, labels, locale);
  const { series } = view.frame;
  const physical = physicalOf(view);
  const marks = series.map(s => markOf(meta, s.field));
  const compound = marks.some(m => isCompoundKind(m?.kind));
  const logSeries = series.map(s => isLogSeries(meta, s));
  if (!compound && !logSeries.some(Boolean)) return base;

  const read = carrierReadout(meta, physical, formatters, ' (not plotted — log)');
  const headers: string[] = [base.headers[0]!];
  series.forEach((s, i) => {
    const m = marks[i];
    if (m?.kind === 'boxplot') {
      for (const [, word] of BOX_COLUMNS) headers.push(withUnit(`${s.label} ${word}`, s.unit));
      headers.push(`${s.label} outliers`);
    } else headers.push(base.headers[i + 1]!);
  });

  const { start } = view.visibleSlots;
  return {
    caption: base.caption,
    headers,
    rowCount: base.rowCount,
    pageSize: base.pageSize,
    pageForX: x => base.pageForX(x),
    row(index: number): readonly string[] | null {
      const cells = base.row(index);
      if (!cells) return null;
      const slotIndex = start + index;
      const out: string[] = [cells[0]!];
      series.forEach((s, i) => {
        const m = marks[i];
        const at = (role: Parameters<typeof partIndex>[3]) => m ? partIndex(m, physical, i, role) : -1;
        if (m?.kind === 'boxplot') {
          for (const [role] of BOX_COLUMNS) out.push(read.cell(at(role), slotIndex));
          out.push(read.outliers(at('median'), m.outliers, slotIndex) ?? 'none');
        } else if (m?.kind === 'range' || m?.kind === 'errorBar') {
          out.push(intervalText(m, role => read.cell(at(role), slotIndex)));
        } else if (logSeries[i] && s.slot[slotIndex] === SLOT_VALUE && !(s.y[slotIndex]! > 0)) {
          out.push(`${cells[i + 1]} (not plotted — log)`);
        } else out.push(cells[i + 1]!);
      });
      return out;
    },
  };
}

function formatList(names: readonly string[], locale: string | undefined): string {
  if (names.length < 2) return names[0] ?? '';
  try { return new Intl.ListFormat(locale, { type: 'conjunction' }).format(names); } catch { return names.join(', '); }
}

export function createCartesianReader(stateRef: CartesianStateRef): ReaderParts {
  return {
    table: (view, caption, formatters, messages, labels, locale) =>
      cartesianTable(stateRef, view as AlignedView, caption, formatters, messages, labels, locale),
    tableRowCount: view => view.kind === 'donut' || view.kind === 'scatter' ? null : view.visibleSlots.end - view.visibleSlots.start,
    stateKey: () => {
      const { meta } = stateRef;
      const collapse = meta.collapsedRightAxis === true ? '1' : '0';
      return meta.annotations.length ? `${collapse}|${JSON.stringify(meta.annotations)}` : collapse;
    },
    text(input, type, xLabel, yLabel, table, listReady) {
      const { meta } = stateRef;
      const { formatters, messages } = input;
      const view = input.view as AlignedView;
      const { frame, visibleSlots: { start, end } } = view;
      const physical = physicalOf(view);
      const readout = carrierReadout(meta, physical, formatters, ' (not plotted)');
      const zone = frame.x.kind === 'time' && frame.x.timeZone;
      const entries = zone ? ['', ''] : [''];
      const headingLen = entries.length;
      let xMin = Infinity, xMax = -Infinity;
      if (start < end) {
        xMin = frame.binEdges?.[start] ?? frame.x.values[start]!;
        xMax = frame.binEdges?.[end] ?? frame.x.values[end - 1]!;
      }
      let allMin = Infinity, allMax = -Infinity, allMinText = '', allMaxText = '';
      let drawable = 0, unit: string | undefined, oneUnit = true;
      const nameRange = !frame.yLabel;
      let rangeNames: string[] | undefined, undrawn: string[] | undefined;

      for (let k = 0; k < frame.series.length; k++) {
        const rep = frame.series[k]!;
        if (!rep.drawable) { (undrawn ??= []).push(seriesNotDrawnSentence(messages, rep.label, table)); continue; }
        drawable++;
        if (!view.visible[k]) continue;
        const mark = markOf(meta, rep.field);
        const parts = physical.parts[k];
        const isCompound = !!(mark && parts && isCompoundKind(mark.kind));
        let min = Infinity, max = -Infinity, minIdx = k, maxIdx = k, last = -1;
        // A compound mark is read only where it is drawn: a row whose required parts all hold plottable values.
        const rows = isCompound ? physical.rows?.[k] ?? null : null;
        const log = isCompound && isLogSeries(meta, rep);
        for (const idx of isCompound ? parts : [k]) {
          const s = physical.frame.series[idx];
          if (!s) continue;
          for (let i = start; i < end; i++) {
            if (s.slot[i] !== SLOT_VALUE || (rows && rows[i] !== SLOT_VALUE)) continue;
            const v = s.y[i]!;
            if (log && !(v > 0)) continue;
            if (v < min) { min = v; minIdx = idx; }
            if (v > max) { max = v; maxIdx = idx; }
          }
        }
        for (let i = end - 1, at = rows ?? rep.slot; i >= start && last < 0; i--) if (at[i] === SLOT_VALUE) last = i;
        if (isCompound && mark.kind === 'boxplot') {
          const medIdx = partIndex(mark, physical, k, 'median');
          const medRow = physical.frame.series[medIdx]?.row ?? null;
          const include = (v: number) => {
            if (log && !(v > 0)) return;
            if (v < min) { min = v; minIdx = medIdx; }
            if (v > max) { max = v; maxIdx = medIdx; }
          };
          for (let i = start; i < end; i++) {
            if (!rows || rows[i] === SLOT_VALUE) visitOutliers(mark.outliers, medRow, i, include);
          }
        }
        if (min < allMin) { allMin = min; allMinText = formatters.value(minIdx, min); }
        if (max > allMax) { allMax = max; allMaxText = formatters.value(maxIdx, max); }
        if (last >= 0) {
          if (nameRange) (rangeNames ??= []).push(rep.label);
          if (frame.series.length > 1 && oneUnit) {
            const cur = `${rep.unit}\u0001${rep.valueScale}`;
            unit ??= cur;
            oneUnit = unit === cur;
          }
          const minText = formatters.value(minIdx, min);
          const maxText = Object.is(max, min) && maxIdx === minIdx ? minText : formatters.value(maxIdx, max);
          let lastText: string;
          if (isCompound) {
            const read = (role: Parameters<typeof partIndex>[3]) => {
              const idx = partIndex(mark, physical, k, role);
              const s = physical.frame.series[idx];
              return s ? readout.cell(idx, last) : formatters.missing(0);
            };
            lastText = mark.kind === 'boxplot' ? `median ${read('median')}` : intervalText(mark, read);
          } else {
            lastText = formatters.value(k, rep.y[last]!);
          }
          entries.push(fillSeriesSummary(messages.seriesSummary, rep.label, minText, maxText, lastText));
        } else {
          entries.push(fill(messages.seriesNoData, { series: rep.label }));
        }
      }

      const zoneText = zone ? fill(messages.timeZoneNote, { zone }) : null;
      const seriesCount = entries.length - headingLen;
      let sentences: string[];
      if (!seriesCount || !Number.isFinite(xMin) || !Number.isFinite(xMax)) {
        sentences = undrawn ?? [];
        sentences.push(messages.empty);
        if (zoneText !== null) sentences.push(zoneText);
      } else {
        const range = Number.isFinite(allMin) && Number.isFinite(allMax) && oneUnit ? { yMin: allMinText, yMax: allMaxText } : null;
        let rangeLabel = yLabel;
        if (rangeNames) {
          if (rangeNames.length === 1) rangeLabel = rangeNames[0]!;
          else if (rangeNames.length !== drawable || !listReady) rangeLabel = formatList(rangeNames, input.locale);
        }
        entries[0] = fillChartSummary(messages.chartSummary, {
          type, seriesCount: formatters.count(seriesCount), xLabel, xMin: formatters.x(xMin), xMax: formatters.x(xMax), yLabel: rangeLabel,
        }, range);
        if (zoneText !== null) entries[1] = zoneText;
        if (undrawn) entries.push(...undrawn);
        sentences = entries;
      }

      // Spec F10 asks for "incomplete" in announcements too.
      const flags = cartesianStacks(view, meta).incomplete;
      if (flags) {
        const positions: string[] = [];
        let count = 0;
        for (let i = start; i < end; i++) if (flags[i] && count++ < 3) positions.push(formatters.x(frame.x.values[i]!));
        if (count) {
          sentences.push(count > 3
            ? fill(messages.incompleteCount, { label: frame.xLabel, count: formatters.count(count) })
            : fill(messages.incompleteAt, { label: frame.xLabel, positions: positions.join(', ') }));
        }
      }
      if (meta.collapsedRightAxis && meta.axes[1]) {
        const right = meta.axes[1];
        sentences.push(`Secondary right axis (${withUnit(right.label ?? right.id, right.unit)}) values are plotted on their own scale.`);
      }
      if (meta.annotations.length > 0) {
        sentences.push(...annotationSummarySentences(view, meta, formatters.x, input.locale ?? 'en-US'));
      }
      return sentences;
    },
    ref(ref: ResolvedReference, value: number, formatters: Formatters, locale: string | undefined): string {
      if (ref.axis !== 'y') return formatters.x(value);
      const axis = axisOf(stateRef.meta, ref.axisId);
      return axis ? formatAxisValue(axis, value, locale ?? 'en-US') : formatters.value(0, value);
    },
  };
}
