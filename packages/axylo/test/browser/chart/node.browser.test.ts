/**
 * Spec DX8: the built package imports in a plain Node process (no DOM, no test framework) and `validate`
 * runs there. Lives with the browser tests because it needs `npm run build` first.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '../../../dist');

describe('the built package in plain Node (spec DX8)', () => {
  for (const file of ['axylo.js', 'axylo.dev.js']) {
    it(`import('${file}') does not throw and validate('line', …) returns diagnostics`, () => {
      const script = `
        const m = await import(${JSON.stringify(path.join(dist, file))});
        const d = m.validate('line', { title: 'Dirty input', data: [{ day: 'Mon', value: 10 }, { day: 'Tue', value: NaN }], x: 'day', y: 'value' });
        console.log(JSON.stringify({ exports: Object.keys(m).sort(), codes: d.map(x => x.code), document: typeof document }));`;
      const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim());
      expect(out.exports).toEqual(['area', 'bar', 'donut', 'histogram', 'line', 'scatter', 'validate']);
      expect(out.codes).toEqual(['AX103']);
      expect(out.document).toBe('undefined');
    });
  }
});
