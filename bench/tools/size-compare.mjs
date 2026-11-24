import { build, version as esbuildVersion } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const gzipLevel = 9;
const settings = {
  bundle: true, minify: true, format: 'esm', target: 'es2022', legalComments: 'none',
  conditions: ['production'], write: false,
};
const gzipBytes = bytes => gzipSync(bytes, { level: gzipLevel }).length;
const versionOf = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;

function modularECharts(charts) {
  const components = 'TooltipComponent, LegendComponent, GridComponent, AriaComponent';
  return `import * as echarts from 'echarts/core';
    import { ${charts} } from 'echarts/charts';
    import { ${components} } from 'echarts/components';
    import { CanvasRenderer } from 'echarts/renderers';
    echarts.use([${charts}, ${components}, CanvasRenderer]);
    export { echarts };`;
}

// Build the shipped ESM first so the consumer tree-shakes the same module boundary as scripts/size.mjs.
async function axyloPackage(repoRoot) {
  const { PRODUCTION, stylesheetPlugin, stylesheets } = await import(pathToFileURL(path.join(repoRoot, 'scripts/build.mjs')));
  const { minified } = await stylesheets();
  const result = await build({
    ...settings, absWorkingDir: repoRoot, entryPoints: ['packages/axylo/src/index.ts'],
    define: PRODUCTION, plugins: [stylesheetPlugin(minified)],
  });
  return {
    name: 'axylo-release',
    setup(builder) {
      builder.onResolve({ filter: /^axylo$/ }, () => ({ path: 'axylo.js', namespace: 'release' }));
      builder.onLoad({ filter: /.*/, namespace: 'release' }, () => ({ contents: result.outputFiles[0].contents }));
    },
  };
}

export async function measureAll({
  repoRoot = path.resolve(import.meta.dirname, '../..'), benchDir = path.join(repoRoot, 'bench'),
} = {}) {
  repoRoot = path.resolve(repoRoot);
  benchDir = path.resolve(benchDir);
  const modules = path.join(benchDir, 'node_modules');
  const uplot = versionOf(path.join(modules, 'uplot'));
  const chartjs = versionOf(path.join(modules, 'chart.js'));
  const echarts = versionOf(path.join(modules, 'echarts'));
  const axylo = versionOf(path.join(repoRoot, 'packages/axylo'));
  const adapter = `Includes chartjs-adapter-date-fns ${versionOf(path.join(modules, 'chartjs-adapter-date-fns'))} and date-fns ${versionOf(path.join(modules, 'date-fns'))}.`;
  const inline = 'Production ESM with CSS in JS, as in scripts/size.mjs and bench/size-latest.json.';
  const registered = 'LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Decimation';
  const release = await axyloPackage(repoRoot);
  const cases = [
    { id: 'uplot-line', library: 'uPlot', variant: 'Line', version: uplot,
      contents: "import uPlot from 'uplot'; export { uPlot };",
      css: readFileSync(path.join(modules, 'uplot/dist/uPlot.min.css')), notes: 'Includes the separately shipped minified CSS.' },
    { id: 'chartjs-modular', library: 'Chart.js', variant: 'Modular line', version: chartjs,
      contents: `import { Chart, ${registered} } from 'chart.js'; import 'chartjs-adapter-date-fns';
        Chart.register(${registered}); export { Chart };`, notes: adapter },
    { id: 'chartjs-auto', library: 'Chart.js', variant: 'Auto', version: chartjs,
      contents: "import { Chart } from 'chart.js/auto'; import 'chartjs-adapter-date-fns'; export { Chart };", notes: adapter },
    { id: 'echarts-modular-line', library: 'Apache ECharts', variant: 'Modular line', version: echarts,
      contents: modularECharts('LineChart'), notes: 'Canvas with tooltip, legend, grid and ARIA.' },
    { id: 'echarts-modular-multi', library: 'Apache ECharts', variant: 'Modular multi', version: echarts,
      contents: modularECharts('LineChart, BarChart, ScatterChart, PieChart'), notes: 'Adds bar, scatter and pie to modular line.' },
    { id: 'echarts-full', library: 'Apache ECharts', variant: 'Full', version: echarts,
      contents: "import * as echarts from 'echarts'; export { echarts };", notes: 'Full package namespace.' },
    { id: 'axylo-line', library: 'Axylo', variant: 'Line', version: axylo,
      contents: "export { line } from 'axylo';", plugins: [release], notes: inline },
    { id: 'axylo-everything', library: 'Axylo', variant: 'Everything', version: axylo,
      contents: "export * from 'axylo';", plugins: [release], notes: inline },
  ];

  const rows = [];
  for (const { contents, css, plugins, ...description } of cases) {
    const result = await build({
      ...settings, absWorkingDir: benchDir, plugins,
      stdin: { contents, resolveDir: benchDir, loader: 'ts', sourcefile: 'consumer.ts' },
    });
    const js = result.outputFiles[0].contents;
    const jsGzipBytes = gzipBytes(js);
    const cssGzipBytes = css ? gzipBytes(css) : 0;
    const totalGzipBytes = jsGzipBytes + cssGzipBytes;
    rows.push({ ...description, minBytes: js.length, jsGzipBytes, cssMinBytes: css?.length ?? 0,
      cssGzipBytes, totalGzipBytes, totalKiB: Number((totalGzipBytes / 1024).toFixed(2)) });
  }
  return rows;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  const rows = await measureAll();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ esbuildVersion, gzipLevel, rows }, null, 2));
  } else {
    console.log(`Consumer bundles, esbuild ${esbuildVersion}, gzip level ${gzipLevel}`);
    const table = rows.map(r => ({
      Library: r.library, Version: r.version, Variant: r.variant, 'JS min B': r.minBytes,
      'JS gzip B': r.jsGzipBytes, 'CSS min B': r.cssMinBytes, 'CSS gzip B': r.cssGzipBytes,
      'Total gzip B': r.totalGzipBytes, 'Total KiB': r.totalKiB.toFixed(2),
    }));
    console.table(table);
    const headers = Object.keys(table[0]);
    const markdownRow = values => '| ' + values.join(' | ') + ' |';
    console.log(markdownRow(headers));
    console.log(markdownRow(headers.map(() => '---')));
    for (const row of table) console.log(markdownRow(Object.values(row)));
  }
}
