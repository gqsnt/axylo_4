import { line } from 'axylo';

// Typed columns: one array per field, all the same length. Axylo borrows these arrays: it reads
// them where they are and does not copy them, so do not change them in place afterwards.
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
