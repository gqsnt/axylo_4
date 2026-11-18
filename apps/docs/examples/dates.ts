import { line } from 'axylo';

// Raises AX111 on purpose: the first chart is given instants where calendar dates were meant.
const values = [120, 135, 128, 150, 162];

// UTC midnights, as `new Date('2026-02-24').toISOString()` or many APIs produce them. These are
// instants: shown in the viewer's time zone, and west of UTC each one falls on the evening before.
const instants = values.map((sessions, i) => ({ day: `2026-02-${24 + i}T00:00:00Z`, sessions }));
line('#instants', { title: 'Sent as instants', data: instants, x: 'day', y: 'sessions' });

// The same days as calendar dates: read the same in every time zone.
const dates = values.map((sessions, i) => ({ day: `2026-02-${24 + i}`, sessions }));
line('#dates', { title: 'Sent as dates', data: dates, x: 'day', y: 'sessions' });
