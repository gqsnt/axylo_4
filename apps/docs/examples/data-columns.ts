import { line } from 'axylo';

// Typed columns: one array per field, all the same length. Axylo reads a Float64Array or Float32Array
// value column in place when it can (x already in order, nothing to change) and copies otherwise. Either
// way, do not change these arrays after passing them; pass new ones with update({ data }).
const columns = {
  day: ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'],
  direct: new Float64Array([3120, 3380, 3290, 3510]),
  referral: new Float64Array([410, 455, 390, 520]),
};

line('#chart', {
  title: 'Sessions by channel',
  data: { columns },
  x: 'day',
  y: [{ field: 'direct', label: 'Direct' }, { field: 'referral', label: 'Referral' }],
});
