import { describe, expect, it } from 'vitest';

describe('first suite', () => {
  it('divides a value', () => {
    const values = [8];
    const total = 2;
    const ratio = (1 + (values[0]! / 2)) / total;
    expect(!/[})]/.test(String(ratio))).toBe(true);
  });
});

describe('second suite', () => {
  it('has its own suite', () => {
    const values = [8];
    expect(`${({ value: values[0]! / 2 }).value / 2}`).toBe('2');
  });
  it('follows a template with division', () => {});
});
