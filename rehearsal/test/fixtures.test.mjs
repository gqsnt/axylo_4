import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readJson, taskFiles } from '../files.mjs';
import { compareRows } from '../table.mjs';

const specs = [
  ['daily-visits', [2026, 3, 1, 30], ['visits'], [6, 12, 26]],
  ['signups', [2026, 4, 6, 7], ['signpus'], []],
  ['daily-revenue', [2026, 5, 1, 8], ['revenue'], [4]],
  ['regional-sales', null, ['north', 'central', 'west'], []],
];

describe('fixture expectations', () => {
  it.each(specs)('%s follows the calendar or categories and preserves the source values', async (task, period, keys, missing) => {
    const files = taskFiles(task);
    const [data, expected] = await Promise.all([readJson(files.fixture), readJson(files.expected)]);
    if (!period) {
      expect(data.every(row => keys.every(key => typeof row[key] === 'string'))).toBe(true);
      const rows = data.map(row => [row.quarter, ...keys.map(key => Number(row[key]))]);
      expect(expected.rows).toEqual(rows);
      return;
    }

    const [year, month, start, count] = period;
    const days = Array.from({ length: count }, (_, index) =>
      new Date(Date.UTC(year, month - 1, start + index)).toISOString().split('T')[0]);
    const observations = new Map(data.map(row => [row.day.split('T')[0], row]));
    expect(observations.size).toBe(data.length);
    expect(data.length).toBe(days.length - missing.length);
    expect(days.filter(day => !observations.has(day)).map(day => Number(day.slice(-2)))).toEqual(missing);
    expect(expected.rows).toEqual(days.map(day => {
      const row = observations.get(day);
      return [day, ...keys.map(key => row ? Number(row[key]) : null)];
    }));
    if (missing.length) {
      expect(data.map(row => row.day)).not.toEqual(data.map(row => row.day).sort());
      expect(data.every(row => row.day.endsWith('T00:00:00Z'))).toBe(true);
    }
  });

  it('accepts formatted numbers and omitted gaps, and rejects a zero substituted for any gap', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: -1000000, max: 1000000 }), { minLength: 1, maxLength: 12 }), values => {
      const expected = {
        x: 'category', series: ['sales'],
        rows: [['Missing', null], ...values.map((value, i) => [String(i), value])],
      };
      const headers = ['Quarter', 'Sales'];
      const format = new Intl.NumberFormat('en-US');
      const displayed = values.map((value, i) => [String(i), format.format(value)]);
      expect(compareRows(expected, headers, displayed).pass).toBe(true);
      expect(compareRows(expected, headers, [['Missing', 'No data'], ...displayed]).pass).toBe(true);
      expect(compareRows(expected, headers, [['Missing', '0'], ...displayed]).pass).toBe(false);
    }));
  });

  it('compares the printed day without moving an instant back to UTC', () => {
    const expected = { x: 'date', series: ['sales'], rows: [['2026-03-01', 1250.5]] };
    const headers = ['Day', 'Sales'];
    expect(compareRows(expected, headers, [['Mar 1, 2026, 9:00 AM GMT+9', '1,250.50']]).pass).toBe(true);
    expect(compareRows(expected, headers, [['Feb 28, 2026, 4:00 PM PST', '1,250.5']])).toEqual({
      pass: false, detail: 'Row 1 expected ["2026-03-01",1250.5], saw ["Feb 28, 2026, 4:00 PM PST","1,250.5"].',
    });
  });
});
