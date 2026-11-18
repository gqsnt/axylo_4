import { describe, expect, it } from 'vitest';
import { Delivery, StrictError, strictViolations } from '../../src/core/delivery';
import { createDiagnostic } from '../../src/diagnostics';
import type { Diagnostic } from '../../src/public';

function recorder() {
  const lines: { channel: 'warn' | 'info' | 'error'; text: string }[] = [];
  return {
    lines,
    console: {
      warn: (...a: unknown[]) => lines.push({ channel: 'warn', text: String(a[0]) }),
      info: (...a: unknown[]) => lines.push({ channel: 'info', text: String(a[0]) }),
      error: (...a: unknown[]) => lines.push({ channel: 'error', text: String(a[0]) }),
    },
  };
}

const publicOf = (code: Parameters<typeof createDiagnostic>[0], field?: string, chart = 'Chart'): Diagnostic => {
  const { effect: _e, origin: _o, ...d } = createDiagnostic(code, 'none', field === undefined ? {} : { field });
  return { ...d, chart };
};

// Spec 3.5: errors and warnings print once per code per page in every build; hints only in development.
describe('diagnostic delivery (spec 3.5)', () => {
  it('prints an error or warning once per code per page, whatever chart raised it', () => {
    const out = recorder();
    const page = {};
    const a = new Delivery({ console: out.console, development: false, page });
    const b = new Delivery({ console: out.console, development: false, page });
    a.deliver([publicOf('AX103', 'v', 'A')], [], null);
    b.deliver([publicOf('AX103', 'w', 'B')], [], null);
    a.deliver([publicOf('AX101', 'x', 'A')], [], null);
    expect(out.lines.map(l => [l.channel, l.text.slice(0, 13)])).toEqual([['warn', '[axylo AX103]'], ['warn', '[axylo AX101]']]);
    // Another page prints it again.
    new Delivery({ console: out.console, development: false, page: {} }).deliver([publicOf('AX103', 'v')], [], null);
    expect(out.lines).toHaveLength(3);
  });

  it('prints hints only in development builds', () => {
    const prod = recorder();
    new Delivery({ console: prod.console, development: false, page: {} }).deliver([publicOf('AX111', 'day')], [], null);
    expect(prod.lines).toEqual([]);
    const dev = recorder();
    new Delivery({ console: dev.console, development: true, page: {} }).deliver([publicOf('AX111', 'day')], [], null);
    expect(dev.lines.map(l => l.channel)).toEqual(['info']);
  });

  it('names the chart and the code in the printed line', () => {
    const out = recorder();
    new Delivery({ console: out.console, development: true, page: {} }).deliver([publicOf('AX140', undefined, 'Daily sessions')], [], null);
    expect(out.lines[0]!.text).toMatch(/^\[axylo AX140\] "Daily sessions": /);
  });

  it('hands every new diagnostic to onDiagnostic, in production too, and not the same one twice', () => {
    const seen: string[] = [];
    const d = new Delivery({ console: recorder().console, development: false, page: {} });
    const first = [publicOf('AX103', 'v'), publicOf('AX111', 'day')];
    d.deliver(first, [], x => seen.push(x.code));
    d.deliver(first, first, x => seen.push(x.code));
    expect(seen).toEqual(['AX103', 'AX111']);
  });

  it('survives a listener that throws, and says so once', () => {
    const out = recorder();
    const d = new Delivery({ console: out.console, development: false, page: {} });
    const boom = () => { throw new Error('author bug'); };
    d.deliver([publicOf('AX103', 'v')], [], boom);
    d.deliver([publicOf('AX106', 'v')], [], boom);
    expect(out.lines.filter(l => l.channel === 'error')).toHaveLength(1);
  });
});

describe('strict (spec 3.5)', () => {
  it('throws on errors and warnings found while validating the call, never on hints or presentation findings', () => {
    const call = [createDiagnostic('AX103', 'omitted', { field: 'v' }), createDiagnostic('AX111', 'none', { field: 'd' })];
    expect(strictViolations(call).map(d => d.code)).toEqual(['AX103']);
    const later = [createDiagnostic('AX141', 'none', {}, 'presentation'), createDiagnostic('AX160', 'changed', { field: 'v' }, 'presentation')];
    expect(strictViolations(later)).toEqual([]);
  });

  it('carries every diagnostic of the rejected call', () => {
    const list = [publicOf('AX111', 'd'), publicOf('AX103', 'v')];
    const error = new StrictError('Chart', list);
    expect(error.diagnostics).toBe(list);
    expect(error.message).toMatch(/AX103/);
  });
});
