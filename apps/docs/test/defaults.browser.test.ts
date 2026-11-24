/**
 * The defaults in the options reference (apps/docs/pages/options.md), against the running chart. For each
 * option whose default is written in `code`, and for the described defaults listed in DESCRIBED, a chart with
 * the option left out must be the same as a chart with the documented default given explicitly, and different
 * from one with another value (so the comparison could have failed). "The same" is the chart's whole figure,
 * after an optional interaction, with generated ids removed. Charts are drawn by the packed script-tag file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildSite } from '../lib/site.mjs';
import { docsRoot } from '../lib/examples.mjs';
import { serve } from '../lib/serve.mjs';

type Kind = 'line' | 'area' | 'bar' | 'histogram' | 'scatter' | 'donut';
interface Probe {
  kind: Kind;
  /** Options the probe starts from; `at` is where the option goes (a key, or a key inside `x`, `y` or `title`). */
  base: Record<string, unknown>;
  at?: [string, string] | [string];
  /** A value that must make a difference. */
  other: unknown;
  /** Replaces the documented literal, for a default described in words. */
  explicit?: unknown;
  hover?: boolean;
  /** Appends these rows after creating the chart, with `{ [key]: value }` as the append options. */
  append?: Record<string, unknown>[];
  lang?: string;
  zone?: string;
  /** For `strict`: compares whether a call throws instead of the figure. */
  throws?: boolean;
}

const days = (n: number, f = (i: number) => i + 1) => Array.from({ length: n }, (_, i) => ({ day: `2026-03-${String(i + 1).padStart(2, '0')}`, a: f(i), b: 10 - f(i) }));
const line = (extra: Record<string, unknown> = {}) => ({ title: 'T', data: days(5), x: 'day', y: 'a', ...extra });

