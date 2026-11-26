/**
 * Per-chart metadata state holder for `axylo/cartesian` (RFC C4.1 §2.1).
 * Stored on the chart instance's closure (passed into `createCartesianComposition(stateRef)`) so metadata
 * survives `renamed()` frames and domain-only updates cleanly without WeakMaps or edits to `controller.ts`.
 */
import type { NumberFormatOption } from '../format';
import { createNumberReadout } from '../format/number';
import type { LogBase, Span } from '../scale/log';

export type CartesianLayerMark = 'bar' | 'area' | 'line';

export interface CartesianAxisSpec {
  readonly id: string;
  readonly index: 0 | 1;
  readonly position: 'left' | 'right';
  readonly scale: 'linear' | 'log';
  readonly base: LogBase;
  readonly rawBase?: unknown;
  readonly domain: Span | null;
  readonly rawDomain?: unknown;
  readonly label: string | null;
  readonly unit: string | null;
  readonly format: NumberFormatOption | null;
  readonly tickFormat: NumberFormatOption | null;
}

export interface CartesianSeriesSpec {
  readonly field: string;
  readonly label: string;
  readonly mark: CartesianLayerMark;
  readonly stacked: boolean;
  readonly axisId: string;
  readonly axisIndex: 0 | 1;
  readonly layerIndex: number;
}

export interface CartesianReferenceSpec {
  readonly axis: 'x' | 'y';
  readonly axisId?: string;
  readonly label: string;
  readonly value?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
}

export interface CartesianMeta {
  /** Ordered `[leftAxis]` or `[leftAxis, rightAxis]`; `axes[0]` is always `'left'`. */
  readonly axes: readonly CartesianAxisSpec[];
  readonly axisById: ReadonlyMap<string, CartesianAxisSpec>;
  readonly leftAxisId: string;
  readonly rightAxisId: string | null;
  /** Per-field layer specs in declared layer order. */
  readonly series: readonly CartesianSeriesSpec[];
  readonly seriesByField: ReadonlyMap<string, CartesianSeriesSpec>;
  /** Raw reference specs (preserving `axisId` for y-references). */
  readonly references: readonly CartesianReferenceSpec[];
  /** Non-empty when options failed structural validation (`AX170`/`AX173`/`AX174`). */
  readonly invalid: boolean;
  /** Full-data positive domains cached per axis for zoom fallback (RFC §4.4). */
  fullPositiveDomains: Map<string, Span>;
  /** True when the latest committed layout collapsed the secondary right axis (`plot.width < 360 px`, spec L9). */
  collapsedRightAxis?: boolean;
}

export interface CartesianStateRef {
  meta: CartesianMeta;
}

/** Canonical per-axis-ID domain signature used to invalidate caches on any primary or secondary domain update. */
export function axesDomainSignature(axes: readonly CartesianAxisSpec[]): string {
  return [...axes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(a => `${a.id}:${a.domain ? `${a.domain[0]},${a.domain[1]}` : 'auto'}`)
    .join('|');
}

/**
 * Formats a value using the specified axis's own `format` and `unit` (RFC §2.2 & §5.2),
 * working identically for both band endpoints even when that axis currently has zero series.
 */
export function formatAxisValue(axis: CartesianAxisSpec, value: number, locale: string): string {
  const formatter = createNumberReadout({ locale, unit: axis.unit, format: axis.format });
  return formatter(value);
}
