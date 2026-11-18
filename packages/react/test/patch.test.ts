/**
 * The props-to-patch rules of plan 1.7, as pure functions: present, changed, removed, structurally equal,
 * data by identity, and handler-only changes.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { diff, equal, fieldsOf, looksSame, optionsOf } from '../src/patch';

const forward = () => {};
const rows = [{ day: '2026-01-01', sessions: 1 }, { day: '2026-01-02', sessions: 2 }];
const patchOf = (a: Record<string, unknown>, b: Record<string, unknown>) => diff(optionsOf(a, forward), optionsOf(b, forward));

describe('optionsOf', () => {
  it('routes id, className, style and data-* to the container, and keeps aria-* for core validation', () => {
    const options = optionsOf({ data: rows, id: 'sessions', className: 'c', style: {}, 'data-testid': 't', 'data-x': 1, 'aria-label': 'L', title: 'T' }, forward);
    expect(options).toEqual({ data: rows, 'aria-label': 'L', title: 'T' });
  });

  it('copies own props only', () => {
    const props = Object.assign(Object.create({ inherited: 1 }) as Record<string, unknown>, { data: rows });
    expect(Object.keys(optionsOf(props, forward))).toEqual(['data']);
  });

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

  // Plan 1.5: a key present and set to undefined returns to its default, so the transition between absent
  // and present-undefined is sent (the chart may hold a value set through the ref in the meantime).
  it('sends the transition between an absent prop and an explicit undefined, as an own key', () => {
    const on = patchOf({ data: rows }, { data: rows, title: undefined });
    expect(on).toEqual({ title: undefined });
    expect(Object.hasOwn(on!, 'title')).toBe(true);
    const off = patchOf({ data: rows, title: undefined }, { data: rows });
    expect(off).toEqual({ title: undefined });
    expect(Object.hasOwn(off!, 'title')).toBe(true);
    expect(patchOf({ data: rows, title: undefined }, { data: rows, title: undefined })).toBeNull();
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

  it('for any options, the patch holds exactly the keys whose presence or value changed (property)', () => {
    // An oracle independent of `equal`: a canonical string that tells holes, undefined and absence apart.
    const canon = (v: unknown): string => {
      if (Array.isArray(v)) return `[${Array.from({ length: v.length }, (_, i) => i in v ? canon(v[i]) : '<hole>').join(',')}]`;
      if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
      return `${typeof v}:${String(v)}`;
    };
    const key = fc.constantFrom('a', 'b', 'c');
    const leaf = fc.oneof(fc.string({ maxLength: 2 }), fc.integer({ min: -2, max: 2 }), fc.boolean(), fc.constant(undefined));
    const value = fc.oneof(leaf, fc.array(leaf, { maxLength: 3 }), fc.sparseArray(leaf, { maxLength: 3 }), fc.dictionary(key, leaf, { maxKeys: 3 }));
    const options = fc.dictionary(fc.constantFrom('title', 'x', 'y', 'legend', 'colors', 'reference', 'locale'), value);
    fc.assert(fc.property(options, options, (a, b) => {
      const patch = diff(a, b);
      const expected = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter(k => Object.hasOwn(a, k) !== Object.hasOwn(b, k) || canon(a[k]) !== canon(b[k])).sort();
      expect(Object.keys(patch ?? {}).sort()).toEqual(expected);
      for (const k of expected) expect(Object.is(patch![k], b[k])).toBe(true);
      // Symmetric: what changed from a to b changed from b to a.
      expect(Object.keys(diff(b, a) ?? {}).sort()).toEqual(expected);
      expect(diff(b, b)).toBeNull();
    }));
  });

  it('sees a hole filled or opened in an option array, in both directions', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(diff({ y: Array(1) }, { y: ['v'] })).toEqual({ y: ['v'] });
    expect(diff({ y: ['v'] }, { y: Array(1) })).not.toBeNull();
    expect(diff({ y: [undefined] }, { y: Array(1) })).not.toBeNull();
    expect(diff({ reference: [{ y: 1, label: 'a' }, , { y: 3, label: 'c' }] }, { reference: [{ y: 1, label: 'a' }, { y: 2, label: 'b' }, { y: 3, label: 'c' }] })).not.toBeNull();
  });

  it('never throws, and treats values it does not understand by identity', () => {
    type Cyclic = { field: string; meta?: unknown };
    const a: Cyclic = { field: 'v' };
    a.meta = a;
    const b: Cyclic = { field: 'v' };
    b.meta = b;
    expect(() => diff({ y: a }, { y: b })).not.toThrow();
    const c: Cyclic = { field: 'w' };
    c.meta = c;
    expect(diff({ y: a }, { y: c })).toEqual({ y: c });
    // Mutually recursive pairs, and a getter that throws.
    const p: Record<string, unknown> = {};
    const q: Record<string, unknown> = { p };
    p.q = q;
    const p2: Record<string, unknown> = {};
    const q2: Record<string, unknown> = { p: p2 };
    p2.q = q2;
    expect(() => diff({ x: p }, { x: p2 })).not.toThrow();
    const throwing = { get field(): string { throw new Error('getter'); } };
    expect(() => diff({ x: { field: 'v' } }, { x: throwing })).not.toThrow();
    expect(diff({ x: { field: 'v' } }, { x: throwing })).toEqual({ x: throwing });
    // React elements (a mistake, but one that must not take the chart down) are opaque.
    const element = (props: unknown) => ({ $$typeof: Symbol.for('react.transitional.element'), type: 'b', key: null, props });
    const cyclicProps: Record<string, unknown> = {};
    cyclicProps.self = cyclicProps;
    const e1 = element(cyclicProps);
    const e2 = element(cyclicProps);
    expect(() => diff({ title: e1 }, { title: e2 })).not.toThrow();
    expect(diff({ title: e1 }, { title: e2 })).toEqual({ title: e2 });
    expect(diff({ title: e1 }, { title: e1 })).toBeNull();
    // Class instances and other non-plain objects by identity.
    class Spec { field = 'v'; }
    expect(diff({ y: new Spec() }, { y: new Spec() })).not.toBeNull();
  });

  // Review C4: once a cycle is found it is compared by identity, so distinct cyclic graphs are a change.
  it('treats a cycle as opaque: a one-object cycle and a two-object cycle differ', () => {
    const one: Record<string, unknown> = { field: 'v' };
    one.next = one;
    const first: Record<string, unknown> = { field: 'v' };
    const second: Record<string, unknown> = { field: 'v', next: first };
    first.next = second;
    expect(equal(one, first)).toBe(false);
    expect(diff({ y: one }, { y: first })).toEqual({ y: first });
    const again: Record<string, unknown> = { field: 'v' };
    again.next = again;
    expect(equal(one, again)).toBe(false);
    expect(equal(one, one)).toBe(true);
    // A value shared twice without a cycle is still compared structurally.
    const shared = { label: 'L' };
    expect(equal({ a: shared, b: shared }, { a: { label: 'L' }, b: { label: 'L' } })).toBe(true);
  });

  it('counts only own array indices', () => {
    const proto = Object.assign(Object.create(Array.prototype) as unknown[], { 0: 'v' });
    // eslint-disable-next-line no-sparse-arrays
    const inherited = Object.setPrototypeOf([, 1], proto) as unknown[];
    expect(inherited[0]).toBe('v');
    expect(equal(inherited, ['v', 1])).toBe(false);
    expect(diff({ y: ['v', 1] }, { y: inherited })).not.toBeNull();
  });

  it('keeps an own __proto__ key as an option and in the patch, so the core can report it', () => {
    const props = JSON.parse('{"data": [], "__proto__": { "polluted": true }}') as Record<string, unknown>;
    const options = optionsOf(props, forward);
    expect(Object.hasOwn(options, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
    expect((options as { polluted?: unknown }).polluted).toBeUndefined();
    const patch = diff({ data: props.data }, options);
    expect(patch && Object.hasOwn(patch, '__proto__')).toBe(true);
    expect(patch && Object.getPrototypeOf(patch)).toBe(Object.prototype);
    const removed = diff(options, { data: props.data });
    expect(removed && Object.hasOwn(removed, '__proto__') && removed.__proto__ === undefined).toBe(true);
  });

  it('compares own properties, enumerable or not, and never reads inherited ones', () => {
    const hidden = (field: string) => Object.defineProperty({}, 'field', { value: field, enumerable: false });
    expect(diff({ x: hidden('a') }, { x: hidden('b') })).not.toBeNull();
    expect(diff({ x: hidden('a') }, { x: hidden('a') })).toBeNull();
    const removed = diff({ toString: 'mine' }, {});
    expect(removed).toEqual({ toString: undefined });
    expect(Object.hasOwn(removed!, 'toString') && removed!.toString === undefined).toBe(true);
    expect(diff({}, {})).toBeNull();
    expect(diff({ constructor: 1 }, { constructor: 1 })).toBeNull();
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
  const named = ['day', 'sessions'];
  it('matches rebuilt rows and rewrapped columns, and nothing else', () => {
    expect(looksSame(rows, rows.map(r => ({ ...r })), named)).toBe(true);
    expect(looksSame(rows, [...rows, { day: '2026-01-03', sessions: 3 }], named)).toBe(false);
    expect(looksSame(rows, [rows[0], { day: '2026-01-02', sessions: 9 }], named)).toBe(false);
    const t = new Float64Array(3);
    expect(looksSame({ columns: { t } }, { columns: { t } }, ['t'])).toBe(true);
    expect(looksSame({ columns: { t } }, { columns: { t: new Float64Array([1, 0, 0]) } }, ['t'])).toBe(false);
  });

  it('is a sample of the endpoints: dates rebuilt in endpoint rows and fresh equal columns match', () => {
    const at = (d: number) => ({ t: new Date(Date.UTC(2026, 0, d)), v: d });
    expect(looksSame([at(1), at(2)], [at(1), at(2)], ['t', 'v'])).toBe(true);
    expect(looksSame({ columns: { t: new Float64Array([1, 2, 3]) } }, { columns: { t: new Float64Array([1, 2, 3]) } }, ['t'])).toBe(true);
    // Only the endpoints are sampled: a changed middle row still matches. The hint says so.
    expect(looksSame([at(1), at(2), at(3)], [at(1), { t: at(2).t, v: 99 }, at(3)], ['t', 'v'])).toBe(true);
  });

  // Review C5: the sample reads only what the chart plots, and a value it cannot read skips the hint.
  it('samples only the named fields, and an unreadable sample is "not the same", never a throw', () => {
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([4, 5, 6]);
    const unreadable = () => ({ length: 3, get 0(): number { throw new Error('getter'); }, 1: 0, get 2(): number { throw new Error('getter'); } });
    const a = { columns: { x, y, extra: unreadable() } };
    const b = { columns: { x, y, extra: unreadable() } };
    expect(looksSame(a, b, ['x', 'y'])).toBe(true);
    expect(() => looksSame(a, b, ['x', 'y', 'extra'])).not.toThrow();
    expect(looksSame(a, b, ['x', 'y', 'extra'])).toBe(false);
    const row = () => ({ day: 'd', get sessions(): number { throw new Error('getter'); } });
    expect(looksSame([row()], [row()], ['day'])).toBe(true);
    expect(looksSame([row()], [row()], ['day', 'sessions'])).toBe(false);
  });
});

describe('fieldsOf', () => {
  it('names the fields the options plot, in every form a field takes', () => {
    expect(fieldsOf({ x: 'day', y: 'sessions', series: 'channel' }).sort()).toEqual(['channel', 'day', 'sessions']);
    expect(fieldsOf({ x: { field: 't', type: 'time' }, y: ['a', { field: 'b', label: 'B' }] }).sort()).toEqual(['a', 'b', 't']);
    expect(fieldsOf({ label: 'channel', value: { field: 'n', parse: 'number' } }).sort()).toEqual(['channel', 'n']);
    expect(fieldsOf({ title: 'x', colors: { a: 'b' } })).toEqual([]);
  });
});