/** Where each documented default is exercised: `Group.key` as in the reference. */
const PROBES: Record<string, Probe> = {
  'CommonOptions.state': { kind: 'line', base: line(), other: 'loading' },
  'CommonOptions.legend': { kind: 'line', base: line({ y: ['a', 'b'] }), other: 'top' },
  'CommonOptions.tooltip': { kind: 'line', base: line(), other: false, hover: true },
  'CommonOptions.table': { kind: 'line', base: line(), other: false },
  'CommonOptions.locale': { kind: 'line', base: line({ data: days(3, i => 1234.5 * (i + 1)) }), explicit: 'de', other: 'en-US', lang: 'de' },
  'CommonOptions.strict': { kind: 'line', base: line({ data: [{ day: '2026-03-01', a: 1 }, { day: '2026-03-02', a: '1,5' }] }), other: true, throws: true },
  'CommonOptions.messages': { kind: 'line', base: line({ data: [] }), explicit: {}, other: { empty: 'Leer.' } },
  'Title.visible': { kind: 'line', base: line({ title: { text: 'T' } }), at: ['title', 'visible'], other: false },
  'Title.level': { kind: 'line', base: line({ title: { text: 'T' } }), at: ['title', 'level'], other: 2 },
  'CartesianOptions.zoom': { kind: 'line', base: line(), other: false },
  'CompactOption.compact': { kind: 'line', base: line(), other: true },
  'AreaOptions.stacked': { kind: 'area', base: line({ y: ['a', 'b'] }), other: true },
  'BarOptions.layout': { kind: 'bar', base: line({ y: ['a', 'b'] }), other: 'stacked' },
  'BarOptions.horizontal': { kind: 'bar', base: line(), other: true },
  'HistogramOptions.normalize': { kind: 'histogram', base: { title: 'T', data: [1, 2, 3, 4].map(v => ({ v })), x: 'v', bins: [0, 2, 4] }, other: 'probability' },
  'ValueField.missing': { kind: 'line', base: line({ data: [...days(2), { day: '2026-03-03', a: null }, ...days(5).slice(3)], y: { field: 'a' } }), at: ['y', 'missing'], other: 'zero' },
  'ValueField.label': { kind: 'line', base: line({ y: { field: 'a' } }), at: ['y', 'label'], explicit: 'a', other: 'Sessions' },
  'XField.ordered': { kind: 'bar', base: { title: 'T', data: Array.from({ length: 60 }, (_, i) => ({ k: `Category number ${i + 1}`, v: i })), x: { field: 'k' }, y: 'v' }, at: ['x', 'ordered'], other: true },
  'XField.timeZone': { kind: 'line', base: { title: 'T', data: [0, 1, 2].map(i => ({ t: Date.UTC(2026, 2, 1, 12) + i * 3_600_000, a: i })), x: { field: 't', type: 'time' }, y: 'a' }, at: ['x', 'timeZone'], other: 'UTC', zone: 'America/Los_Angeles' },
  'XField.label': { kind: 'line', base: { title: 'T', data: [1, 2, 3].map(i => ({ n: i, a: i })), x: { field: 'n' }, y: 'a' }, at: ['x', 'label'], explicit: 'n', other: 'Number' },
  'ScatterXField.timeZone': { kind: 'scatter', base: { title: 'T', data: [0, 1, 2].map(i => ({ t: Date.UTC(2026, 2, 1, 12) + i * 3_600_000, a: i })), x: { field: 't', type: 'time' }, y: 'a' }, at: ['x', 'timeZone'], other: 'UTC', zone: 'America/Los_Angeles' },
  'ScatterXField.label': { kind: 'scatter', base: { title: 'T', data: [1, 2, 3].map(i => ({ n: i, a: i })), x: { field: 'n' }, y: 'a' }, at: ['x', 'label'], explicit: 'n', other: 'Number' },
  'AppendOptions.keep': { kind: 'line', base: line(), explicit: 1000, other: 2, append: [{ day: '2026-03-06', a: 6, b: 4 }] },
};
/** Described defaults that a probe above exercises, with the explicit value standing for the words. */
const DESCRIBED = new Map([
  ['CommonOptions.locale', "the document's language"],
  ['CommonOptions.messages', 'built-in English'],
  ['ValueField.label', 'the field name'],
  ['XField.label', 'the field name'],
  ['ScatterXField.label', 'the field name'],
  ['AppendOptions.keep', 'every row'],
]);
/** Described defaults no probe can pin to one value, with the reason. Every other default must be probed. */
const NOT_PROBED: Record<string, string> = {
  none: 'no default: the feature is off until given',
  required: 'checked against the types by options.test.ts',
  inferred: 'depends on the data; the rule is on the data page and its examples',
  'from the data': 'depends on the data',
  automatic: 'depends on the data (Freedman–Diaconis / Sturges binning)',
  'from the kind of x': 'depends on the kind of x',
};
/** Described defaults that are rules rather than values: checked by reading the text the chart writes. */
const RULES: Record<string, { data: number[]; read: 'ticks' | 'value'; expect: string[]; not?: string[] }[]> = {
  'ValueField.format': [
    { data: [123456.75, 1], read: 'value', expect: ['123,456.75'] },
    { data: [0.000123456, 1], read: 'value', expect: ['0.000123456'] },
  ],
  'ValueField.tickFormat': [
    { data: [0, 50000], read: 'ticks', expect: ['50,000'], not: ['K'] },
    { data: [0, 2000000], read: 'ticks', expect: ['2M'] },
  ],
};

function documentedDefaults(): { id: string; def: string; literal: boolean }[] {
  const source = fs.readFileSync(path.join(docsRoot, 'pages/options.md'), 'utf8').split('\n');
  const out: { id: string; def: string; literal: boolean }[] = [];
  for (let i = 0; i < source.length; i++) {
    const marker = /^<!-- options: (\w+) -->$/.exec(source[i]!.trim());
    if (!marker || !source[i + 1]!.includes('| Default |')) continue;
    for (let j = i + 3; j < source.length && source[j]!.startsWith('|'); j++) {
      const cells = source[j]!.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
      const key = /^`([^`]+)`$/.exec(cells[0]!)![1]!;
      const def = cells[2]!;
      const literal = /^`([^`]+)`$/.exec(def);
      out.push({ id: `${marker[1]}.${key}`, def: literal ? literal[1]! : def, literal: !!literal });
    }
  }
  return out;
}

const defaults = documentedDefaults();
let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;

