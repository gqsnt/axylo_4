const months = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

export const normalizedText = text => text.trim().replace(/\s+/g, ' ');

export function calendarDate(text) {
  const value = normalizedText(text).replace(/^(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?[,]? /i, '');
  const iso = /^(\d{4})([-/])(\d{2})\2(\d{2})$/.exec(value);
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const monthFirst = /^([a-z]+)\.? (\d{1,2}),? (\d{4})$/i.exec(value);
  const dayFirst = /^(\d{1,2}) ([a-z]+)\.?,? (\d{4})$/i.exec(value);
  const word = (monthFirst?.[1] ?? dayFirst?.[2])?.toLowerCase();
  const dayFirstNumeric = Number(numeric?.[1]) > 12;
  const month = Number(iso?.[3] ?? numeric?.[dayFirstNumeric ? 2 : 1] ??
    (months.findIndex(name => name === word || name.slice(0, 3) === word) + 1));
  const day = Number(iso?.[4] ?? numeric?.[dayFirstNumeric ? 1 : 2] ?? monthFirst?.[2] ?? dayFirst?.[1]);
  const year = Number(iso?.[1] ?? numeric?.[3] ?? monthFirst?.[3] ?? dayFirst?.[3]);
  if (!month || !day || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

function cellValue(text, unit) {
  text = normalizedText(text);
  if (text === 'No data') return null;
  if (unit) {
    if (!text.endsWith(' ' + unit)) return undefined;
    text = text.slice(0, -(unit.length + 1));
  }
  const number = text.replace(/^−/, '-');
  if (/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(number)) {
    return Number(number.replaceAll(',', ''));
  }
  return undefined;
}

export function seriesHeaders(expected) {
  return expected.series.map(({ label, unit }) => unit ? `${label} (${unit})` : label);
}

export function compareHeaders(expected, headers) {
  const wanted = seriesHeaders(expected);
  const columns = wanted.length + 1;
  const order = expected.series.map(({ label, unit }) => headers.findIndex((header, index) => {
    if (index === 0) return false;
    const rendered = normalizedText(header);
    const suffix = unit ? ` (${unit})` : '';
    return rendered.endsWith(suffix) &&
      rendered.slice(0, rendered.length - suffix.length).toLowerCase() === normalizedText(label).toLowerCase();
  }));
  const pass = headers.length === columns && !order.includes(-1) && new Set(order).size === wanted.length;
  return { pass, order, detail: `Expected series columns ${JSON.stringify(wanted)}, saw ${JSON.stringify(headers.slice(1))}.` };
}

export function compareRows(expected, rows, order = expected.series.map((_, i) => i + 1)) {
  let index = 0;
  for (const [x, ...values] of expected.rows) {
    const row = rows[index];
    const displayedX = row?.length && (expected.x === 'date' ? calendarDate(row[0]) : normalizedText(row[0]));
    if (displayedX !== x && values.every(value => value === null)) continue;
    if (!row || row.length !== order.length + 1 || displayedX !== x ||
        values.some((value, i) => value !== cellValue(row[order[i]], expected.series[i].unit))) {
      return { pass: false, detail: `Row ${index + 1} expected ${JSON.stringify([x, ...values])}, saw ${JSON.stringify(row ?? null)}.` };
    }
    index++;
  }
  if (index < rows.length) {
    return { pass: false, detail: `Unexpected row ${index + 1} ${JSON.stringify(rows[index])}.` };
  }
  return { pass: true, detail: `${rows.length} rows match.` };
}
