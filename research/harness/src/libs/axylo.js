import { bar, donut, line } from 'axylo'; // The packed build supplies its own stylesheet.

export const meta = { name: 'Axylo', pkg: 'axylo' };

function sessions(el, d, times, x) {
  // Long rows keep each channel name and allow a shared Sessions axis title.
  const data = d.series.flatMap(s => times.map((day, i) => ({ day, channel: s.name, sessions: s.values[i] })));
  return line(el, { data, title: d.title, x, y: { field: 'sessions', label: d.yTitle }, series: 'channel' });
}

export function trend(el, d) {
  // Epoch milliseconds need an explicit instant axis. The empty task passes zero rows through this call.
  return sessions(el, d, d.t, { field: 'day', type: 'time' });
}

export function dates(el, d) {
  // ISO calendar dates are inferred and kept in their original form.
  return sessions(el, d, d.days, 'day');
}

export function bars(el, d) {
  // Supply the value-axis title. Zero baseline and label fitting are built in.
  return bar(el, { data: { columns: { team: d.categories, satisfied: d.values } }, title: d.title,
    x: 'team', y: { field: 'satisfied', label: d.yTitle } });
}

export function parts(el, d) {
  // Name the slice and value fields. The legend and palette are built in.
  return donut(el, { data: { columns: { browser: d.labels, share: d.values } }, title: d.title,
    label: 'browser', value: { field: 'share', label: d.name } });
}

export function dirty(el, d) {
  // Keep every sentinel as sent, including NaN, for both combined and individual cases.
  const data = d.categories.map((day, i) => ({ day, value: d.values[i] }));
  return line(el, { data, title: d.title, x: 'day', y: { field: 'value', label: d.name } });
}

export function scale(el, d) {
  // The existing columns need only field names and a declared instant axis. Dense lines simplify automatically.
  return line(el, { data: { columns: { t: d.t, value: d.y } }, title: d.title,
    x: { field: 't', type: 'time' }, y: { field: 'value', label: d.name } });
}

export function stream(el, d) {
  const chart = scale(el, d);
  // Axylo owns the sliding window once told how many x positions to keep.
  return { push: (t, value) => chart.append([{ t, value }], { keep: d.t.length }), destroy: () => chart.destroy() };
}
