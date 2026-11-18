/**
 * scripts/size.mjs --check compares integer bytes against the target in KiB × 1024 (review finding 3): one
 * byte over a target is over, whatever the rounded KiB figure shows.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error scripts/size.mjs is plain JavaScript without declarations
import { exceeds as untyped } from '../../scripts/size.mjs';

const exceeds = untyped as (totalBytes: number, targetKiB: number | null) => boolean;

describe('size target comparison', () => {
  it.each([
    [40 * 1024, 40, false],
    [40 * 1024 + 1, 40, true], // 40.001 KiB: rounds to 40.00
    [25 * 1024 + 4, 25, true],
    [2048, 2, false],
    [2049, 2, true],
    [10 ** 9, null, false], // a row without a target never fails the check
  ])('%i bytes against %s KiB: over = %s', (bytes, target, over) => {
    expect(exceeds(bytes, target)).toBe(over);
  });
});
