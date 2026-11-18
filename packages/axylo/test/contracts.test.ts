import { describe, expect, it } from 'vitest';
import { SLOT_GAP, SLOT_INVALID, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE } from '../src/core/contracts';

describe('contracts', () => {
  it('slot states are distinct small integers that fit a Uint8Array', () => {
    const all = [SLOT_VALUE, SLOT_NULL, SLOT_INVALID, SLOT_NO_ROW, SLOT_GAP];
    expect(new Set(all).size).toBe(5);
    expect(all.every(v => Number.isInteger(v) && v >= 0 && v < 256)).toBe(true);
  });
});
