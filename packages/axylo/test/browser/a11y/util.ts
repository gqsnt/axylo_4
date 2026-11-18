/**
 * Shared setup for the accessibility and interaction tests: the fixture charts by name, Chrome's own
 * accessibility node for an element (through the DevTools protocol, so value text and role description are
 * what Chrome exposes, not a re-computation), axe-core, and the tab order.
 */
import type { Page } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { chartPage } from '../chart/util';

export type FixtureName = 'trend' | 'bars' | 'parts' | 'scatter' | 'stacked' | 'dirty' | 'empty' | 'loading' | 'error' | 'compact';
export const FIXTURES: readonly FixtureName[] = ['trend', 'bars', 'parts', 'scatter', 'stacked', 'dirty', 'empty', 'loading', 'error', 'compact'];

declare global {
  interface Window {
    make(name: FixtureName, target: string | HTMLElement, extra?: Record<string, unknown>): import('../chart/util').ChartLike;
  }
}

/** Runs in the page: builds a fixture chart. The trend fixture's x is UTC instants, as the Phase 1 harness has it. */
function installMakers(): void {
  const fx = window.fx;
  const A = window.Axylo;
  const trend = (extra: Record<string, unknown>) => ({
    title: fx.trend.title, data: fx.trendRows(), x: { field: 'day', type: 'time', timeZone: 'UTC' },
    y: { field: 'sessions', label: fx.trend.yTitle }, series: 'channel', ...extra,
  });
  window.make = (name, target, extra = {}) => {
    switch (name) {
      case 'trend': return A.line!(target, trend(extra));
      case 'stacked': return A.area!(target, { ...trend(extra), title: 'Sessions, stacked', stacked: true });
      case 'bars': return A.bar!(target, {
        title: fx.bars.title, data: fx.bars.categories.map((team, i) => ({ team, satisfied: fx.bars.values[i] })),
        x: 'team', y: { field: 'satisfied', label: 'Satisfied', scale: 'percent' }, reference: [{ y: 90, label: 'Target' }], ...extra,
      });
      case 'parts': return A.donut!(target, {
        title: fx.parts.title, data: fx.parts.labels.map((browser, i) => ({ browser, share: fx.parts.values[i] })),
        label: 'browser', value: { field: 'share', label: 'Share', scale: 'percent' }, ...extra,
      });
      case 'scatter': {
        const r = fx.rng(3);
        const data = Array.from({ length: 300 }, (_, i) => {
          const size = 10 + r() * 990;
          return { size: Math.round(size), latency: Math.round(20 + size * 0.08 + (r() - 0.5) * 40), region: ['EU', 'US', 'APAC'][i % 3] };
        });
        return A.scatter!(target, { title: 'Latency by payload size', data, x: { field: 'size', label: 'Payload', unit: 'kB' }, y: { field: 'latency', label: 'Latency', unit: 'ms' }, series: 'region', ...extra });
      }
      case 'dirty': return A.line!(target, { title: 'Dirty input', data: fx.dirtyRows(), x: 'day', y: 'value', ...extra });
      case 'empty': return A.line!(target, { title: 'No rows returned', data: [], x: 'day', y: 'sessions', ...extra });
      case 'loading': return A.line!(target, { title: 'Loading', state: 'loading', data: [], x: 'day', y: 'sessions', ...extra });
      case 'error': return A.line!(target, { title: 'Failed', state: { error: 'The query failed.' }, data: [], x: 'day', y: 'sessions', ...extra });
      case 'compact': return A.line!(target, { compact: true, title: 'Direct sessions', data: fx.trendRows().filter(r => r.channel === 'Direct'), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'sessions', ...extra });
    }
  };
}

export async function fixturePage(options: Parameters<typeof chartPage>[0] = {}): Promise<Page> {
  const page = await chartPage(options);
  await page.evaluate(installMakers);
  return page;
}

