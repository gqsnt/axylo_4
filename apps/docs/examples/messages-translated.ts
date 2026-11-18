import { line } from 'axylo';

// Raises AX103 on purpose: one value is NaN, so each chart tells the reader one value is not shown.
const rows = [
  { tag: '2026-03-02', besuche: 3120 },
  { tag: '2026-03-03', besuche: Number.NaN },
  { tag: '2026-03-04', besuche: 3290 },
];
const messages = {
  // Keep {seeTable}: the chart fills it with `seeTable` when it has a table, and removes it when not.
  valuesNotShown: 'Werte nicht angezeigt: {count}. {seeTable}',
  seeTable: 'Siehe Tabelle.',
  viewAsTable: 'Als Tabelle anzeigen',
};

line('#with-table', { title: 'Besuche pro Tag', data: rows, x: 'tag', y: 'besuche', locale: 'de-DE', messages });
line('#no-table', { title: 'Besuche pro Tag, ohne Tabelle', data: rows, x: 'tag', y: 'besuche', locale: 'de-DE', messages, table: false });
