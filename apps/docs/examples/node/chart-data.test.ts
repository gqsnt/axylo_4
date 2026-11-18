// A unit test that fails when a chart's data would not be drawn as given. Runs with Vitest in Node.
import { describe, expect, it } from 'vitest';
import { validate } from 'axylo';

// In a project, the rows a query returns and the options you pass come from your own code.
const rows = [
  { day: '2026-03-02', sessions: 3120 },
  { day: '2026-03-03', sessions: 3380 },
  { day: '2026-03-04', sessions: 3290 },
];

describe('sessions chart', () => {
  it('has nothing Axylo would leave out or refuse', () => {
    const options = { title: 'Sessions', data: rows, x: 'day', y: 'sessions' } as const;
    const problems = validate('line', options);
    expect(problems.filter(d => d.level !== 'hint')).toEqual([]);
  });
});
