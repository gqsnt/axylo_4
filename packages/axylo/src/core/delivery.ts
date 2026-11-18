/**
 * Diagnostic delivery (spec 3.5): what is printed, what reaches `onDiagnostic`, and what `strict` throws.
 *
 * Errors and warnings print with `console.warn` once per code per page in every build; hints print with
 * `console.info`, also once per code per page, and only in development builds. `onDiagnostic` receives every
 * diagnostic a chart newly finds. `strict` throws on errors and warnings found while validating a call
 * (origin 'call'); diagnostics found later (origin 'presentation') are reported and never thrown.
 */
import type { DiagnosticInput } from './contracts';
import type { Diagnostic } from '../public';

export interface DeliveryConsole {
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Codes already printed, per page. The key is the document in a browser, any object in tests. */
const printed = new WeakMap<object, Set<string>>();
const fallbackPage = {};

export interface DeliveryOptions {
  readonly console: DeliveryConsole | null;
  readonly development: boolean;
  /** The page the once-per-code rule applies to. */
  readonly page: object | null;
}

export type DiagnosticListener = (diagnostic: Diagnostic) => void;

export function format(d: Diagnostic): string {
  return `[axylo ${d.code}] ${JSON.stringify(d.chart)}: ${d.message}`;
}

/** Identity of a diagnostic for "is this one new": the same finding found again is not delivered twice. */
export function diagnosticKey(d: Pick<Diagnostic, 'code' | 'field' | 'message'>): string {
  return `${d.code}\u0000${d.field ?? ''}\u0000${d.message}`;
}

export class Delivery {
  private listenerFailed = false;

  constructor(private readonly options: DeliveryOptions) {}

  /** Prints and hands to the listener the diagnostics in `found` that are not in `before`. */
  deliver(found: readonly Diagnostic[], before: readonly Diagnostic[], listener: DiagnosticListener | null): void {
    const known = new Set(before.map(diagnosticKey));
    for (const d of found) {
      if (known.has(diagnosticKey(d))) continue;
      known.add(diagnosticKey(d));
      this.print(d);
      if (listener) this.call(listener, d);
    }
  }

  print(d: Diagnostic): void {
    const out = this.options.console;
    if (!out) return;
    if (d.level === 'hint' && !this.options.development) return;
    const page = this.options.page ?? fallbackPage;
    let codes = printed.get(page);
    if (!codes) printed.set(page, codes = new Set());
    if (codes.has(d.code)) return;
    codes.add(d.code);
    if (d.level === 'hint') out.info(format(d));
    else out.warn(format(d));
  }

  /** An internal failure: the chart shows its internal-error state; this says why. Not a registry code. */
  internal(chart: string, error: unknown): void {
    this.options.console?.error(`[axylo] ${JSON.stringify(chart)}: internal error while drawing the chart.`, error);
  }

  private call(listener: DiagnosticListener, d: Diagnostic): void {
    try {
      listener(d);
    } catch (error) {
      // An author's handler that throws must not break the chart; say so once.
      if (!this.listenerFailed) this.options.console?.error('[axylo] onDiagnostic threw:', error);
      this.listenerFailed = true;
    }
  }
}

/** The diagnostics `strict` throws on: errors and warnings found while validating the call. */
export function strictViolations(inputs: readonly DiagnosticInput[]): DiagnosticInput[] {
  return inputs.filter(d => d.origin === 'call' && (d.level === 'error' || d.level === 'warning'));
}

/** The error a strict chart throws. It carries every diagnostic of the rejected call. */
export class StrictError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(chart: string, diagnostics: readonly Diagnostic[]) {
    const first = diagnostics.find(d => d.level !== 'hint') ?? diagnostics[0];
    super(first
      ? `${format(first)}${diagnostics.length > 1 ? ` (and ${diagnostics.length - 1} more)` : ''}`
      : `[axylo] ${JSON.stringify(chart)}: rejected by strict mode.`);
    this.name = 'AxyloStrictError';
    this.diagnostics = diagnostics;
  }
}
