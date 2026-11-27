/**
 * The smallest page the real chart controller runs on in Node, for the finance strict-rollback and zoom tests:
 * a manual animation-frame queue, and a renderer and interaction layer that keep what they were given. The
 * plot container is the given size (no caption or controls model: these tests compare a chart with itself).
 * The full recording host used by the core tests is test/core/host.ts.
 */
import type { Composition } from '../../src/core/composition';
import type { Scene } from '../../src/core/contracts';
import type { Host } from '../../src/core/controller';
import type { Committed } from '../../src/dom/interaction';
import type { Table } from '../../src/data/table';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { TOKEN_BINDINGS } from '../../src/theme';

export interface Recording {
  readonly host: Host;
  /** Runs every queued animation frame (and those they queue), at most `limit` rounds. */
  frames(limit?: number): number;
  readonly draws: Scene[];
  /** What the interaction layer was last given: the layout, lookup and view the reader sees. */
  readonly committed: Committed | null;
  /** Every commit, with the scene drawn just before it: one frame's layout, lookup and marks together. */
  readonly commits: { readonly committed: Committed; readonly scene: Scene | undefined }[];
}

export function record(size: { width: number; height: number } = { width: 720, height: 420 }): Recording {
  const queue = new Map<number, (time?: number) => void>();
  let handles = 0;
  let clock = 0;
  let committed: Committed | null = null;
  const draws: Scene[] = [];
  const commits: { committed: Committed; scene: Scene | undefined }[] = [];
  const host: Host = {
    id: 'axylo-finance-test',
    console: null,
    page: {},
    timeZone: 'UTC',
    renderer: { kind: 'svg', draw: scene => { draws.push(scene); } },
    text: { render: () => {} },
    figure: { update: () => false, announce: () => {} },
    interaction: { prepare: () => false, commit: state => { committed = state; if (state) commits.push({ committed: state, scene: draws[draws.length - 1] }); }, clear: () => { committed = null; } },
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

/**
 * The table a finance composition resolves from the options the wrapper handed its controller: the controller
 * holds the wrapper's data holder, and this is the data every stage after resolution reads.
 */
export function resolvedTable(composition: Composition, options: Record<string, unknown>): Table {
  return composition.resolve!('line', options, new DiagnosticCollector()).table;
}
