/**
 * What each runnable example must show, beyond "it renders": how many charts it has, a value that comes from
 * its own data (read back from the chart's value text, summary, legend or table), and the interaction the
 * example teaches. Expected values are derived from the example's data by hand or from the Phase 1 fixture
 * (research/harness/src/data.js), never from the library's output.
 */
import { expect } from 'vitest';
import type { Page } from 'playwright-core';
import { trend, bars } from '../../../research/harness/src/data.js';

export interface Tools {
  page: Page;
  /** Focuses chart `index`'s plot, presses `keys`, returns its value text. */
  value(index: number, keys: string[]): Promise<string>;
  /** The figure's description: its generated summary. */
  desc(index: number): Promise<string>;
  /** The figure's accessible name. */
  name(index: number): Promise<string>;
  note(index: number): Promise<string>;
  message(index: number): Promise<string>;
  legend(index: number): Promise<string[]>;
  toolbar(index: number): Promise<string[]>;
  /** Opens the table of chart `index` and returns its rows, cells joined by ' | '. */
  table(index: number): Promise<string[]>;
  text(selector: string): Promise<string>;
  click(selector: string): Promise<void>;
  /** The computed stroke of the `n`th series line of chart `index`. */
  stroke(index: number, n: number): Promise<string>;
  /** Waits until `fn` (evaluated in the page) is truthy. */
  until(fn: string, timeout?: number): Promise<void>;
}

interface Check { charts: number; run: (t: Tools) => Promise<void> }

const n = (value: number) => value.toLocaleString('en-US');
const has = (text: string, ...parts: string[]) => { for (const part of parts) expect(text).toContain(part); };

const valueText = async (t: Tools, index: number, keys: string[], ...parts: string[]) => has(await t.value(index, keys), ...parts);

