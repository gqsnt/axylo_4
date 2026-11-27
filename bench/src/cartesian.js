// The `axylo/cartesian` workload of RFC C4.1 §8: 100,000 points per series on one time axis, for the paired Chrome
// comparison of first draw, zoom p95 and hover p95 against the root `line` chart (first-1x100000, zoom-1x100000,
// hover-1x100000). Pure: runs in Node (the runner derives the expected readback from it) and in the page.
//
// Two layouts:
//   'line'      one line on one linear axis. Its columns are byte-for-byte lineFixture({ series: 1, points, seed }),
//               the root baseline's fixture, so a paired run measures only what the Cartesian entry adds (its
//               layout, scene with F5 decimation, lookup) on identical data. Checksum-identical to the baseline.
//   'line+bar'  the RFC workload: the same line on the left linear axis plus one bar series of the same length on
//               a right linear axis (bars need F1's zero baseline, so not log). Only axylo/cartesian draws it, so it
//               has no matched root baseline: its genuine A/B is two builds of axylo/cartesian (two-build mode,
//               --adapter axylo-cartesian --kind cartesian). A line-only root session recorded separately is a
//               different fixture and is never a matched-fixture comparison for it.
//
// How it is wired (all in bench/src; bench/build.mjs and bench/run.mjs are unchanged):
//   - src/adapters/axylo-cartesian.js is an ordinary adapter, built into every artifact like the others. It does not
//     bundle the library: load() imports the artifact's own axylo/axylo-cartesian.bench.js at run time, so its bytes
//     (harness, hashed in every artifact) are the same whatever library source an artifact was built from.
//   - src/cartesian-artifact.mjs builds a sealed artifact that holds that bundle: bench/build.mjs's build() makes the
//     ordinary artifact first (in a staging directory), then a new directory receives a copy of it plus
//     axylo/axylo-cartesian.bench.js, compiled from the same source snapshot with the same recipe (scripts/build.mjs
//     PRODUCTION with __BENCH__ true, the stylesheet plugin), and a new manifest that lists every file, the bundle,
//     the union of the Axylo inputs (any input both builds read must hash the same) and the staging artifact it was
//     derived from. Nothing is edited in place; readArtifact() verifies the result like any artifact.
//   - an artifact built by plain bench/build.mjs has no Cartesian bundle: the adapter then reports "unavailable"
//     with the import error, and admission refuses it as for any library that cannot draw a workload.
//   - workloads: `--workload first|zoom|hover --size 1x100000` without --kind is the identical one-line pair
//     (baseline axylo-svg, candidate axylo-cartesian, same fixture checksum); `--kind cartesian` is the dual-axis
//     line + bar workload (multichart.js cartesianParams, fixtures.js cartesianFixture), drawn by axylo-cartesian only.
//
import { cartesianFixture, parseSize } from './fixtures.js';
import { cartesianWorkloads } from './multichart.js';
import { axyloAdapter } from './adapters/axylo-common.js';

export const CARTESIAN_LAYOUTS = ['line', 'line+bar'];
export { cartesianFixture };

/** The workloads the comparison needs, in the runner's shape: one fixture per chart. */
export function cartesianWorkloadData(workload, params = {}) {
  if (!cartesianWorkloads.includes(workload)) throw new Error(`${workload} is not available for cartesian`);
  const { points } = parseSize(params.size ?? '1x100000');
  return [cartesianFixture({ points, layout: params.layout ?? 'line+bar', seed: params.seed ?? 1 })];
}

/**
 * The `cartesian()` options for a fixture, from the options the root adapter would give `line()`: the same title,
 * data columns, time x axis and renderer switch, with the series placed on declared axes instead of `y`.
 */
export function cartesianOptions(fix, lineOptions) {
  const { y: _y, ...common } = lineOptions;
  const [line, bars] = fix.names;
  const axes = { value: { position: 'left' } };
  const layers = [{ type: 'line', y: line, yAxis: 'value' }];
  if (fix.cartesian?.layout === 'line+bar') {
    axes.orders = { position: 'right', label: 'Orders' };
    // Bars first in the declaration as in the RFC fixture; the scene paints lines above bars regardless.
    layers.unshift({ type: 'bar', y: bars, yAxis: 'orders' });
  }
  return { ...common, axes, layers };
}

/**
 * An adapter for a module that exports `cartesian` (the artifact's axylo/axylo-cartesian.bench.js).
 * Readiness, readback, zoom and hover are the root Axylo adapter's own code: create() hands it a stand-in for the
 * Axylo global whose line() builds the Cartesian chart, so both sides of a pair are measured the same way.
 */
