/**
 * The smallest page the real chart controller runs on in Node, for the heatmap lifecycle tests: a manual
 * animation-frame queue, and a renderer and interaction layer that keep what they were given. Adapted from
 * test/finance/host.ts (kept separate so the heatmap tests do not depend on another track's helpers).
 */
import type { Composition } from '../../../src/core/composition';
import type { Scene } from '../../../src/core/contracts';
import { staticControllerFor, type Controller, type Host } from '../../../src/core/controller';
import type { Committed, ControlsState } from '../../../src/dom/interaction';
import { TOKEN_BINDINGS } from '../../../src/theme';
import { openHeatmapChart, type HeatmapHandle } from '../../../src/spatial/heatmap/chart';

export interface Recording {
  readonly host: Host;
  frames(limit?: number): number;
  readonly draws: Scene[];
  readonly committed: Committed | null;
  readonly prepared: ControlsState | null;
  readonly commits: { readonly committed: Committed; readonly scene: Scene | undefined }[];
  /** Texts last given to the text layer. */
  readonly texts: readonly unknown[];
}

export function record(size: { width: number; height: number } = { width: 720, height: 420 }): Recording {
  const queue = new Map<number, (time?: number) => void>();
  let handles = 0;
  let clock = 0;
  let committed: Committed | null = null;
  let prepared: ControlsState | null = null;
  let texts: readonly unknown[] = [];
  const draws: Scene[] = [];
  const commits: { committed: Committed; scene: Scene | undefined }[] = [];
  const host: Host = {
    id: 'axylo-heatmap-test',
    console: null,
    page: {},
    timeZone: 'UTC',
    renderer: { kind: 'svg', draw: scene => { draws.push(scene); } },
    text: { render: t => { texts = t; } },
    figure: { update: () => false, announce: () => {} },
    interaction: {
      prepare: state => { prepared = state; return false; },
      commit: state => { committed = state; if (state) commits.push({ committed: state, scene: draws[draws.length - 1] }); },
      clear: () => { committed = null; },
    },
    measurer: { width: text => text.length * 7 },
    requestFrame(callback) { queue.set(++handles, callback); return handles; },
    cancelFrame(handle) { queue.delete(handle); },
    locale: option => (typeof option === 'string' ? option : 'en-US'),
    pageLang: () => 'en',
    labelText: () => null,
    textStyle: () => ({ font: '400 12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 15 }),
    measure: () => size,
    devicePixelRatio: () => 1,
    theme(keys) {
      const series = keys.map((_, i) => `var(--axylo-series-color-${i + 1})`);
      return {
        bindings: { tokens: TOKEN_BINDINGS, series },
        theme: { scheme: 'light', forcedColors: false, moreContrast: false, paints: { tokens: { ...TOKEN_BINDINGS }, series } },
        resolved: true, backdropKnown: false,
      };
    },
    dispose() { queue.clear(); },
  };
  return {
    host, draws, commits,
    get committed() { return committed; },
    get prepared() { return prepared; },
    get texts() { return texts; },
    frames(limit = 10) {
      let rounds = 0;
      while (queue.size && rounds < limit) {
        rounds++;
        const callbacks = [...queue.values()];
        queue.clear();
        clock += 16;
        for (const cb of callbacks) cb(clock);
      }
      return rounds;
    },
  };
}

/** A heatmap on the recording host, through the real wrapper and controller. */
export function openRecorded(options: unknown, size?: { width: number; height: number }): {
  rec: Recording; handle: HeatmapHandle; composition: Composition; controller: Controller;
} {
  const rec = record(size);
  let composition: Composition | null = null;
  let controller: Controller | null = null;
  const handle: HeatmapHandle = openHeatmapChart(options, (c, translated) => {
    composition = c;
    controller = staticControllerFor(c, translated, rec.host);
    return controller.handle as unknown as HeatmapHandle;
  });
  rec.frames();
  return { rec, handle, composition: composition!, controller: controller! };
}
