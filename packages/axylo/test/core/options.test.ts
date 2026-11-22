import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyPatch, OptionsStore, sameValue } from '../../src/core/options';

// Plan 1.5, "Patches": a key present replaces the old value whole; a key set to undefined returns to its
// default; absent keys stay. No deep merging.
describe('option patches (plan 1.5)', () => {
  it('replaces a present key whole, without merging nested objects', () => {
    const store = new OptionsStore({ title: { text: 'A', level: 2 }, x: 'day' });
    const { next } = store.preview({ title: { text: 'B' } });
    expect(next.title).toEqual({ text: 'B' });
    expect(next.x).toBe('day');
  });

  it('removes a key set to undefined, so resolution supplies its default', () => {
    const store = new OptionsStore({ title: 'A', legend: 'top' });
    const { next, changed } = store.preview({ legend: undefined });
    expect(Object.hasOwn(next, 'legend')).toBe(false);
    expect(changed.has('legend')).toBe(true);
    expect(next.title).toBe('A');
  });

  it('leaves absent keys alone and reports only what changed', () => {
    const data = [{ a: 1 }];
    const store = new OptionsStore({ data, title: 'A' });
    const { next, changed } = store.preview({ title: 'A' });
    expect(next.data).toBe(data);
    expect([...changed]).toEqual([]);
  });

  it('does not change the store until commit (a rejected call keeps the last valid state)', () => {
    const store = new OptionsStore({ title: 'A' });
    const { next } = store.preview({ title: 'B' });
    expect(store.current.title).toBe('A');
    store.commit(next);
    expect(store.current.title).toBe('B');
  });

  it('for any patch: present keys equal the patch, undefined keys are gone, absent keys keep their value', () => {
    const key = fc.constantFrom('a', 'b', 'c', 'd', 'e');
    const value = fc.oneof(fc.integer(), fc.string(), fc.constant(undefined), fc.record({ n: fc.integer() }));
    fc.assert(fc.property(fc.dictionary(key, value), fc.dictionary(key, value), (initial, patch) => {
      const before = applyPatch({}, initial).next;
      const { next } = applyPatch(before, patch);
      for (const k of ['a', 'b', 'c', 'd', 'e']) {
        if (Object.hasOwn(patch, k)) {
          if (patch[k] === undefined) expect(Object.hasOwn(next, k)).toBe(false);
          // The value as given at the call: equal content, and a copy for plain objects, so a later edit of
          // the caller's object is not the chart's state (review 3, finding 12).
          else {
            expect(next[k]).toEqual(patch[k]);
            if (patch[k] !== null && typeof patch[k] === 'object') expect(next[k]).not.toBe(patch[k]);
          }
        } else if (Object.hasOwn(before, k)) {
          expect(next[k]).toBe(before[k]);
        } else {
          expect(Object.hasOwn(next, k)).toBe(false);
        }
      }
    }), { numRuns: 1000 });
  });
});

describe('structural comparison of field specs', () => {
  it('treats equal inline field objects as the same encoding', () => {
    expect(sameValue({ field: 'ts', type: 'time' }, { field: 'ts', type: 'time' })).toBe(true);
    expect(sameValue({ field: 'ts', domain: [1, 2] }, { field: 'ts', domain: [1, 3] })).toBe(false);
    expect(sameValue(['a', { field: 'b' }], ['a', { field: 'b' }])).toBe(true);
  });

  it('compares functions by identity', () => {
    const f = (v: number) => String(v);
    expect(sameValue({ field: 'y', format: f }, { field: 'y', format: f })).toBe(true);
    expect(sameValue({ field: 'y', format: f }, { field: 'y', format: (v: number) => String(v) })).toBe(false);
  });
});
