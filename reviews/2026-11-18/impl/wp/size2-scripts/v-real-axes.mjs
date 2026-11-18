// Class (b) calibration: a real per-shape split of core/axes.ts (aligned vs scatter), carried by the composition,
// built for every kind (so "everything" is meaningful). Compare with the axes-only oracle.
import fs from 'node:fs';
import path from 'node:path';
import { edit, variant } from './lib.mjs';

const d = variant(process.argv[2] ?? 'real-axes', process.argv[3] ?? 'base');
const p = path.join(d, 'core/axes.ts');
let t = fs.readFileSync(p, 'utf8');
const cut = (from, to) => { const a = t.indexOf(from), b = t.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`cut ${from}`); t = t.slice(0, a) + t.slice(b); };

edit(d, 'core/axes.ts', [[
  '  readonly valueTitle: string;\n}',
  `  readonly valueTitle: string;
  /** The frame shape's part of the axes (the chart kind's composition). */
  readonly axes: AxisOps;
}

type Cartesian = Exclude<View, { kind: 'donut' }>;
/** What differs between aligned and scatter axes. */
export interface AxisOps {
  parts(view: Cartesian, ctx: AxisContext): AxisParts;
  extent(view: Cartesian, take: (v: number) => void): void;
  titles(view: Cartesian, ctx: AxisContext): { x: string | undefined; y: string | undefined };
  key(view: Cartesian, base: unknown[]): void;
}`]]);
t = fs.readFileSync(p, 'utf8');

// buildAxisParts → yAxis (shared) + alignedParts / scatterParts
cut('function buildAxisParts(', '/**\n * What scatter\'s automatic x domain');
cut('function scanExtent(', '/**\n * The candidate tick sets');
cut('/** The axis titles layout draws', '/** Spec L6: a number x is a measure');
t = t.replace("const entry = { key, parts: view.kind === 'donut' ? {} : buildAxisParts(view, local), failed: [...failed] };",
  "const entry = { key, parts: view.kind === 'donut' ? {} : ctx.axes.parts(view, local), failed: [...failed] };");
t = t.replace('  const extent = scanExtent(view);', '  const extent = scanExtent(view, ctx.axes);');
t = t.replace('export function valueExtent(view: Exclude<View, { kind: \'donut\' }>): Span | null {', 'export function valueExtent(view: Exclude<View, { kind: \'donut\' }>, ctx: AxisContext): Span | null {');
t = t.replace('  const extent = value?.domain ? null : valueExtent(view);\n  base.push(extent?.[0], extent?.[1]);', '  const extent = value?.domain ? null : valueExtent(view, ctx);\n  base.push(extent?.[0], extent?.[1]);');
t = t.replace('  const titles = axisTitles(view, ctx);\n  base.push(titles.x, titles.y);', '  const titles = axisTitles(view, ctx);\n  base.push(titles.x, titles.y);\n  ctx.axes.key(view, base);\n  return base;\n}\n\nfunction unusedKeyTail(view: Exclude<View, { kind: \'donut\' }>, base: unknown[]): unknown[] {');
t = t.replace(`  if (view.kind === 'scatter') {
    // The x extent chooses among the x tick sets of an automatic domain, as the value extent does for y.
    const xExtent = scatterXExtent(view);
    base.push(view.frame.xKind, view.frame.timeZone, view.frame.xLabel, view.frame.yLabel, xExtent?.[0], xExtent?.[1]);
    return base;
  }
  const column = view.frame.x;
  // No slot indexes: layout reads domains, categories and labels only, never which slots are visible.
  base.push(column.kind, column.timeZone, column.dateUnit, column.ordered, view.frame.xLabel, view.frame.yLabel,
    view.horizontal, column.categories);
  for (const s of view.frame.series) base.push(s.valueScale);
  return base;
}`, `  return base;
}`);

