/**
 * Opt-in diagnostics `AX170–AX176` for `axylo/cartesian` (RFC C4.1 §6).
 * Kept outside `diagnostics/registry.ts` so legacy bundles pay 0 B.
 */
import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink } from '../core/contracts';

export type CartesianDiagnosticCode = 'AX170' | 'AX171' | 'AX172' | 'AX173' | 'AX174' | 'AX175' | 'AX176';

export interface CartesianDiagnosticDetails {
  readonly field?: string;
  readonly rows?: readonly number[];
  readonly count?: number;
  readonly detail?: string;
}

const NOT_DRAWN = ' The chart is not drawn.';
const countAndSample = (d: CartesianDiagnosticDetails, noun: string) => {
  const n = d.count ?? d.rows?.length ?? 0;
  return `${n} ${noun}${n === 1 ? '' : 's'}${d.rows?.length ? ` (rows ${d.rows.slice(0, 10).join(', ')})` : ''}`;
};

const LEVELS: Readonly<Record<CartesianDiagnosticCode, DiagnosticInput['level']>> = {
  AX170: 'error', AX171: 'warning', AX172: 'error', AX173: 'error', AX174: 'error', AX175: 'hint', AX176: 'warning',
};

function messageFor(code: CartesianDiagnosticCode, d: CartesianDiagnosticDetails): string {
  const ax = d.field ? `Axis '${d.field}'` : 'Log axis';
  switch (code) {
    case 'AX170': return `${ax} has an invalid log configuration${d.detail ? ` (${d.detail})` : ''}. Supply a strictly positive finite domain [min, max] with min < max and base 10 or 2.${NOT_DRAWN}`;
    case 'AX171': return `Field '${d.field ?? 'y'}' has ${countAndSample(d, 'nonpositive value')} on a log axis. The affected values are not drawn and remain in the data table.`;
    case 'AX172': return `${ax} has no positive values to plot. Supply positive values or use a linear axis.${NOT_DRAWN}`;
    case 'AX173': return `${d.detail ?? `Bar and area layers cannot bind to log axis '${d.field ?? 'y'}'`} (spec F1/F13 require a zero baseline). Use a linear axis or a line layer.${NOT_DRAWN}`;
    case 'AX174': return `${d.detail ?? `Invalid Cartesian axis configuration for '${d.field ?? 'axes'}'`}. Declare one 'left' axis and at most one 'right' axis, bind each field to one valid axis ID.${NOT_DRAWN}`;
    case 'AX175': return `Plot width is below 360 px; secondary right axis${d.field ? ` '${d.field}'` : ''} collapsed into legend and summary annotations (spec L9).`;
    case 'AX176': return `Interval '${d.field ?? 'range'}' has ${countAndSample(d, 'reversed bound')} where low > high. Displayed using min/max span; raw values are preserved in tooltip and table.`;
  }
}

export function createCartesianDiagnostic(
  code: CartesianDiagnosticCode,
  effect: DiagnosticEffect,
  details: CartesianDiagnosticDetails = {},
  origin: DiagnosticInput['origin'] = 'call',
): DiagnosticInput {
  const rows = details.rows === undefined ? undefined : [...new Set(details.rows)].slice(0, 10);
  const count = details.count ?? details.rows?.length;
  const out: DiagnosticInput & { field?: string; rows?: readonly number[]; count?: number } = {
    code, level: LEVELS[code], effect, origin, message: messageFor(code, { ...details, rows, count }),
  };
  if (details.field !== undefined) out.field = details.field;
  if (rows !== undefined) out.rows = rows;
  if (count !== undefined) out.count = count;
  return out;
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

let annotationPaths: WeakMap<object, string> | undefined;

/** The option path (`annotations[i]`) of a parsed annotation: the parsed list skips malformed entries. */
export function annotationPath(spec: object, path?: string): string {
  if (path !== undefined) (annotationPaths ??= new WeakMap()).set(spec, path);
  return annotationPaths?.get(spec) ?? 'annotations';
}
