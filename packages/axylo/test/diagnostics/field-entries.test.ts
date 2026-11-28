import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AX140, AX150, AX160, createDiagnostic, diagnosticContext, diagnosticRegistry, fieldDiagnostic, report,
} from '../../src/diagnostics/registry';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { validateTreemap } from '../../src/hierarchy';

// axylo/hierarchy names the entries it reports (AX140, AX150, AX160) so its bundle carries only them. These
// tests hold that route to the table's: the same descriptor and the same diagnostic, context included.
describe('entries named one by one (AX140, AX150, AX160)', () => {
  it('are the descriptors of the table, with the levels of section 3.5', () => {
    expect(diagnosticRegistry.AX140).toBe(AX140);
    expect(diagnosticRegistry.AX150).toBe(AX150);
    expect(diagnosticRegistry.AX160).toBe(AX160);
    expect([AX140.level, AX150.level, AX160.level]).toEqual(['warning', 'warning', 'warning']);
  });

  it('AX140, AX150 and AX160 from fieldDiagnostic equal createDiagnostic for any field, effect and origin', () => {
    const entries = { AX140, AX150, AX160 } as const;
    fc.assert(fc.property(
      fc.constantFrom('AX140', 'AX150', 'AX160'),
      fc.option(fc.string(), { nil: undefined }),
      fc.constantFrom('none', 'changed', 'omitted'),
      fc.constantFrom('call', 'presentation'),
      (code: keyof typeof entries, field, effect: 'none' | 'changed' | 'omitted', origin: 'call' | 'presentation') => {
        const named = fieldDiagnostic(code, entries[code], effect, field, origin);
        const table = createDiagnostic(code, effect, field === undefined ? {} : { field }, origin);
        expect(named).toEqual(table);
        expect(Object.keys(named)).toEqual(Object.keys(table));
        expect(diagnosticContext(named)).toEqual(diagnosticContext(table));
      },
    ));
  });

  it('AX150 keeps its default origin and merges in a collector as one from the table does', () => {
    const named = fieldDiagnostic('AX150', AX150, 'none', 'colour');
    expect(named.origin).toBe('call');
    const a = new DiagnosticCollector();
    const b = new DiagnosticCollector();
    a.add(named); a.add(fieldDiagnostic('AX150', AX150, 'none', 'colour'));
    b.add(createDiagnostic('AX150', 'none', { field: 'colour' })); b.add(createDiagnostic('AX150', 'none', { field: 'colour' }));
    expect(a.inputs()).toEqual(b.inputs());
    expect(a.inputs()[0]?.count).toBe(2);
  });

  it('AX140 and AX150 from validateTreemap read as the table writes them', () => {
    const found = validateTreemap({ data: [{ label: 'a', value: 1 }], colour: 'red' } as never);
    expect(found.map(d => d.code)).toEqual(['AX150', 'AX140']);
    const chart = found[0]!.chart;
    const strip = ({ effect: _e, origin: _o, ...d }: ReturnType<typeof createDiagnostic>) => ({ ...d, chart });
    expect(found).toEqual([
      strip(createDiagnostic('AX150', 'none', { field: 'colour' })),
      strip(createDiagnostic('AX140', 'none')),
    ]);
  });
});

// Callers may replace a descriptor's parts (the table is plain mutable data at runtime). report must read them
// as the baseline did: level, then outcome, then text called on the entry, then details.outcome after text ran.
describe('report with a replaced descriptor', () => {
  it('reads level, outcome and text in order, calls text on the entry and honours an outcome text sets', () => {
    const entry = diagnosticRegistry.AX104 as unknown as Record<string, unknown>;
    const saved = Object.getOwnPropertyDescriptors(entry);
    const reads: string[] = [];
    let receiver: unknown;
    let fallbackCalls = 0;
    try {
      Object.defineProperty(entry, 'level', { configurable: true, get: () => { reads.push('level'); return 'hint'; } });
      Object.defineProperty(entry, 'outcome', { configurable: true, get: () => {
        reads.push('outcome');
        return () => { fallbackCalls += 1; return 'Fallback.'; };
      } });
      Object.defineProperty(entry, 'text', { configurable: true, get: () => {
        reads.push('text');
        return function (this: unknown, d: { outcome?: string }) { receiver = this; d.outcome = 'Set by text.'; return 'Text.'; };
      } });
      const found: ReturnType<typeof createDiagnostic>[] = [];
      report({ add: d => { found.push(d); } }, 'AX104', 'none', { field: 'x' });
      expect(reads).toEqual(['level', 'outcome', 'text']);
      expect(receiver).toBe(entry);
      expect(fallbackCalls).toBe(0);
      expect(found[0]?.message).toBe('Text. Set by text.');
      expect(found[0]?.level).toBe('hint');

      reads.length = 0;
      Object.defineProperty(entry, 'text', { configurable: true, get: () => { reads.push('text'); return () => 'Text.'; } });
      found.length = 0;
      report({ add: d => { found.push(d); } }, 'AX104', 'none', { field: 'x' });
      expect(found[0]?.message).toBe('Text. Fallback.');
      expect(fallbackCalls).toBe(1);
    } finally {
      for (const key of Object.keys(entry)) delete entry[key];
      Object.defineProperties(entry, saved);
    }
    expect(Object.keys(diagnosticRegistry.AX104)).toEqual(['level', 'text', 'outcome']);
  });
});
