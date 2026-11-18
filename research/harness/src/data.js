// Shared, deterministic datasets. Every library receives exactly these values.
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DAY = 864e5;
const START = Date.UTC(2026, 0, 1);

// Task "trend": 3 series x 120 daily points (UTC midnights). "Referral" has a 7-day outage (nulls).
export const trend = (() => {
  const r = rng(7), n = 120;
  const t = Array.from({ length: n }, (_, i) => START + i * DAY);
  const mk = (base, growth, noise, season) => t.map((_, i) => Math.round(base + growth * i + season * Math.sin((i / 7) * 2 * Math.PI) + (r() - 0.5) * noise));
  const series = [
    { name: 'Direct', values: mk(31000, 120, 4000, 3000) },
    { name: 'Organic search', values: mk(18000, 60, 3000, 2500) },
    { name: 'Referral', values: mk(4200, -8, 1200, 400) },
  ];
  for (let i = 60; i < 67; i++) series[2].values[i] = null;
  return { title: 'Daily sessions by channel', yTitle: 'Sessions', t, series };
})();

// Task "bars": one series, all values between 82 and 97 (tests zero baseline), one long label.
export const bars = {
  title: 'Customer satisfaction by team', yTitle: 'Satisfied (%)', name: 'Satisfied (%)',
  categories: ['Billing', 'Customer Success & Onboarding', 'Platform', 'Mobile', 'Data', 'Security', 'Sales Eng.'],
  values: [94, 88, 97, 82, 91, 85, 90],
};

// Task "parts": six shares, two of them small.
export const parts = {
  title: 'Sessions by browser', name: 'Share (%)',
  labels: ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Other'],
  values: [46.2, 27.5, 14.1, 8.9, 2.1, 1.2],
};

// Task "dirty": values a real app sends by mistake. Correct reading: Wed, Thu, Sat are missing; Fri is ambiguous (a string).
export const dirty = {
  title: 'Dirty input', name: 'Value',
  categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  values: [10, 20, null, NaN, '40', undefined, 70],
};

// Task "scale": one series, n points, one per minute, random walk.
export function scale(n) {
  const r = rng(1), t = new Array(n), y = new Array(n);
  let v = 100;
  for (let i = 0; i < n; i++) { v += (r() - 0.5) * 2; t[i] = START + i * 60000; y[i] = Math.round(v * 100) / 100; }
  return { title: `${n.toLocaleString('en-US')} points`, name: 'Value', t, y };
}

// Task "stream": 600-point window; the harness then pushes one new point per frame.
export function stream() {
  const d = scale(600);
  const r = rng(2);
  let v = d.y[d.y.length - 1], i = d.t.length;
  return { ...d, title: 'Streaming window', next: () => { v += (r() - 0.5) * 2; return [START + i++ * 60000, Math.round(v * 100) / 100]; } };
}

// Task "dates": the trend series keyed by calendar-date strings (no time, no zone), to separate
// "this library shifts instants into the viewer's zone" from "this library cannot show a date as a date".
export const dates = { ...trend, days: trend.t.map(t => new Date(t).toISOString().slice(0, 10)) };

// Tasks "dirty-null", "dirty-nan", "dirty-string", "dirty-undefined": one bad value at a time, in a line of
// seven otherwise valid points, so each outcome can be attributed to one kind of input.
export function dirtyOne(kind) {
  const bad = { null: null, nan: NaN, string: '40', undefined: undefined }[kind];
  return { ...dirty, title: `One bad value: ${kind}`, values: [10, 20, 30, bad, 50, 60, 70] };
}
