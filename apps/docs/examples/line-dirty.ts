import { line } from 'axylo';

// Raises AX102, AX103 and AX106 on purpose: the values a real application sends by mistake.
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const values: unknown[] = [10, 20, null, NaN, '40', undefined, 70];
const rows = days.map((day, i) => ({ day, value: values[i] as number | null }));

// Wed (null) is a gap, silently. Thu (NaN), Fri (a string) and Sat (no value) are gaps too, and
// the chart tells the reader that three values are not shown. Sun, alone between gaps, is a point.
line('#chart', { title: 'Dirty input', data: rows, x: 'day', y: 'value' });
