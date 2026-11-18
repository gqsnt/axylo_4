/**
 * The props-to-patch rules of plan 1.7, as pure functions: present, changed, removed, structurally equal,
 * data by identity, and handler-only changes.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { diff, equal, looksSame, optionsOf } from '../src/patch';

const forward = () => {};
const rows = [{ day: '2026-01-01', sessions: 1 }, { day: '2026-01-02', sessions: 2 }];
const patchOf = (a: Record<string, unknown>, b: Record<string, unknown>) => diff(optionsOf(a, forward), optionsOf(b, forward));

describe('optionsOf', () => {
  it('drops the component props and keeps every option', () => {
    const style = { height: 300 };
    const options = optionsOf({ data: rows, x: 'day', y: 'sessions', className: 'card', style, onHover() {}, onSelect() {}, onZoom() {}, strict: true }, forward);
    expect(options).toEqual({ data: rows, x: 'day', y: 'sessions', strict: true });
  });

  it('replaces a given onDiagnostic with the forwarder and leaves an absent one absent', () => {
    expect(optionsOf({ data: rows, onDiagnostic: () => 1 }, forward).onDiagnostic).toBe(forward);
    expect('onDiagnostic' in optionsOf({ data: rows }, forward)).toBe(false);
  });
});

describe('diff', () => {
  it('is null when nothing changed', () => {
    expect(patchOf({ data: rows, x: 'day', y: 'sessions' }, { data: rows, x: 'day', y: 'sessions' })).toBeNull();
  });

  it('sends a newly present prop', () => {
    expect(patchOf({ data: rows }, { data: rows, title: 'Sessions' })).toEqual({ title: 'Sessions' });
  });

  it('sends a changed prop and only that prop', () => {
    expect(patchOf({ data: rows, title: 'A', legend: 'top' }, { data: rows, title: 'B', legend: 'top' })).toEqual({ title: 'B' });
  });

  it('sends a removed prop as undefined, with the key present', () => {
    const patch = patchOf({ data: rows, title: 'A', tooltip: false }, { data: rows });
    expect(patch).toEqual({ title: undefined, tooltip: undefined });
    expect(Object.keys(patch!).sort()).toEqual(['title', 'tooltip']);
  });

  it('treats an explicit undefined like an absent prop', () => {
    expect(patchOf({ data: rows, title: undefined }, { data: rows })).toBeNull();
    expect(patchOf({ data: rows }, { data: rows, title: undefined })).toBeNull();
  });

  it('compares field specs and other object options structurally', () => {
    const make = () => ({
      data: rows,
      x: { field: 'day', type: 'date', domain: [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 9))] },
      y: ['sessions', { field: 'visits', label: 'Visits', tickFormat: { notation: 'compact' } }],
      title: { text: 'T', level: 3 },
      reference: [{ y: 10, label: 'Target' }],
      colors: { Direct: 'red' },
      messages: { noData: 'Nothing' },
      state: { empty: 'None yet' },
    });
    expect(patchOf(make(), make())).toBeNull();
  });

  it('sees a change deep inside a field spec and sends the whole new value', () => {
    const next = { field: 'visits', label: 'Visitors' };
    expect(patchOf({ data: rows, y: { field: 'visits', label: 'Visits' } }, { data: rows, y: next })).toEqual({ y: next });
    expect(patchOf({ data: rows, colors: { A: 'red' } }, { data: rows, colors: { A: 'red', B: 'blue' } })).toEqual({ colors: { A: 'red', B: 'blue' } });
  });

  it('compares data by identity only', () => {
    const copy = rows.map(r => ({ ...r }));
    expect(patchOf({ data: rows }, { data: copy })).toEqual({ data: copy });
    expect(patchOf({ data: rows }, { data: rows })).toBeNull();
  });

  it('ignores handler-only changes', () => {
    const a = { data: rows, onHover() {}, onSelect() {}, onZoom() {}, onDiagnostic() {} };
    const b = { data: rows, onHover() {}, onSelect() {}, onZoom() {}, onDiagnostic() {} };
    expect(patchOf(a, b)).toBeNull();
  });

  it('sends onDiagnostic when it appears or disappears', () => {
    expect(patchOf({ data: rows }, { data: rows, onDiagnostic() {} })).toEqual({ onDiagnostic: forward });
    expect(patchOf({ data: rows, onDiagnostic() {} }, { data: rows })).toEqual({ onDiagnostic: undefined });
  });

  it('compares a function inside a field spec by identity', () => {
    const format = (v: number) => `${v}`;
    expect(patchOf({ data: rows, y: { field: 'v', format } }, { data: rows, y: { field: 'v', format } })).toBeNull();
    expect(patchOf({ data: rows, y: { field: 'v', format } }, { data: rows, y: { field: 'v', format: (v: number) => `${v}` } })).not.toBeNull();
  });

  it('for any options, the patch applied to the old options gives the new ones (property)', () => {
    const value = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(undefined), fc.array(fc.integer(), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 3 }), fc.integer(), { maxKeys: 3 }));
    const options = fc.dictionary(fc.constantFrom('title', 'x', 'y', 'legend', 'colors', 'reference', 'locale'), value);
    fc.assert(fc.property(options, options, (a, b) => {
      const patch = diff(a, b) ?? {};
      const applied: Record<string, unknown> = { ...a };
      for (const [k, v] of Object.entries(patch)) applied[k] = v;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) expect(equal(applied[k], b[k])).toBe(true);
      expect(diff(b, b)).toBeNull();
    }));
  });
});

describe('equal', () => {
  it('does not treat arrays, dates and plain objects as interchangeable', () => {
    expect(equal([1], { 0: 1 })).toBe(false);
    expect(equal(new Date(0), {})).toBe(false);
    expect(equal(new Date(0), new Date(0))).toBe(true);
    expect(equal({ a: undefined }, { b: undefined })).toBe(false);
    expect(equal(new Map(), new Map())).toBe(false);
  });
});

describe('looksSame', () => {
  it('matches rebuilt rows and rewrapped columns, and nothing else', () => {
    expect(looksSame(rows, rows.map(r => ({ ...r })))).toBe(true);
    expect(looksSame(rows, [...rows, { day: '2026-01-03', sessions: 3 }])).toBe(false);
    expect(looksSame(rows, [rows[0], { day: '2026-01-02', sessions: 9 }])).toBe(false);
    const t = new Float64Array(3);
    expect(looksSame({ columns: { t } }, { columns: { t } })).toBe(true);
    expect(looksSame({ columns: { t } }, { columns: { t: new Float64Array(3) } })).toBe(false);
  });
});