beforeAll(async () => {
  await buildSite();
  server = await serve(path.join(docsRoot, 'dist'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/** The options of `probe` with the option set to `value`, or left out when `value` is the symbol OMIT. */
const OMIT = '\u0000omit';
function withOption(probe: Probe, key: string, value: unknown): Record<string, unknown> {
  const options = structuredClone(probe.base);
  if (value === OMIT) return options;
  const at = probe.at ?? [key];
  if (at.length === 1) options[at[0]] = value;
  else (options[at[0]] as Record<string, unknown>)[at[1]] = value;
  return options;
}

async function signature(probe: Probe, key: string, value: unknown): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 700, height: 700 }, locale: 'en-US', timezoneId: probe.zone ?? 'UTC' });
  const page = await context.newPage();
  await page.goto(server.url('examples/script-tag.html'));
  const options = withOption(probe, probe.append ? 'title' : key, probe.append ? OMIT : value);
  const out = await page.evaluate(async ({ kind, options, append, appendValue, appendKey, lang, throws }) => {
    if (lang) document.documentElement.lang = lang;
    document.body.replaceChildren();
    const target = document.createElement('div');
    target.style.width = '640px';
    document.body.append(target);
    const lib = (window as unknown as { Axylo: Record<string, (t: Element, o: object) => { append(r: unknown[], o?: object): void }> }).Axylo;
    let chart;
    try {
      chart = lib[kind]!(target, options);
    } catch {
      return 'threw';
    }
    if (throws) return 'no throw';
    if (append) chart.append(append, appendValue === '\u0000omit' ? undefined : { [appendKey]: appendValue });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return '';
  }, { kind: probe.kind, options, append: probe.append ?? null, appendValue: value, appendKey: key, lang: probe.lang ?? null, throws: !!probe.throws });
  if (out) { await context.close(); return out; }
  if (probe.hover) {
    const box = await page.locator('.axylo-plot').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(100);
  const html = await page.evaluate(() => document.querySelector('figure')!.outerHTML
    .replace(/axylo-(?:clip-)?\d+/g, 'axylo-#')
    .replace(/\s(?:style|d|x|y|width|height|transform|points|x1|x2|y1|y2|cx|cy|r)="[^"]*"/g, m => m.replace(/\d+\.\d+/g, n => Number(n).toFixed(1))));
  await context.close();
  return html;
}

describe('documented defaults are what the chart does without the option', () => {
  it('every default is probed or has a stated reason not to be', () => {
    const unexplained = defaults.filter(d => !(d.id in PROBES) && !(d.id in RULES) && !(d.def in NOT_PROBED));
    expect(unexplained).toEqual([]);
    for (const id of Object.keys(PROBES)) expect(defaults.some(d => d.id === id), `${id} is in the reference`).toBe(true);
  });

  it.each(Object.entries(RULES))('%s follows its documented rule', async (_id, cases) => {
    for (const c of cases) {
      const context = await browser.newContext({ viewport: { width: 700, height: 700 }, locale: 'en-US' });
      const page = await context.newPage();
      await page.goto(server.url('examples/script-tag.html'));
      const text = await page.evaluate(async ({ data, read }) => {
        document.documentElement.lang = 'en-US';
        document.body.replaceChildren();
        const target = document.createElement('div');
        document.body.append(target);
        (window as unknown as { Axylo: { line(t: Element, o: object): unknown } }).Axylo.line(target, {
          title: 'T', data: data.map((v, i) => ({ day: `2026-03-0${i + 1}`, v })), x: 'day', y: 'v',
        });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (read === 'ticks') return [...document.querySelectorAll('[data-role="tick-y"]')].map(e => e.textContent).join(' ');
        const proxy = document.querySelector('.axylo-proxy') as HTMLElement;
        return proxy.getAttribute('aria-valuetext') ?? '';
      }, c);
      for (const part of c.expect) expect(text, JSON.stringify(c.data)).toContain(part);
      for (const part of c.not ?? []) expect(text, JSON.stringify(c.data)).not.toContain(part);
      await context.close();
    }
  }, 60_000);

  it.each(defaults.filter(d => d.id in PROBES).map(d => [d.id, d] as const))('%s', async (id, d) => {
    const probe = PROBES[id]!;
    const key = id.split('.')[1]!;
    if (!d.literal) expect(DESCRIBED.get(id), `${id}: the described default`).toBe(d.def);
    const explicit = d.literal ? JSON.parse(d.def.replace(/'/g, '"')) : probe.explicit;
    const omitted = await signature(probe, key, OMIT);
    const given = await signature(probe, key, explicit);
    const other = await signature(probe, key, probe.other);
    expect(given === omitted, `${id}: left out equals ${d.def}`).toBe(true);
    expect(other === omitted, `${id}: ${JSON.stringify(probe.other)} differs, so the comparison can fail`).toBe(false);
  }, 60_000);
});
