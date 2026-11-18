/**
 * Hand-written fixtures for the acceptance suite, small enough to check by eye, and the expected reader
 * text derived from them with the platform's own formatters (en-US, the harness locale). Nothing here is
 * taken from what the implementation printed.
 *
 * Copied from research/harness/src/data.js where a Phase 1 fixture is named: `dirty` (the combined bad
 * values) and `bars` (82–97, one long label).
 */

export type ChartType = 'line' | 'area' | 'bar' | 'scatter' | 'donut' | 'compact';
export const TYPES: readonly ChartType[] = ['line', 'area', 'bar', 'scatter', 'donut', 'compact'];
/** Types with the full reader layer (plot proxy, toolbar, table, tooltip). */
export const FULL: readonly ChartType[] = ['line', 'area', 'bar', 'scatter', 'donut'];
/** Cartesian full charts. */
export const CARTESIAN: readonly ChartType[] = ['line', 'area', 'bar', 'scatter'];
/** Charts whose x positions are shared by every series (picking by x / category). */
export const ALIGNED: readonly ('line' | 'area' | 'bar')[] = ['line', 'area', 'bar'];

export type Variant = 'default' | 'dirty' | 'instants' | 'stacked';

export const number = (v: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(v);
/** A readout value: the full number, then the unit (reading: separated by one space). */
export const withUnit = (v: number, unit: string): string => `${number(v)} ${unit}`;
/** Calendar dates as readouts show them (reading: the en-US medium date). */
export const calendar = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(Date.parse(`${iso}T00:00:00Z`));

// ── line and area: energy by site over five calendar days ─────────────────────────────────────────

export const ENERGY = {
  title: 'Energy use by site',
  days: ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'],
  series: [
    { name: 'North', values: [12, 15, 11, 18, 16] },
    { name: 'South', values: [7, 9, 13, 8, 10] },
  ],
  label: 'Energy',
  unit: 'kWh',
};
export const energyRows = (): Record<string, unknown>[] =>
  ENERGY.series.flatMap(s => s.values.map((v, i) => ({ day: ENERGY.days[i], site: s.name, energy: v })));

// ── bar: shipments per quarter, two series, category x ────────────────────────────────────────────

export const SHIPPED = {
  title: 'Shipments per quarter',
  quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Plan', values: [40, 45, 50, 55] },
    { name: 'Actual', values: [38, 47, 52, 49] },
  ],
  label: 'Shipped',
  unit: 't',
};
export const shippedRows = (): Record<string, unknown>[] =>
  SHIPPED.series.flatMap(s => s.values.map((v, i) => ({ quarter: SHIPPED.quarters[i], kind: s.name, shipped: v })));

// ── scatter: latency by payload, two regions, one shared x (20 kB) ────────────────────────────────

export const LATENCY = {
  title: 'Latency by payload size',
  points: [
    { size: 10, latency: 120, region: 'EU' }, { size: 20, latency: 140, region: 'EU' }, { size: 30, latency: 135, region: 'EU' },
    { size: 15, latency: 90, region: 'US' }, { size: 20, latency: 100, region: 'US' }, { size: 35, latency: 95, region: 'US' },
  ],
  x: { label: 'Payload', unit: 'kB' },
  y: { label: 'Latency', unit: 'ms' },
};
/** Keyboard order for scatter (spec 3.6): by x, then y. Ties at x = 20 go to the lower y (US 100 before EU 140). */
export const LATENCY_ORDER = [...LATENCY.points].sort((a, b) => a.size - b.size || a.latency - b.latency);

// ── donut: monthly spend, four slices, shares 50 / 25 / 15 / 10 % ─────────────────────────────────

export const SPEND = {
  title: 'Monthly spend',
  items: ['Rent', 'Food', 'Travel', 'Books'],
  values: [1200, 600, 360, 240],
  label: 'Spend',
  unit: 'EUR',
};
export const SPEND_TOTAL = SPEND.values.reduce((a, b) => a + b, 0);
export const share = (v: number, total = SPEND_TOTAL): string =>
  new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(v / total);

// ── the Phase 1 `dirty` fixture (research/harness/src/data.js) ─────────────────────────────────────

/** Mon–Sun: 10, 20, null, NaN, '40', undefined, 70. Left out by a warning: Thu (NaN), Fri ('40'), Sat (absent). */
export const DIRTY = {
  categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  values: [10, 20, null, NaN, '40', undefined, 70] as unknown[],
  leftOut: 3,
};
/** Rows as a page would build them; NaN does not survive JSON, so the page rebuilds it (see `dirtyOptions`). */
export const dirtyRows = (): Record<string, unknown>[] => DIRTY.categories.map((day, i) =>
  DIRTY.values[i] === undefined ? { day } : { day, value: Number.isNaN(DIRTY.values[i]) ? '__NaN__' : DIRTY.values[i] });

/** Values arrive in the page through JSON; '__NaN__' is turned back into NaN there (see util `create`). */
export const NAN = '__NaN__';