/** Builds a fixture in #chart (or `target`) and waits for its first frame. */
export async function make(page: Page, name: FixtureName, extra: Record<string, unknown> = {}, target = '#chart'): Promise<void> {
  await page.evaluate(async ({ name, extra, target }) => {
    const chart = window.make(name, target, extra);
    window.charts.push(chart);
    await chart.__bench.ready();
    await window.nextFrames(1);
  }, { name, extra, target });
}

export interface AxNode {
  role: string;
  name: string;
  /** The range's value as Chrome exposes it (the ordinal). */
  value: string;
  max: number | null;
  roledescription: string | null;
  focused: boolean;
  /**
   * The value text. Chrome's DevTools accessibility view does not report `aria-valuetext` (its "valuetext"
   * property shows the number, even for an ARIA slider), so this is the attribute the platform tree is built
   * from; whether a screen reader speaks it can only be confirmed by rehearsal (decision 0001).
   */
  text: string;
}

/** Chrome's accessibility node for the first element matching `selector`. */
export async function axNode(page: Page, selector: string): Promise<AxNode> {
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no element for ${selector}`);
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    const ax = nodes[0]!;
    const prop = (name: string) => ax.properties?.find(p => p.name === name)?.value?.value as unknown;
    const roledescription = prop('roledescription');
    const max = prop('valuemax');
    return {
      role: String(ax.role?.value ?? ''), name: String(ax.name?.value ?? ''), value: String(ax.value?.value ?? ''),
      max: typeof max === 'number' ? max : null,
      roledescription: roledescription === undefined ? null : String(roledescription), focused: prop('focused') === true,
      text: (await page.locator(selector).first().getAttribute('aria-valuetext')) ?? '',
    };
  } finally {
    await client.detach();
  }
}

const axeSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../../node_modules/axe-core/axe.min.js'), 'utf8');

export interface AxeViolation { id: string; impact: string | null; nodes: string[]; help: string }

/** axe-core over `selector` (every rule axe enables by default, best practices such as heading-order included). */
export async function axe(page: Page, selector = 'body'): Promise<{ violations: AxeViolation[]; ran: string[]; incomplete: string[] }> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async selector => {
    type Rule = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };
    const run = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<{ violations: Rule[]; passes: Rule[]; incomplete: Rule[] }> } }).axe;
    const result = await run.run(selector, { resultTypes: ['violations', 'passes', 'incomplete'] });
    return {
      violations: result.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => n.target.join(' ')) })),
      // A rule axe could not decide is not a rule that ran (review 2, finding 21): it is reported apart.
      ran: [...result.passes, ...result.violations].map(r => r.id),
      incomplete: result.incomplete.map(r => r.id),
    };
  }, selector);
}

/** What has focus, as a short description: the chart part's class or the element's id. */
export async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    if (el.id === 'before' || el.id === 'after') return el.id;
    if (el.classList.contains('axylo-proxy')) return 'proxy';
    if (el.closest('.axylo-toolbar')) return 'toolbar:' + (el.textContent ?? '');
    if (el.classList.contains('axylo-table-scroll')) return 'table';
    return el.tagName.toLowerCase() + '.' + el.className;
  });
}

/** Presses Tab (or Shift+Tab) from `start` until focus leaves the chart, and lists the stops. */
export async function tabStops(page: Page, backwards = false): Promise<string[]> {
  await page.focus(backwards ? '#after' : '#before');
  const stops: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const at = await focused(page);
    if (at === 'before' || at === 'after' || at === 'body') return [...stops, at];
    stops.push(at);
  }
  return stops;
}

/** Text contrast per WCAG 2.x from two CSS colors resolved by the page. */
export async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.evaluate(selector => {
    const el = document.querySelector(selector) as HTMLElement;
    const parse = (c: string) => {
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.fillStyle = c;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    let bgEl: HTMLElement | null = el;
    let bg = 'rgb(255, 255, 255)';
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
      bgEl = bgEl.parentElement;
    }
    const fg = lum(parse(getComputedStyle(el).color));
    const back = lum(parse(bg));
    return (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05);
  }, selector);
}
