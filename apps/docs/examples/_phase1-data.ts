// The Phase 1 datasets (research/harness/src/data.js), in TypeScript, for the migration examples:
// the Chart.js and Recharts configurations on those pages received exactly these values.
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 864e5;
const START = Date.UTC(2026, 0, 1);

/** 3 series × 120 daily points at UTC midnights; "Referral" has a 7-day outage (nulls). */
export const trend = (() => {
  const r = rng(7);
  const n = 120;
  const t = Array.from({ length: n }, (_, i) => START + i * DAY);
  const mk = (base: number, growth: number, noise: number, season: number): (number | null)[] =>
    t.map((_, i) => Math.round(base + growth * i + season * Math.sin((i / 7) * 2 * Math.PI) + (r() - 0.5) * noise));
  const series = [
    { name: 'Direct', values: mk(31000, 120, 4000, 3000) },
    { name: 'Organic search', values: mk(18000, 60, 3000, 2500) },
    { name: 'Referral', values: mk(4200, -8, 1200, 400) },
  ];
  for (let i = 60; i < 67; i++) series[2]!.values[i] = null;
  return { title: 'Daily sessions by channel', yTitle: 'Sessions', t, series };
})();

/** One series, values 82–97, one long label. */
export const bars = {
  title: 'Customer satisfaction by team', yTitle: 'Satisfied (%)', name: 'Satisfied (%)',
  categories: ['Billing', 'Customer Success & Onboarding', 'Platform', 'Mobile', 'Data', 'Security', 'Sales Eng.'],
  values: [94, 88, 97, 82, 91, 85, 90],
};

/** A 600-point window, one point per minute, and a source of further points. */
export function stream(): { title: string; t: number[]; y: number[]; next: () => [number, number] } {
  const r = rng(1);
  const t: number[] = [];
  const y: number[] = [];
  let v = 100;
  for (let i = 0; i < 600; i++) {
    v += (r() - 0.5) * 2;
    t.push(START + i * 60000);
    y.push(Math.round(v * 100) / 100);
  }
  const r2 = rng(2);
  let last = y[y.length - 1]!;
  let i = t.length;
  return {
    title: 'Streaming window', t, y,
    next: () => { last += (r2() - 0.5) * 2; return [START + i++ * 60000, Math.round(last * 100) / 100]; },
  };
}