/** The options for each chart type (development and production alike). */
export function optionsFor(type: ChartType, variant: Variant = 'default'): { fn: string; options: Record<string, unknown> } {
  if (variant === 'dirty') return dirtyOptions(type);
  if (variant === 'instants') return instantOptions(type);
  switch (type) {
    case 'line':
    case 'area':
    case 'compact':
      return {
        fn: type === 'compact' ? 'line' : type,
        options: {
          title: ENERGY.title, data: type === 'compact' ? energyRows().filter(r => r.site === 'North') : energyRows(),
          x: { field: 'day', type: 'date' }, y: { field: 'energy', label: ENERGY.label, unit: ENERGY.unit },
          ...(type === 'compact' ? { compact: true } : { series: 'site' }),
          ...(variant === 'stacked' && type === 'area' ? { stacked: true } : {}),
        },
      };
    case 'bar':
      return {
        fn: 'bar',
        options: {
          title: SHIPPED.title, data: shippedRows(), x: 'quarter', y: { field: 'shipped', label: SHIPPED.label, unit: SHIPPED.unit }, series: 'kind',
          ...(variant === 'stacked' ? { layout: 'stacked' } : {}),
        },
      };
    case 'scatter':
      return {
        fn: 'scatter',
        options: {
          title: LATENCY.title, data: LATENCY.points, x: { field: 'size', ...LATENCY.x }, y: { field: 'latency', ...LATENCY.y }, series: 'region',
        },
      };
    case 'donut':
      return {
        fn: 'donut',
        options: {
          title: SPEND.title, data: SPEND.items.map((item, i) => ({ item, spend: SPEND.values[i] })), label: 'item',
          value: { field: 'spend', label: SPEND.label, unit: SPEND.unit },
        },
      };
  }
}

function dirtyOptions(type: ChartType): { fn: string; options: Record<string, unknown> } {
  const title = `Dirty input (${type})`;
  if (type === 'scatter') {
    // The same seven values as y over x = 1…7.
    return { fn: 'scatter', options: { title, data: dirtyRows().map((r, i) => ({ ...r, n: i + 1 })), x: 'n', y: 'value' } };
  }
  if (type === 'donut') return { fn: 'donut', options: { title, data: dirtyRows(), label: 'day', value: 'value' } };
  return { fn: type === 'compact' ? 'line' : type, options: { title, data: dirtyRows(), x: 'day', y: 'value', ...(type === 'compact' ? { compact: true } : {}) } };
}

/** Instants (epoch ms, `type: 'time'`) shown in Asia/Kolkata: the summary must name the zone (spec A1, F4). */
export const ZONE = 'Asia/Kolkata';
/** Names Chrome's Intl may give that zone, any of which says which zone the times are in. */
export const ZONE_NAMES = ['Asia/Kolkata', 'India Standard Time', 'GMT+5:30', 'IST'];
const DAY = 864e5;
const T0 = Date.UTC(2026, 2, 2);
function instantOptions(type: ChartType): { fn: string; options: Record<string, unknown> } {
  const x = { field: 'at', type: 'time', timeZone: ZONE };
  if (type === 'scatter') {
    return { fn: 'scatter', options: { title: 'Instants', data: [0, 1, 2].map(i => ({ at: T0 + i * DAY, v: 10 + i })), x, y: 'v' } };
  }
  return {
    fn: type === 'compact' ? 'line' : type,
    options: { title: 'Instants', data: [0, 1, 2].map(i => ({ at: T0 + i * DAY, v: 10 + i })), x, y: 'v', ...(type === 'compact' ? { compact: true } : {}) },
  };
}

/** What the generated name names (spec A1: "Line chart of Sessions by Day"): the type and the measure. */
export const TYPE_WORD: Record<ChartType, string> = { line: 'Line', area: 'Area', bar: 'Bar', scatter: 'Scatter', donut: 'Donut', compact: 'Line' };

/** The expected summary statements of each default fixture (spec A1), as text fragments in order. */
export function summaryFragments(type: ChartType): string[][] {
  switch (type) {
    case 'line':
    case 'area':
      return [
        [TYPE_WORD[type]],
        [calendar(ENERGY.days[0]!), calendar(ENERGY.days.at(-1)!)],
        [withUnit(7, ENERGY.unit), withUnit(18, ENERGY.unit)],
        ['North', withUnit(11, 'kWh'), withUnit(18, 'kWh'), withUnit(16, 'kWh')],
        ['South', withUnit(7, 'kWh'), withUnit(13, 'kWh'), withUnit(10, 'kWh')],
      ];
    case 'compact':
      return [
        ['Line'],
        [calendar(ENERGY.days[0]!), calendar(ENERGY.days.at(-1)!)],
        [withUnit(11, ENERGY.unit), withUnit(18, ENERGY.unit)],
        // One series without a series field: it is named by the value field's label.
        [ENERGY.label, withUnit(11, 'kWh'), withUnit(18, 'kWh'), withUnit(16, 'kWh')],
      ];
    case 'bar':
      return [
        ['Bar'],
        ['Q1', 'Q4'],
        [withUnit(38, 't'), withUnit(55, 't')],
        ['Plan', withUnit(40, 't'), withUnit(55, 't'), withUnit(55, 't')],
        ['Actual', withUnit(38, 't'), withUnit(52, 't'), withUnit(49, 't')],
      ];
    case 'scatter':
      // "Last" on a scatter is the point with the largest x (reading: x order, as the keyboard walks it).
      return [
        ['Scatter'],
        [withUnit(10, 'kB'), withUnit(35, 'kB')],
        [withUnit(90, 'ms'), withUnit(140, 'ms')],
        ['EU', withUnit(120, 'ms'), withUnit(140, 'ms'), withUnit(135, 'ms')],
        ['US', withUnit(90, 'ms'), withUnit(100, 'ms'), withUnit(95, 'ms')],
      ];
    case 'donut':
      // A donut has no x or y range; its summary is the type and each slice's value and share (reading).
      return [
        ['Donut'],
        ...SPEND.items.map((item, i) => [item, withUnit(SPEND.values[i]!, SPEND.unit), share(SPEND.values[i]!)]),
      ];
  }
}

/** Whether `text` contains every fragment of `group` in order. */
export function inOrder(text: string, group: readonly string[]): boolean {
  let at = 0;
  for (const part of group) {
    const i = text.indexOf(part, at);
    if (i < 0) return false;
    at = i + part.length;
  }
  return true;
}