export const checks: Record<string, Check> = {
  'first-chart-npm': { charts: 1, run: t => valueText(t, 0, ['Home'], n(4210), 'Point 1 of 4') },
  'first-chart-script': { charts: 1, run: t => valueText(t, 0, ['End'], n(5127), 'Point 4 of 4') },
  'first-chart-react': { charts: 1, run: async t => {
    await valueText(t, 0, ['Home'], n(4210));
    expect(await t.name(0)).toBe('Monthly visitors');
  } },
  'a11y-card': { charts: 1, run: async t => {
    expect(await t.name(0)).toBe('Checkout latency by region');
    has(await t.desc(0), 'payment provider outage');
    await valueText(t, 0, ['Home'], 'Europe 310 ms', 'North America 405 ms');
  } },
  'area-incomplete': { charts: 1, run: t => valueText(t, 0, ['Home', 'ArrowRight', 'ArrowRight'], 'Mobile No data', 'incomplete') },
  'area-mixed': { charts: 1, run: t => valueText(t, 0, ['Home', 'ArrowRight'], 'Mar 9, 2026', 'Total 12 k USD and -7 k USD') },
  'area-stacked': { charts: 1, run: t => valueText(t, 0, ['Home'], `Direct ${n(45000)}`, `Organic search ${n(28621)}`, `Referral ${n(4752)}`, `Total ${n(78373)}`) },
  'bar-horizontal': { charts: 1, run: async t => {
    await valueText(t, 0, ['Home'], 'Account settings and profile', '2025 42', '2026 51');
    await valueText(t, 0, ['Home', 'ArrowRight', 'ArrowRight'], 'Partner integrations', '2026 No data');
  } },
  'bar-stacked': { charts: 1, run: async t => {
    await valueText(t, 0, ['Home'], '2025 Q1', 'Total 165 k USD and -60 k USD');
    expect(await t.name(0)).toBe('Revenue gains and losses by quarter');
  } },
  'bar-target': { charts: 1, run: async t => {
    await valueText(t, 0, ['Home'], 'Billing', '94%');
    has(await t.desc(0), 'Target');
  } },
  'compact-dirty': { charts: 1, run: async t => {
    has(await t.desc(0), 'maximum 1.8', 'Values not shown: 1');
    expect(await t.name(0)).toBe('Error rate, last 14 days');
  } },
  'compact-tiles': { charts: 3, run: async t => {
    // 30 days of the tile formula: the sum of sessions and revenue, and the errors on day 30.
    expect(await t.text('#sessions-total')).toBe(n(50781));
    expect(await t.text('#revenue-total')).toBe('$' + n(184909));
    expect(await t.text('#errors-latest')).toBe('30');
    expect(await t.name(2)).toBe('Errors on the latest day');
    has(await t.desc(2), 'last 30');
  } },
  'daily-sessions': { charts: 1, run: async t => {
    // Run in Los Angeles: with type 'date', 24 February stays 24 February.
    await valueText(t, 0, ['Home'], 'Feb 24, 2026', n(3120), 'Point 1 of 5');
    const rows = await t.table(0);
    expect(rows).toContain('Feb 26, 2026 | No data');
  } },
  'data-columns': { charts: 1, run: t => valueText(t, 0, ['Home'], `Direct ${n(3120)}`, 'Referral 410', 'Point 1 of 4') },
  'data-long': { charts: 1, run: t => valueText(t, 0, ['Home'], `Direct ${n(3120)}`, 'Referral 410', 'Point 1 of 4') },
  'data-wide': { charts: 1, run: t => valueText(t, 0, ['Home'], `Direct ${n(3120)}`, 'Referral 410', 'Point 1 of 4') },
  dates: { charts: 2, run: async t => {
    // Los Angeles: midnight UTC on 24 February is 4 PM on the 23rd; the date string is the 24th.
    await valueText(t, 0, ['Home'], 'Feb 23, 2026', 'PST', 'sessions 120');
    await valueText(t, 1, ['Home'], 'Feb 24, 2026', 'sessions 120');
  } },
  'diagnostics-listener': { charts: 1, run: async t => {
    const log = await t.text('#log');
    has(log, 'AX103 (warning), field value, rows 3', 'AX106 (warning), field value, rows 4', 'AX102 (warning), field value, rows 5');
    expect(await t.note(0)).toBe('Values not shown: 3. See table.');
  } },
  'donut-basic': { charts: 1, run: async t => {
    has((await t.legend(0)).join(' / '), 'Chrome', '46.2%', 'Other');
    await valueText(t, 0, ['Home'], 'Chrome', '46.2%');
  } },
  'donut-many': { charts: 1, run: async t => {
    const legend = (await t.legend(0)).join(' / ');
    has(legend, 'Other (2)', 'Iceland', 'Malta', 'No data', 'United States');
    expect(legend).not.toContain('Spain');
    const table = (await t.table(0)).join(' / ');
    has(table, 'Spain', 'Norway', 'Iceland', 'Malta');
  } },
  'line-dense': { charts: 1, run: async t => {
    await valueText(t, 0, ['End'], 'Point 100,000 of 100,000');
    has(await t.desc(0), 'maximum 97 %');
  } },
  'line-dirty': { charts: 1, run: async t => {
    expect(await t.note(0)).toBe('Values not shown: 3. See table.');
    await valueText(t, 0, ['Home'], 'Mon', 'value 10');
  } },
  'line-many-series': { charts: 1, run: async t => {
    expect((await t.legend(0)).length + (await t.toolbar(0)).filter(b => /^(North|South|East|West|Central|Coast|Hills|Plains|Lakes|Islands|Valley|Delta)$/.test(b)).length).toBeGreaterThanOrEqual(12);
    await valueText(t, 0, ['Home'], 'North 100');
  } },
  'line-time': { charts: 1, run: async t => {
    await valueText(t, 0, ['Home'], 'Mar 10, 2026, 12:00 AM UTC', 'checkout 320 ms', 'search 230 ms');
    has(await t.desc(0), 'Times are shown in UTC', 'Reference band Incident', 'Reference line Objective');
  } },
  'messages-translated': { charts: 2, run: async t => {
    expect(await t.note(0)).toBe('Werte nicht angezeigt: 1. Siehe Tabelle.');
    expect(await t.note(1)).toBe('Werte nicht angezeigt: 1.');
    has((await t.toolbar(0)).join(), 'Als Tabelle anzeigen');
  } },
  'migrate-stream': { charts: 1, run: async t => {
    await t.until(`[...document.querySelectorAll('.axylo-toolbar button')].some(b => b.textContent === 'Pause')`);
    await valueText(t, 0, ['End'], 'Point 600 of 600');
  } },
  'migrate-target': { charts: 1, run: t => valueText(t, 0, ['Home'], bars.categories[0]!, `${bars.values[0]}%`) },
  'migrate-trend': { charts: 1, run: t => valueText(t, 0, ['Home'], `Direct ${n(trend.series[0]!.values[0]!)}`, `Referral ${n(trend.series[2]!.values[0]!)}`) },
  missing: { charts: 2, run: async t => {
    const gaps = await t.table(0);
    expect(gaps).toEqual(expect.arrayContaining(['Mar 2, 2026 | 0', 'Mar 3, 2026 | No data', 'Mar 4, 2026 | No data']));
    const zeros = await t.table(1);
    expect(zeros).toEqual(expect.arrayContaining(['Mar 3, 2026 | 0', 'Mar 4, 2026 | 0']));
  } },
  'numeric-strings': { charts: 1, run: async t => {
    await valueText(t, 0, ['Home'], 'Orders 182');
    has(await t.desc(0), 'maximum 231');
  } },
  'react-line': { charts: 1, run: async t => {
    await t.value(0, ['Home']);
    await t.until(`document.querySelector('#root section > p')?.textContent.includes('2026-03-01')`);
    has(await t.text('#root section > p'), 'Direct on 2026-03-01: 3100');
  } },
  'react-stream': { charts: 1, run: async t => {
    await t.until(`[...document.querySelectorAll('.axylo-toolbar button')].some(b => b.textContent === 'Pause')`);
    await valueText(t, 0, ['End'], 'Point 60 of 60');
  } },
  'recharts-stream': { charts: 1, run: async t => {
    await t.until(`[...document.querySelectorAll('.axylo-toolbar button')].some(b => b.textContent === 'Pause')`);
    await valueText(t, 0, ['End'], 'Point 600 of 600');
  } },
  'recharts-target': { charts: 1, run: t => valueText(t, 0, ['Home'], bars.categories[0]!, `${bars.values[0]}%`) },
  'recharts-trend': { charts: 1, run: t => valueText(t, 0, ['Home'], `Direct ${n(trend.series[0]!.values[0]!)}`, `Organic search ${n(trend.series[1]!.values[0]!)}`) },
  // The first point by x, then y: rows 0 and 95 both have size 5; row 95 (ap-south) has the lower latency.
  'scatter-basic': { charts: 1, run: t => valueText(t, 0, ['Home'], 'ap-south, 5 KB, 22 ms') },
  'scatter-missing-y': { charts: 1, run: async t => {
    // Three points; the fourth row has no latency and is listed in the table only.
    await valueText(t, 0, ['End'], 'Point 3 of 3');
    const rows = (await t.table(0)).join(' / ');
    has(rows, '48 KB', 'No data');
  } },
  'scatter-ties': { charts: 1, run: t => valueText(t, 0, ['End'], 'Point 16 of 16') },
  'script-tag': { charts: 1, run: t => valueText(t, 0, ['Home'], n(3120), 'Point 1 of 5') },
  states: { charts: 4, run: async t => {
    expect(await t.message(0)).toBe('Loading chart.');
    expect(await t.message(1)).toBe('No data to show.');
    expect(await t.message(2)).toBe('No refunds yet.');
    expect(await t.message(3)).toBe('The query timed out.');
  } },
  stream: { charts: 1, run: async t => {
    expect(await t.toolbar(0)).not.toContain('Pause');
    await t.until(`[...document.querySelectorAll('.axylo-toolbar button')].some(b => b.textContent === 'Pause')`);
    await valueText(t, 0, ['End'], 'Point 60 of 60');
  } },
  strict: { charts: 1, run: async t => {
    await t.click('#bad');
    has(await t.text('#result'), 'Rejected: [axylo AX106]', '"n/a"');
    await valueText(t, 0, ['End'], `sessions ${n(3290)}`, 'Point 3 of 3');
  } },
  'theme-colors': { charts: 2, run: async t => {
    // Referral is the third series of the first chart and the first of the second: one colour on both.
    expect(await t.stroke(0, 2)).toBe(await t.stroke(1, 0));
    expect(await t.stroke(0, 2)).not.toBe(await t.stroke(0, 0));
  } },
  'theme-tokens': { charts: 1, run: async t => {
    expect(await t.stroke(0, 0)).toBe('rgb(11, 110, 79)');
    const font = await t.page.evaluate(() => getComputedStyle(document.querySelector('.axylo-text')!).fontFamily);
    expect(font).toContain('Georgia');
    await valueText(t, 0, ['Home'], 'Signups 820', 'Churned 360');
  } },
  'theme-toggle': { charts: 1, run: async t => {
    const axis = () => t.page.evaluate(() => getComputedStyle(document.querySelector('.axylo-svg line[style*="--axylo-axis"]')!).stroke);
    const before = await axis();
    await t.click('#theme');
    await t.until(`document.documentElement.dataset.theme === 'dark'`);
    await t.page.waitForTimeout(150);
    expect(await axis()).not.toBe(before);
  } },
  unsorted: { charts: 1, run: t => valueText(t, 0, ['Home'], 'Mar 2, 2026', 'tickets 51') },
  units: { charts: 2, run: async t => {
    await valueText(t, 0, ['Home'], '3.1%');
    await valueText(t, 1, ['End'], n(1210) + ' ms');
  } },
  update: { charts: 1, run: async t => {
    await t.click('#next');
    await t.click('#subtitle');
    await t.page.waitForTimeout(150);
    has(await t.text('.axylo-subtitle'), 'Week of 9 March');
    await valueText(t, 0, ['Home'], 'Mar 9, 2026', 'orders 190');
    await t.click('#metric');
    await t.page.waitForTimeout(150);
    await valueText(t, 0, ['Home'], `Revenue ${n(7724)} USD`);
  } },
  'wide-keys': { charts: 1, run: async t => {
    await t.value(0, ['Home', 'Enter']);
    expect(await t.text('#picked')).toBe('Direct on 2026-03-02: 3120 (row 0)');
    expect(await t.stroke(0, 0)).toBe('rgb(31, 111, 178)');
  } },
  zoom: { charts: 1, run: async t => {
    await t.click('#last-week');
    await t.until(`document.querySelector('#range').textContent !== 'Showing everything.'`);
    expect(await t.text('#range')).toBe('Showing 2026-03-25 to 2026-03-31.');
    // The event is sent from the call; the zoomed view is drawn in the next frame.
    await t.page.waitForTimeout(150);
    await t.value(0, ['Home', 'Enter']);
    expect(await t.text('#picked')).toBe(`Selected sessions on 2026-03-25: ${3569} (row 24).`);
  } },
  'zoom-linked': { charts: 2, run: async t => {
    has(await t.desc(1), 'Mar 10, 2026, 6:00 AM UTC', 'Mar 10, 2026, 12:00 PM UTC');
  } },
};
