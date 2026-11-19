import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readJson, taskFiles } from '../files.mjs';
import { calendarDate, compareHeaders, compareRows } from '../table.mjs';

const specs = [
  ['daily-visits', [2026, 3, 1, 30], ['visits'], [6, 12, 26]],
  ['signups', [2026, 4, 6, 7], ['signpus'], []],
  ['daily-revenue', [2026, 5, 1, 8], ['revenue'], [4]],
  ['regional-sales', null, ['north', 'central', 'west'], []],
];

function quarterOrdinal(label) {
  const [, year, quarter] = /^(\d{4}) Q([1-4])$/.exec(label);
  return Number(year) * 4 + Number(quarter);
}

describe('fixture expectations', () => {
  it.each(specs)('%s follows the calendar or quarters and preserves the source values in both inputs', async (task, period, keys, missing) => {
    const files = taskFiles(task);
    const [primary, expected, alternate, alternateExpected] = await Promise.all(
      [files.fixture, files.expected, files.alternate, files.alternateExpected].map(readJson));
    expect(alternateExpected.series).toEqual(expected.series);
    expect(alternateExpected.rows.map(row => row[0])).toEqual(expected.rows.map(row => row[0]));
    for (const [i, [day, ...values]] of expected.rows.entries()) {
      expect(alternateExpected.rows[i][0]).toBe(day);
      for (const [j, value] of values.entries()) {
        if (value !== null) expect(alternateExpected.rows[i][j + 1]).not.toBe(value);
      }
    }
    for (const [data, answer] of [[primary, expected], [alternate, alternateExpected]]) {
      if (!period) {
        expect(data.every(row => keys.every(key => typeof row[key] === 'string'))).toBe(true);
        const quarters = data.toSorted((a, b) => quarterOrdinal(a.quarter) - quarterOrdinal(b.quarter));
        expect(quarters.map(row => row.quarter)).not.toEqual(data.map(row => row.quarter));
        expect(answer.rows).toEqual(quarters.map(row => [row.quarter, ...keys.map(key => Number(row[key]))]));
        continue;
      }

      const [year, month, start, count] = period;
      const days = Array.from({ length: count }, (_, index) =>
        new Date(Date.UTC(year, month - 1, start + index)).toISOString().split('T')[0]);
      const observations = new Map(data.map(row => [row.day.split('T')[0], row]));
      expect(observations.size).toBe(data.length);
      expect(data.length).toBe(days.length - missing.length);
      expect(days.filter(day => !observations.has(day)).map(day => Number(day.slice(-2)))).toEqual(missing);
      const omitted = data.flatMap(row => keys.filter(key => !Object.hasOwn(row, key)));
      expect(omitted).toHaveLength(task === 'signups' && data === alternate ? 1 : 0);
      expect(answer.valuesNotShown ?? 0).toBe(omitted.length);
      expect(answer.rows).toEqual(days.map(day => {
        const row = observations.get(day);
        return [day, ...keys.map(key => row && Object.hasOwn(row, key) ? Number(row[key]) : null)];
      }));
      if (missing.length) {
        expect(data.map(row => row.day)).not.toEqual(data.map(row => row.day).sort());
        expect(data.every(row => row.day.endsWith('T00:00:00Z'))).toBe(true);
      }
    }
  });

  it('accepts formatted numbers and omitted gaps, and rejects a zero substituted for any gap', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: -1000000, max: 1000000 }), { minLength: 1, maxLength: 12 }), values => {
      const expected = {
        x: 'category', series: [{ label: 'Sales' }],
        rows: [['Missing', null], ...values.map((value, i) => [String(i), value])],
      };
      const format = new Intl.NumberFormat('en-US');
      const displayed = values.map((value, i) => [String(i), format.format(value)]);
      expect(compareRows(expected, displayed).pass).toBe(true);
      expect(compareRows(expected, [['Missing', 'No data'], ...displayed]).pass).toBe(true);
      expect(compareRows(expected, [['Missing', '0'], ...displayed]).pass).toBe(false);
    }), { numRuns: 1000 });
  });

  it.each(['Apr 6, 2026', 'April 6 2026', '06 April 2026', '6 Apr. 2026', '2026-04-06', '4/6/2026',
    'Monday, April 6, 2026'])('reads %s as the same date', text => {
    expect(calendarDate(text)).toBe('2026-04-06');
  });

  it.each(['Apr 6, 2026, 9:00 AM GMT+9', '2026-04-06T00:00:00Z', '31 April 2026'])('rejects %s as a calendar date', text => {
    expect(calendarDate(text)).toBeNull();
  });

  it('compares every label and unit and accepts reordered series with their values', () => {
    const expected = {
      x: 'date', series: [{ label: 'North', unit: 'USD' }, { label: 'West' }],
      rows: [['2026-04-06', 1250.5, 12]],
    };
    expect(compareHeaders(expected, ['Day', 'west', 'North (USD)'])).toMatchObject({ pass: true, order: [2, 1] });
    expect(compareHeaders(expected, ['Day', 'West', 'North (kg)']).pass).toBe(false);
    expect(compareHeaders(expected, ['Day', 'West', 'North']).pass).toBe(false);
    expect(compareHeaders(expected, ['Day', 'West (kg)', 'North (USD)']).pass).toBe(false);
    expect(compareRows(expected, [['06 April 2026', '12', '1,250.50 USD']], [2, 1]).pass).toBe(true);
    expect(compareRows(expected, [['06 April 2026', '12', '1,250.50']], [2, 1]).pass).toBe(false);
  });
});