export function cartesianAdapter({ id = 'axylo-cartesian', load }) {
  const inner = axyloAdapter(id);
  let cartesian = null;
  let loadError = null;
  return {
    ...inner,
    id,
    config: 'default options, axylo/cartesian',
    configFor: params => `${inner.configFor(params)}, through axylo/cartesian`,
    bundleFor: () => 'axylo/axylo-cartesian.bench.js',
    async load() {
      globalThis.__AXYLO_BENCH__ = true;
      try { ({ cartesian } = await load()); } catch (error) { loadError = String(error?.message ?? error); }
    },
    available(workload, params = {}) {
      // No kind: the one-line workload (root line fixture); kind 'cartesian': the line + bar workload.
      if (params.kind && params.kind !== 'line' && params.kind !== 'cartesian') return { ok: false, reason: `axylo/cartesian draws its own layers, not kind ${params.kind}` };
      if (!cartesianWorkloads.includes(workload)) return { ok: false, reason: `${workload} is not available for cartesian` };
      if (typeof cartesian !== 'function') return { ok: false, reason: loadError ?? 'the Cartesian bundle does not export cartesian()' };
      return { ok: true };
    },
    create(el, fix, opts = {}) {
      const saved = globalThis.Axylo;
      globalThis.Axylo = { line: (target, options) => cartesian(target, cartesianOptions(fix, options)) };
      let instance;
      try {
        instance = inner.create(el, fix, { ...opts, kind: 'line' });
      } finally {
        globalThis.Axylo = saved;
      }
      // Timing, readiness, zoom and hover stay the root adapter's code; only the readback is the Cartesian one.
      const describe = instance.describe;
      instance.describe = (args = {}) => cartesianReadback(instance.chart, el, fix, describe.call(instance, args), args);
      return instance;
    },
  };
}

const NOT_CAPTURED = 'strokes and rectangles are read only in the untimed probe run';

/**
 * The Cartesian readback, from what this chart drew. The root hook is shared with the line chart: its series are
 * in frame order (bars first here), its y domain is the left axis's, and its kept indexes are the root line
 * simplifier's selection, not this chart's F5 drawing. So series are matched to the fixture by key, the line is
 * checked against its own captured SVG stroke (`drawn: pixels`) on the left axis's committed domain, and the bars
 * against the SVG rectangles the chart painted. Rectangles are read only in the untimed probe run, as strokes are.
 */
export function cartesianReadback(chart, el, fix, seen, { probe } = {}) {
  if (!seen || seen.sanity) return seen;
  const d = chart?.__bench?.describe?.();
  if (!d) return seen;
  const layout = fix.cartesian?.layout ?? 'line';
  const series = fix.names.map((name, i) => {
    const s = d.series.find(e => e.key === name);
    if (!s) return null;
    const drawn = i === 0
      ? (seen.drawnPixels ? { kind: 'pixels' } : { kind: 'not-captured', reason: NOT_CAPTURED })
      : { kind: 'rectangles' };
    return { key: name, points: s.points, oldestX: s.oldestX, newestX: s.newestX, missing: s.missing, drawn };
  });
  // The right axis's committed domain, from the Cartesian hook's drawn y axes (absent from the shared root hook).
  const right = Array.isArray(d.yAxes) ? d.yAxes[1] : null;
  const rightDomain = right && Array.isArray(right.domain) ? [right.domain[0], right.domain[1]] : null;
  const cartesianSeen = { layout, plot: d.plot ?? null, heldKeys: d.series.map(s => s.key), rightDomain };
  if (layout === 'line+bar') cartesianSeen.bars = probe === 'geometry' ? barRectangles(el) : { kind: 'not-captured', reason: NOT_CAPTURED };
  return { ...seen, series, cartesian: cartesianSeen };
}

/** The painted bar rectangles of the chart, in document (source) order, flattened [x, y, width, height, ...]. */
function barRectangles(el) {
  const rects = el.querySelectorAll('svg.axylo-svg .axylo-scene > g rect');
  const out = [];
  for (const rect of rects) {
    if (rect.style.fill || getComputedStyle(rect).fill === 'none') continue;
    out.push(rect.x.baseVal.value, rect.y.baseVal.value, rect.width.baseVal.value, rect.height.baseVal.value);
  }
  return { kind: 'rectangles', xywh: out };
}
