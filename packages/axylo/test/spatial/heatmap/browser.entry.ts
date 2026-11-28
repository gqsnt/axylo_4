/**
 * Browser entry for test/browser/chart/n8a-heatmap.browser.test.ts: bundled from source by the harness's
 * openEntry (esbuild, __DEV__ true), since no built `axylo/spatial` file exists before the wiring cycle.
 */
import { heatmap, heatmapInternals, validateHeatmap } from '../../../src/spatial/heatmap/index';

declare global {
  interface Window {
    N8A: { heatmap: typeof heatmap; validateHeatmap: typeof validateHeatmap; heatmapInternals: typeof heatmapInternals };
  }
}

window.N8A = { heatmap, validateHeatmap, heatmapInternals };
