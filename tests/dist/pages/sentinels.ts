/**
 * Author text for the text-insertion tests (spec DX8: labels and formatter output are inserted as text, never
 * as HTML). Each text source on each chart type gets its own sentinel: inert markup (`<u data-axs="id">…</u>`)
 * that would become a `u` element carrying `data-axs` if anything parsed it, and whose literal text names its
 * source, so one surface cannot vouch for another.
 */
export const S = (id: string, body: string = id): string => `<u data-axs="${id}">${body}</u>`;

export type Kind = 'line' | 'area' | 'bar' | 'scatter' | 'donut';
export const KINDS: Kind[] = ['line', 'area', 'bar', 'scatter', 'donut'];

/** The sources each chart type takes, by name; the value is the sentinel id. Formatters wrap the value. */
export const SOURCES: Record<Kind, Record<string, string>> = {
  line: { title: 'l-title', subtitle: 'l-sub', description: 'l-desc', series: 'l-ser', xLabel: 'l-xl', yLabel: 'l-yl', unit: 'l-u', xFormat: 'l-xf', yFormat: 'l-yf', yTick: 'l-yt' },
  area: { title: 'a-title', subtitle: 'a-sub', description: 'a-desc', series: 'a-ser', xLabel: 'a-xl', yLabel: 'a-yl', unit: 'a-u', xFormat: 'a-xf', yFormat: 'a-yf', yTick: 'a-yt' },
  bar: { title: 'b-title', subtitle: 'b-sub', description: 'b-desc', series: 'b-ser', category: 'b-cat', xLabel: 'b-xl', yLabel: 'b-yl', unit: 'b-u', yFormat: 'b-yf', yTick: 'b-yt' },
  scatter: { title: 's-title', subtitle: 's-sub', description: 's-desc', series: 's-ser', xLabel: 's-xl', yLabel: 's-yl', unit: 's-u', xFormat: 's-xf', yFormat: 's-yf', xTick: 's-xt', yTick: 's-yt' },
  donut: { title: 'd-title', subtitle: 'd-sub', description: 'd-desc', category: 'd-cat', yLabel: 'd-yl', unit: 'd-u', yFormat: 'd-yf' },
};

type Make = (target: string, options: Record<string, unknown>) => unknown;
export type Library = Record<Kind, Make>;

const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];

/** The scatter's x for row `i` (why these values: see the scatter case of optionsFor). */
export const scatterSize = (i: number): number => Math.round((100 * i) / 11);

/** The options for one chart type, every source filled with its sentinel. */
export function optionsFor(kind: Kind, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const s = SOURCES[kind];
  const id = (k: string) => s[k]!;
  const common = { title: S(id('title')), subtitle: S(id('subtitle')), description: S(id('description')) };
  const y = (field: string) => ({
    field, label: S(id('yLabel')), unit: S(id('unit')), format: (v: number) => S(id('yFormat'), String(v)),
    ...(s.yTick ? { tickFormat: (v: number) => S(id('yTick'), String(v)) } : {}),
  });
  switch (kind) {
    case 'line':
    case 'area': {
      const data = days.flatMap((day, i) => [S(id('series')), 'Plain'].map((channel, c) => ({ day, channel, visits: 100 + 10 * i + 50 * c })));
      return { ...common, data, series: 'channel', x: { field: 'day', label: S(id('xLabel')), format: (v: unknown) => S(id('xFormat'), String(v instanceof Date ? v.toISOString().slice(0, 10) : v)) }, y: y('visits'), ...(kind === 'area' ? { stacked: true } : {}), ...extra };
    }
    case 'bar': {
      const data = [S(id('category')), 'North', 'South'].flatMap((region, i) => [S(id('series')), 'Plain'].map((year, c) => ({ region, year, revenue: 300 + 40 * i + 25 * c })));
      return { ...common, data, series: 'year', x: { field: 'region', label: S(id('xLabel')) }, y: y('revenue'), ...extra };
    }
    case 'scatter': {
      // x runs from 0 to 100 exactly. An automatic numeric x domain ends on drawn ticks (spec F7), so the
      // tick sets offered are those whose steps divide [0, 100]; the coarsest, step 50, gives three ticks
      // (0, 50, 100). Each tick label is a whole sentinel of about 26 characters, and three of them fit side
      // by side in the 760 px chart (page.css, .chart.tall), so L1's first remedy (thinning) is enough and
      // no label is wrapped, rotated or truncated. The earlier range, 10 to 65, made the domain [0, 80] with
      // steps 10 and 20 only: five or more labels 134 to 219 px apart, which L1 rotates and then truncates
      // in the middle, cutting the sentinels this test reads whole (read in the built library, d33df71).
      const data = Array.from({ length: 12 }, (_, i) => ({ size: scatterSize(i), latency: 40 + ((i * 7) % 11) * 3, kind: i % 2 ? S(id('series')) : 'Plain' }));
      return {
        ...common, data, series: 'kind',
        x: { field: 'size', label: S(id('xLabel')), format: (v: unknown) => S(id('xFormat'), String(v)), tickFormat: (v: unknown) => S(id('xTick'), String(v)) },
        y: y('latency'), ...extra,
      };
    }
    case 'donut': {
      const data = [{ browser: S(id('category')), share: 45 }, { browser: 'Firefox', share: 30 }, { browser: 'Safari', share: 25 }];
      return { ...common, data, label: 'browser', value: { field: 'share', label: S(id('yLabel')), unit: S(id('unit')), format: (v: number) => S(id('yFormat'), String(v)) }, ...extra };
    }
  }
}

