import { edit, regex, variant } from './lib.mjs';
const find = "const requested = object(input).__renderer === 'canvas' ? 'canvas' : 'svg';";
const make = "const renderer: MarkRenderer = requested === 'canvas' ? canvasRendererWith(composition.canvas, doc) : svgRendererWith(composition.svg, doc);";
const kinds = ['line', 'area', 'bar', 'scatter', 'donut'];
const [pre = '', from = 'base'] = process.argv.slice(2);
let d = variant(pre + 'svg-only', from);
edit(d, 'core/chart.ts', [[find, "const requested = (__DEV__ || __BENCH__) && object(input).__renderer === 'canvas' ? 'canvas' : 'svg';"],
  [make, "const renderer: MarkRenderer = (__DEV__ || __BENCH__) && requested === 'canvas' ? canvasRendererWith(composition.canvas, doc) : svgRendererWith(composition.svg, doc);"]]);
for (const k of kinds) regex(d, `kinds/${k}.ts`, /canvas: (\{[^}]*\}),/, (m, t) => `canvas: __DEV__ || __BENCH__ ? ${t} : {},`);
d = variant(pre + 'canvas-only', from);
edit(d, 'core/chart.ts', [[find, "const requested = (__DEV__ || __BENCH__) && object(input).__renderer === 'svg' ? 'svg' : 'canvas';"],
  [make, "const renderer: MarkRenderer = !(__DEV__ || __BENCH__) || requested === 'canvas' ? canvasRendererWith(composition.canvas, doc) : svgRendererWith(composition.svg, doc);"]]);
for (const k of kinds) regex(d, `kinds/${k}.ts`, /svg: (\{[^}]*\}),/, (m, t) => `svg: __DEV__ || __BENCH__ ? ${t} : {},`);