t += `
function yAxis(view: Cartesian, ctx: AxisContext, valueScale: 'percent' | 'ratio' | null, title: string | undefined) {
  const value = ctx.resolved.values[0];
  const yOption = value?.tickFormat ?? null;
  const onYError = (e: unknown) => ctx.onFormatterError(value?.field ?? 'y', e);
  const all = numberTicks(view.yDomain, ctx.locale, yOption, valueScale, onYError);
  const extent = value?.domain ? null : valueExtent(view, ctx);
  const full = valueScale === 'percent' ? 100 : valueScale === 'ratio' ? 1 : null;
  return {
    domain: view.yDomain,
    candidates: extent ? endingCandidates(all, view.yDomain, extent, valueScale) : all,
    coarser: extent ? coarserDomains(extent[0], extent[1], view.yDomain, full !== null && view.yDomain[1] === full).map(domain => ({
      domain, candidates: endingCandidates(numberTicks(domain, ctx.locale, yOption, valueScale, onYError), domain, extent, valueScale),
    })) : undefined,
    title, mayThin: true,
  };
}

function axisTitles(view: Cartesian, ctx: AxisContext): { x: string | undefined; y: string | undefined } {
  return ctx.compact ? { x: undefined, y: undefined } : ctx.axes.titles(view, ctx);
}

function scanExtent(view: Cartesian, ops: AxisOps): Span | null {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (v: number) => { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  ops.extent(view, take);
  for (const r of view.references) if (r.axis === 'y') { take(r.from); take(r.to); }
  return lo <= hi ? [lo, hi] : null;
}

type Aligned = Extract<View, { kind: 'line' | 'area' | 'bar' }>;
type Scatter = Extract<View, { kind: 'scatter' }>;

export const ALIGNED_AXES: AxisOps = {
  parts(v, ctx) {
    const view = v as Aligned;
    const visibleSeries = view.frame.series.filter((_, i) => view.visible[i]);
    const firstScale = 'valueScale' in (visibleSeries[0] ?? {}) ? (visibleSeries[0] as { valueScale: 'percent' | 'ratio' | null }).valueScale : null;
    const valueScale = visibleSeries.every(s => (s as { valueScale: unknown }).valueScale === firstScale) ? firstScale : null;
    const titles = axisTitles(view, ctx);
    const y = yAxis(view, ctx, valueScale, titles.y);
    const column = view.frame.x;
    const xTitle = titles.x;
    const references = view.references;
    const onXError = (e: unknown) => ctx.onFormatterError(ctx.resolved.x.field, e);
    if (column.kind === 'category') {
      const labels = categoryLabels(column.categories ?? [], ctx.resolved.x.tickFormat, onXError);
      const x = {
        type: 'band' as const, count: labels.length, padding: view.kind === 'bar' ? 0.2 : 0,
        candidates: bandTickCandidates(labels), mayThin: column.ordered, title: xTitle,
      };
      return view.kind === 'bar'
        ? { kind: 'bands', horizontal: view.horizontal, x, y, references }
        : { kind: 'xy', x, y, references };
    }
    const x = { ...continuousX(column.kind, view.xDomain, column.timeZone, column.dateUnit, ctx), title: xTitle };
    return view.kind === 'bar'
      ? { kind: 'bands', horizontal: view.horizontal, x, y, references }
      : { kind: 'xy', x, y, references };
  },
  extent(v, take) {
    const view = v as Aligned;
    if (view.stack) {
      const top = view.stack.positive.at(-1);
      const bottom = view.stack.negative.at(-1);
      const { start, end } = view.kind === 'bar' ? view.drawSlots[0] ?? view.visibleSlots : view.visibleSlots;
      for (let j = start; j < end; j++) { if (top) take(top[j]!); if (bottom) take(bottom[j]!); }
    } else {
      view.frame.series.forEach((s, i) => {
        if (!view.visible[i]) return;
        const { start, end } = view.kind === 'bar' ? view.drawSlots[i] ?? view.visibleSlots : view.visibleSlots;
        for (let j = start; j < end; j++) if (s.slot[j] === 0) take(s.y[j]!);
      });
    }
    if (view.kind === 'bar' || view.kind === 'area') take(0);
  },
  titles(v, ctx) {
    const view = v as Aligned;
    return {
      x: xTitled(view.frame.x.kind, ctx) ? withUnit(view.frame.xLabel, ctx.resolved.x.unit) : undefined,
      y: withUnit(view.frame.yLabel ?? alignedValueTitle(view.frame.series, ctx.valueTitle), sharedUnit(view.frame.series)),
    };
  },
  key(v, base) {
    const view = v as Aligned;
    const column = view.frame.x;
    // No slot indexes: layout reads domains, categories and labels only, never which slots are visible.
    base.push(column.kind, column.timeZone, column.dateUnit, column.ordered, view.frame.xLabel, view.frame.yLabel,
      view.horizontal, column.categories);
    for (const s of view.frame.series) base.push(s.valueScale);
  },
};

export const SCATTER_AXES: AxisOps = {
  parts(v, ctx) {
    const view = v as Scatter;
    const titles = axisTitles(view, ctx);
    const y = yAxis(view, ctx, ctx.resolved.values[0]?.scale ?? null, titles.y);
    const x = continuousX(view.frame.xKind, view.xDomain, view.frame.timeZone, null, ctx);
    const automatic = view.frame.xKind === 'number' && !ctx.resolved.x.domain &&
      view.xDomain[0] === view.xFull[0] && view.xDomain[1] === view.xFull[1];
    const xExtent = automatic ? scatterXExtent(view) : null;
    const candidates = xExtent ? endingCandidates(x.candidates, view.xDomain, xExtent, null) : x.candidates;
    const coarser = xExtent ? coarserDomains(xExtent[0], xExtent[1], view.xDomain).map(domain => ({
      domain, candidates: endingCandidates(continuousX('number', domain, null, null, ctx).candidates, domain, xExtent, null),
    })) : undefined;
    return { kind: 'xy', x: { ...x, candidates, coarser, title: titles.x }, y, references: view.references };
  },
  extent(v, take) {
    const view = v as Scatter;
    view.frame.series.forEach((s, i) => {
      if (!view.visible[i]) return;
      const { start, end } = view.visiblePoints[i]!;
      for (let j = start; j < end; j++) take(s.y[j]!);
    });
  },
  titles(v, ctx) {
    const view = v as Scatter;
    return {
      x: xTitled(view.frame.xKind, ctx) ? withUnit(view.frame.xLabel, view.frame.xUnit) : undefined,
      y: withUnit(view.frame.yLabel, view.frame.yUnit),
    };
  },
  key(v, base) {
    const view = v as Scatter;
    const xExtent = scatterXExtent(view);
    base.push(view.frame.xKind, view.frame.timeZone, view.frame.xLabel, view.frame.yLabel, xExtent?.[0], xExtent?.[1]);
  },
};
`;
// the scrap left between key() and the end of layoutKey
t = t.replace(/\nfunction unusedKeyTail\([^]*?\n\}\n/, '\n');
fs.writeFileSync(p, t);

