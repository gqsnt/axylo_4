/**
 * The charts the CSP test pages draw: all five types and the compact variant, with author text that looks
 * like markup in every place a label or formatter output reaches (title, subtitle, series and category
 * names, field labels, units, value and tick formatters). Bundled by csp.browser.test.ts into a classic
 * script (window.Axylo from the script-tag file) and into a module that imports the package from a fixture.
 */
export const IMG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
export const SCRIPT = '<script>window.__xss=(window.__xss||0)+1</script>';

type Make = (target: string, options: Record<string, unknown>) => { diagnostics: readonly { code: string; level: string }[] };
export interface Library { line: Make; area: Make; bar: Make; scatter: Make; donut: Make }

const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];
const channels = ['Direct', IMG];
const visits = days.flatMap((day, i) => channels.map((channel, c) => ({ day, channel, sessions: 1200 + 150 * i + 400 * c - 90 * (i % 3) })));
const regions = [
  { region: 'North', revenue: 182000 }, { region: SCRIPT, revenue: 151000 }, { region: 'South', revenue: 97000 }, { region: 'West', revenue: 120500 },
];
const points = Array.from({ length: 40 }, (_, i) => ({ size: 20 + i * 12.5, latency: 80 + ((i * 37) % 23) * 6 + i * 2, kind: i % 2 ? SCRIPT : 'Cached' }));
const shares = [{ browser: IMG, share: 41.2 }, { browser: 'Firefox', share: 22.5 }, { browser: 'Safari', share: 19.8 }, { browser: 'Other', share: 16.5 }];
const valueFormat = (v: number): string => `${IMG}${v}`;
// Short, because tick labels take room from the plot: a 50-character tick would leave little to hover.
export const TICK = '<img src=x onerror=1>';
const tickFormat = (v: number): string => `${TICK}${v}`;

export function makeCharts(A: Library): void {
  const w = window as unknown as Record<string, unknown>;
  const charts = [
    A.line('#line', {
      title: `Sessions ${IMG}`, subtitle: SCRIPT, data: visits, x: 'day', series: 'channel',
      y: { field: 'sessions', label: `Sessions ${SCRIPT}`, unit: IMG, format: valueFormat, tickFormat },
    }),
    A.area('#area', { title: `Stacked ${SCRIPT}`, data: visits, x: 'day', series: 'channel', y: { field: 'sessions', format: valueFormat }, stacked: true }),
    A.bar('#bar', { title: `Revenue ${IMG}`, data: regions, x: { field: 'region', label: IMG }, y: { field: 'revenue', format: valueFormat, tickFormat } }),
    A.scatter('#scatter', { title: `Latency ${SCRIPT}`, data: points, x: { field: 'size', label: SCRIPT }, y: { field: 'latency', unit: 'ms', format: valueFormat }, series: 'kind' }),
    A.donut('#donut', { title: `Browsers ${IMG}`, data: shares, label: 'browser', value: { field: 'share', scale: 'percent', format: valueFormat } }),
    A.line('#compact', { title: `Compact ${IMG}`, data: visits.filter(r => r.channel === 'Direct'), x: 'day', y: 'sessions', compact: true }),
  ];
  w.__charts = charts;
  try {
    A.line('#no-such-chart', { title: 'Missing', data: visits, x: 'day', y: 'sessions' });
    w.__missing = null;
  } catch (error) {
    w.__missing = String((error as Error).message);
  }
}