export function makeSentinelCharts(A: Library): void {
  const w = window as unknown as Record<string, unknown>;
  const charts: unknown[] = KINDS.map(kind => A[kind](`#${kind}`, optionsFor(kind)));
  // The compact variant: its name and description are its only text (spec 3.7, C1).
  charts.push(A.line('#compact', { title: S('c-title'), description: S('c-desc'), data: days.map((day, i) => ({ day, v: 3 + i })), x: 'day', y: 'v', compact: true }));
  w.__charts = charts;
}

/** Every built-in message key (public Messages): each replaced by its own sentinel on the messages page. */
export const MESSAGE_KEYS = [
  'viewAsTable', 'hideTable', 'noData', 'noObservation', 'incompleteStack', 'moreRows', 'otherSlices', 'valuesNotShown', 'valuesChanged',
  'labelsHidden', 'loading', 'empty', 'error', 'internalError', 'chartName', 'chartSummary', 'seriesSummary', 'referenceSummary',
  'timeZoneNote', 'plotLabel', 'controlsLabel', 'pointOf', 'zoomIn', 'zoomOut', 'resetZoom', 'pause', 'resume', 'previousPage', 'nextPage',
  'pageOf', 'jumpToX', 'showSeries', 'hideSeries', 'category', 'percentage', 'series', 'value', 'typeLine', 'typeArea', 'typeBar',
  'typeScatter', 'typeDonut', 'donutSummary', 'seriesNoData', 'seriesNotDrawn', 'referenceLine', 'referenceBand', 'plotRole', 'pointAll',
  'seriesValue', 'position', 'total', 'panLeft', 'panRight', 'jumpNotFound', 'plotInstructions', 'seeTable',
] as const;
export const messages = (): Record<string, string> => Object.fromEntries(MESSAGE_KEYS.map(k => [k, S(`m-${k}`)]));

/** Mon–Sun with a NaN, a stray string and an absent value: the Phase 1 dirty fixture, so the reader note shows. */
const dirty = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']
  .map((day, i) => { const v = [10, 20, null, NaN, '40', undefined, 70][i]; return v === undefined ? { day } : { day, value: v }; });

/** The charts of the messages page, by element id: each puts a different set of built-in strings on screen. */
export const MESSAGE_CHARTS = ['line', 'area', 'bar', 'scatter', 'donut', 'untitled', 'loading', 'failed', 'nothing', 'many', 'slices', 'sparse', 'note'] as const;

export function makeMessageCharts(A: Library): void {
  const w = window as unknown as Record<string, unknown>;
  const m = messages();
  const hours = days.map((d, i) => ({ t: Date.parse(`${d}T12:00:00Z`), v: i % 2 ? 5 + i : null }));
  const ten = Array.from({ length: 10 }, (_, s) => days.map((day, i) => ({ day, name: `S${s}`, v: s === 9 ? null : 10 + s + i }))).flat();
  const charts: Record<string, unknown> = {
    line: A.line('#line', { title: 'Dirty', data: dirty, x: 'day', y: 'value', messages: m }),
    area: A.area('#area', optionsFor('area', { messages: m })),
    bar: A.bar('#bar', optionsFor('bar', { messages: m })),
    scatter: A.scatter('#scatter', optionsFor('scatter', { messages: m })),
    donut: A.donut('#donut', optionsFor('donut', { messages: m })),
    // No title (chartName), instants (timeZoneNote), references (line, band), absent values drawn as zero.
    untitled: A.line('#untitled', {
      data: hours, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: { field: 'v', missing: 'zero' }, messages: m,
      reference: [{ y: 8, label: 'Target' }, { y: [6, 7], label: 'Band' }],
    }),
    loading: A.line('#loading', { title: 'Loading', data: [], x: 'day', y: 'v', state: 'loading', messages: m }),
    failed: A.line('#failed', { title: 'Failed', data: [], x: 'day', y: 'v', state: { error: S('src-error') }, messages: m }),
    nothing: A.line('#nothing', { title: 'Nothing', data: [], x: 'day', y: 'v', messages: m }),
    // Ten series, one of them all missing (seriesNoData; more rows than a tooltip lists).
    many: A.line('#many', { title: 'Many', data: ten, x: 'day', y: 'v', series: 'name', messages: m }),
    slices: A.donut('#slices', { title: 'Slices', data: Array.from({ length: 11 }, (_, i) => ({ k: `K${i}`, v: 20 - i })), label: 'k', value: 'v', messages: m }),
    // Series B lacks the middle day: a stack with a missing member.
    sparse: A.area('#sparse', { title: 'Sparse', data: days.flatMap((day, i) => ['A', 'B'].filter(n => !(n === 'B' && i === 2)).map(n => ({ day, n, v: 5 + i }))), x: 'day', y: 'v', series: 'n', stacked: true, messages: m }),
  };
  // The reader note on the dirty input with the built-in template and only {seeTable} replaced.
  charts.note = A.line('#note', { title: 'Note', data: dirty, x: 'day', y: 'value', messages: { seeTable: S('m-seeTable') } });
  (charts.untitled as { zoom(d: unknown): void }).zoom([Date.parse(`${days[1]}T00:00:00Z`), Date.parse(`${days[3]}T00:00:00Z`)]);
  w.__charts = charts;
}
