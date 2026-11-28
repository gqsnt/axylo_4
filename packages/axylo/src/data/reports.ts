import type { DiagnosticEffect, DiagnosticSink } from '../core/contracts';
import { report, type DiagnosticCode } from '../diagnostics';
import type { DiagnosticTrace } from './diagnostic-history';

export class Reports {
  #entries?: Map<DiagnosticCode, {
    effect: DiagnosticEffect;
    count: number;
    rows: number[];
    examples: string[];
    detail?: string;
    outcome?: string;
    series: Set<string>;
  }>;

  constructor(private readonly field: string, private readonly sink?: DiagnosticTrace) {}

  add(code: DiagnosticCode, effect: DiagnosticEffect, row: number, example?: unknown, detail?: string, options?: {
    amount?: number; series?: string; position?: string; outcome?: string;
  }): void {
    const entries = this.#entries ??= new Map();
    let entry = entries.get(code);
    if (!entry) {
      entry = { effect, count: 0, rows: [], examples: [], detail, outcome: options?.outcome, series: new Set() };
      entries.set(code, entry);
    }
    const amount = options?.amount ?? 1;
    const text = options?.position ?? (example === undefined ? undefined : typeof example === 'string' ? JSON.stringify(example)
      : example !== null && typeof example === 'object' ? Object.prototype.toString.call(example) : String(example));
    this.sink?.traceRow?.(code, this.field, effect, row, amount, text, options?.series);
    entry.count += amount;
    if (entry.rows.length < 10 && !entry.rows.includes(row)) entry.rows.push(row);
    if (text !== undefined && entry.examples.length < 10 && !entry.examples.includes(text)) entry.examples.push(text);
    if (options?.series !== undefined && entry.series.size < 10) entry.series.add(options.series);
  }

  flush(sink: DiagnosticSink): void {
    if (!this.#entries) return;
    for (const [code, { effect, count, rows, examples, detail, outcome, series }] of this.#entries) {
      report(sink, code, effect, { field: this.field, count, rows, examples, detail, outcome, series: [...series] });
    }
  }
}
