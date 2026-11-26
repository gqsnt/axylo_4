/**
 * Opt-in diagnostics `AX170–AX175` for `axylo/cartesian` (RFC C4.1 §6).
 * Kept completely outside `diagnostics/registry.ts` so legacy bundles pay 0 B; emitted directly into
 * `DiagnosticSink` (`diagnostics/collector.ts`) so strict-mode throwing, deduplication, and F12 reader
 * disclosure work identically.
 */
import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink } from '../core/contracts';

export type CartesianDiagnosticCode = 'AX170' | 'AX171' | 'AX172' | 'AX173' | 'AX174' | 'AX175';

export interface CartesianDiagnosticDetails {
  readonly field?: string;
  readonly rows?: readonly number[];
  readonly count?: number;
  readonly detail?: string;
}

interface Entry {
  readonly level: DiagnosticInput['level'];
  readonly message: (d: CartesianDiagnosticDetails) => string;
}

const REGISTRY: Readonly<Record<CartesianDiagnosticCode, Entry>> = {
  AX170: {
    level: 'error',
    message: d => `${d.field ? `Axis '${d.field}'` : 'Log axis'} has an invalid log configuration${d.detail ? ` (${d.detail})` : ''}. Supply a strictly positive finite domain [min, max] with min < max and base 10 or 2. The chart is not drawn.`,
  },
  AX171: {
    level: 'warning',
    message: d => {
      const n = d.count ?? d.rows?.length ?? 0;
      const sample = d.rows?.length ? ` (rows ${d.rows.slice(0, 10).join(', ')})` : '';
      return `Field '${d.field ?? 'y'}' has ${n} nonpositive value${n === 1 ? '' : 's'}${sample} on a log axis. The affected values are not drawn and remain in the data table.`;
    },
  },
  AX172: {
    level: 'error',
    message: d => `${d.field ? `Axis '${d.field}'` : 'Log axis'} has no positive values to plot. Supply positive values or use a linear axis. The chart is not drawn.`,
  },
  AX173: {
    level: 'error',
    message: d => `${d.detail ?? `Bar and area layers cannot bind to log axis '${d.field ?? 'y'}'`} (spec F1/F13 require a zero baseline). Use a linear axis or a line layer. The chart is not drawn.`,
  },
  AX174: {
    level: 'error',
    message: d => `${d.detail ?? `Invalid Cartesian axis configuration for '${d.field ?? 'axes'}'`}. Declare one 'left' axis and at most one 'right' axis, bind each field to one valid axis ID. The chart is not drawn.`,
  },
  AX175: {
    level: 'hint',
    message: d => `Plot width is below 360 px; secondary right axis${d.field ? ` '${d.field}'` : ''} collapsed into legend and summary annotations (spec L9).`,
  },
};

export function createCartesianDiagnostic(
  code: CartesianDiagnosticCode,
  effect: DiagnosticEffect,
  details: CartesianDiagnosticDetails = {},
  origin: DiagnosticInput['origin'] = 'call',
): DiagnosticInput {
  const entry = REGISTRY[code];
  const firstRows = details.rows === undefined ? undefined : [...new Set(details.rows)].slice(0, 10);
  const count = details.count ?? details.rows?.length;
  return {
    code,
    level: entry.level,
    effect,
    origin,
    message: entry.message({ ...details, rows: firstRows, count }),
    ...(details.field === undefined ? {} : { field: details.field }),
    ...(firstRows === undefined ? {} : { rows: firstRows }),
    ...(count === undefined ? {} : { count }),
  };
}

export function reportCartesian(
  sink: DiagnosticSink,
  code: CartesianDiagnosticCode,
  effect: DiagnosticEffect,
  details?: CartesianDiagnosticDetails,
  origin: DiagnosticInput['origin'] = 'call',
): void {
  sink.add(createCartesianDiagnostic(code, effect, details, origin));
}
