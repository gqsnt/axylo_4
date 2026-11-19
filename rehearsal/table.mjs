const months = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

function calendarDate(text) {
  const suffix = '(?=$|[T,\\s])';
  const iso = new RegExp('^(\\d{4})-(\\d{2})-(\\d{2})' + suffix).exec(text);
  if (iso) return iso[0];
  const numeric = new RegExp('^(\\d{1,2})/(\\d{1,2})/(\\d{4})' + suffix).exec(text);
  const words = new RegExp('^([a-z]+)\\.? (\\d{1,2}),? (\\d{4})' + suffix, 'i').exec(text);
  const month = words?.[1].toLowerCase();
  const number = numeric?.[1] ?? (months.findIndex(name => name === month || name.slice(0, 3) === month) + 1);
  const [day, year] = (numeric ?? words ?? []).slice(2);
  if (!number || !year) return null;
  // Reading the visible calendar day must not convert the printed time back to UTC.
  return `${year}-${String(number).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function cellValue(text, unit) {
  if (unit && text.endsWith(' ' + unit)) text = text.slice(0, -(unit.length + 1)).trim();
  if (text === 'No data') return null;
  const number = text.replace(/^−/, '-').replace(/^([+-]?)\p{Sc}\s*/u, '$1');
  if (/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(number)) {
    return Number(number.replaceAll(',', ''));
  }
  return undefined;
}

export function compareRows(expected, headers, rows) {
  const columns = expected.series.length + 1;
  if (headers.length !== columns) {
    return { pass: false, detail: `Expected ${columns} columns, saw ${headers.length}.` };
  }
  const order = columns === 2 ? [1] : expected.series.map(name =>
    headers.findIndex((label, index) => index > 0 && label.toLowerCase().replace(/ \([^)]+\)$/, '') === name));
  if (order.includes(-1)) {
    return { pass: false, detail: `Expected columns for ${expected.series.join(', ')}, saw ${JSON.stringify(headers.slice(1))}.` };
  }
  const units = order.map(column => / \(([^)]+)\)$/.exec(headers[column])?.[1]);
  let index = 0;
  for (const [x, ...values] of expected.rows) {
    const row = rows[index];
    const displayedX = row?.length && (expected.x === 'date' ? calendarDate(row[0]) : row[0]);
    if (displayedX !== x && values.every(value => value === null)) continue;
    if (!row || row.length !== columns || displayedX !== x ||
        values.some((value, i) => value !== cellValue(row[order[i]], units[i]))) {
      return { pass: false, detail: `Row ${index + 1} expected ${JSON.stringify([x, ...values])}, saw ${JSON.stringify(row ?? null)}.` };
    }
    index++;
  }
  if (index < rows.length) {
    return { pass: false, detail: `Unexpected row ${index + 1} ${JSON.stringify(rows[index])}.` };
  }
  return { pass: true, detail: `${rows.length} rows match.` };
}