edit(d, 'core/composition.ts', [["import type { SvgMarks } from '../render/svg';", "import type { SvgMarks } from '../render/svg';\nimport type { AxisOps } from './axes';"],
  ['  readonly lookup: LookupBuilder;', '  readonly lookup: LookupBuilder;\n  /** The frame shape\'s axes; null for donut, which has none. */\n  readonly axes: AxisOps | null;']]);
for (const [k, ops] of [['line', 'ALIGNED_AXES'], ['area', 'ALIGNED_AXES'], ['bar', 'ALIGNED_AXES'], ['scatter', 'SCATTER_AXES'], ['donut', 'null']]) {
  const name = k.toUpperCase();
  edit(d, `kinds/${k}.ts`, [[`export const ${name}: Composition = {\n  kind: '${k}',`, `export const ${name}: Composition = {\n  kind: '${k}',\n  axes: ${ops},`]]);
  if (ops !== 'null') edit(d, `kinds/${k}.ts`, [["import type { Composition } from '../core/composition';", `import type { Composition } from '../core/composition';\nimport { ${ops} } from '../core/axes';`]]);
}
edit(d, 'core/controller.ts', [['      valueTitle: a.messages.value,\n    };', '      valueTitle: a.messages.value, axes: composition.axes!,\n    };']]);
