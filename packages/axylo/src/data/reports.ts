import type { DiagnosticEffect, DiagnosticSink } from '../core/contracts';
import { report, type DiagnosticCode } from '../diagnostics';
import type { DiagnosticTrace } from './store-diagnostics';

export class Reports {
  private readonly entries = new Map<DiagnosticCode, {
    effect: DiagnosticEffect;
    count: number;
    rows: number[];
    examples: string[];
    detail?: string;
  }>();

  constructor(private readonly field: string, private readonly sink?: DiagnosticTrace) {}

  add(code: DiagnosticCode, effect: DiagnosticEffect, row: number, example?: unknown, detail?: string): void {
    let entry = this.entries.get(code);
    if (!entry) {
      entry = { effect, count: 0, rows: [], examples: [], detail };
      this.entries.set(code, entry);
    }
    this.sink?.traceRow?.(code, this.field, effect, row);
    entry.count++;
    if (entry.rows.length < 10) {
      entry.rows.push(row);
      if (example !== undefined) {
        const text = typeof example === 'string' ? JSON.stringify(example)
          : example !== null && typeof example === 'object' ? Object.prototype.toString.call(example) : String(example);
        entry.examples.push(text);
      }
    }
  }

  flush(sink: DiagnosticSink): void {
    for (const [code, { effect, count, rows, examples, detail }] of this.entries) {
      report(sink, code, effect, { field: this.field, count, rows, examples, detail });
    }
  }
}
