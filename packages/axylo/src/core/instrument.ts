/**
 * Test and benchmark instrumentation, in one place: the `__bench` handle the benchmark harness reads
 * (bench/README.md), the `__dev` handle the tests read (stage counters, the forced-failure hook), and the
 * stage counters behind them. It is present in the development files (`__DEV__`) and in a build made with
 * `__BENCH__` true (the benchmark harness's own build, where `__bench` is attached when the page set
 * `globalThis.__AXYLO_BENCH__`), and absent from every shipped production file: the controller calls in only
 * under `instrumented`, which the build folds to false. What the harness reads next goes here, from `Probe`.
 */
import type { Frame, Layout, Scene, View } from './contracts';
import type { Table } from '../data/table';
import { ByteCount, CallerBuffers, type OwnedBytes } from '../data/store-bytes';
import { SLOT_NO_ROW, SLOT_VALUE } from './contracts';
import type { Chart } from '../public';
import { drawing } from '../scene/lines';
import { simplifyLine } from '../simplify';

type Span = readonly [number, number];

export const STAGES = ['options', 'normalize', 'append', 'view', 'frame', 'theme', 'formatters', 'layout', 'scene', 'lookup',
  'reader', 'draw', 'text', 'figure'] as const;
export type Stage = typeof STAGES[number];

/** What the benchmark harness reads (bench/README.md): readiness and what the committed frame shows. */
export interface BenchHook {
  readonly revision: number;
  ready(): Promise<void>;
  describe(): {
    xDomain: Span | null;
    yDomain: Span | null;
    series: {
      key: string; points: number; oldestX: number; newestX: number; missing: number;
      /**
       * Line charts: the caller's row indexes of the samples the simplified drawing kept, in drawing order (spec
       * F5), so drawn gaps and extremes can be checked index-exactly. Absent for other chart types.
       */
      kept?: number[];
      /** Line charts: offsets into `kept` at which a new drawn run starts (after a gap), the first run excluded. */
      breaks?: number[];
      /** Line charts: the kept samples drawn as markers because they stand alone (no neighbour to join). */
      isolatedMarkers?: boolean;
      /**
       * What `kept` indexes: 'rows' (the caller's row indexes, a static chart) or 'window' (positions in the
       * displayed window, oldest first, for a streaming chart whose row indexes run on as rows arrive).
       */
      keptBasis?: 'rows' | 'window';
    }[];
    /** The drawn plot rectangle in CSS px of the chart; null before a plot is drawn. */
    plot?: { x: number; y: number; width: number; height: number } | null;
    /** The mark renderer drawing this chart. */
    renderer: 'canvas' | 'svg';
  };
  /**
   * Every typed array or ArrayBuffer the chart holds that is not one of the caller's columns: the store's own
   * storage (streaming), the normalized frame (static) and the drawn scene.
   */
  memory(): { bytes: number; buffers: { name: string; bytes: number }[] };
}

export interface DevHook {
  stages(): Record<Stage, number>;
  /** Makes the named stage throw, to test the internal-error state; null stops it. */
  fail(stage: Stage | null): void;
  readonly renderer: 'canvas' | 'svg';
  /** Rows the streaming store still holds for revisions not yet retired (0 for a static chart). */
  retainedRows(): number;
  /** Revisions whose rows the streaming store can still answer for (its row sources), 0 for a static chart. */
  retainedSources(): number;
}

export type ChartHandle = Chart<unknown, Record<string, unknown>> & { __bench?: BenchHook; __dev?: DevHook };

// Whether a build carries the instrumentation is `__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)`,
// written out where the controller uses it rather than named here: the build must see the constants to drop what
// they guard. `typeof` keeps a build that defines only __DEV__ working (it then has none).

/** Counts the stages that ran and makes one throw on request (the internal-error tests). */
export class StageCounter {
  readonly counts = Object.fromEntries(STAGES.map(s => [s, 0])) as Record<Stage, number>;
  failing: Stage | null = null;
  ran(name: Stage): void {
    this.counts[name]++;
    if (this.failing === name) throw new Error(`Axylo test hook: forced failure in the ${name} stage.`);
  }
}

/** What the controller lets the instrumentation read; the frame on screen and its revision. */
export interface Probe {
  readonly stages: StageCounter;
  /** The accepted revision (0 before anything was accepted). */
  revision(): number;
  /** Resolves once the page settled on the accepted revision (drawn, or its error shown), or the chart is gone. */
  ready(): Promise<void>;
  /** The committed frame: its view and layout, and the pixel ratio it was drawn at; null before the first. */
  shown(): {
    readonly view: View; readonly layout: Layout; readonly pixelRatio: number; readonly scene: Scene;
    readonly streaming: boolean; readonly table: Table;
  } | null;
  renderer(): 'canvas' | 'svg';
  retainedRows(): number;
  /** The streaming store, when there is one. */
  store(): { ownedBytes?: (frames?: readonly Frame[]) => OwnedBytes } | null;
  /** Every frame the chart still holds: displayed, pending, held while paused, being published. */
  frames(): readonly Frame[];
}

export function attachHooks(handle: ChartHandle, probe: Probe): void {
  if (__DEV__ || (globalThis as { __AXYLO_BENCH__?: unknown }).__AXYLO_BENCH__ === true) {
    handle.__bench = {
      get revision() {
        return probe.revision();
      },
      ready: () => probe.ready(),
      describe() {
        const d = probe.shown();
        const renderer = probe.renderer();
        if (!d) return { xDomain: null, yDomain: null, series: [], plot: null, renderer };
        const out: ReturnType<BenchHook['describe']> = { ...describe(d.view), renderer, plot: null };
        const view = d.view;
        const layout = d.layout;
        if (layout.kind === 'plot' || layout.kind === 'compact') {
          const p = layout.plot;
          out.plot = { x: p.x, y: p.y, width: p.width, height: p.height };
          // The domains the marks were drawn with: the layout may widen an automatic value domain to end at
          // ticks a short plot can draw (F7), so the view's own domain is not always the one drawn.
          const projection = layout.projection;
          if (projection.kind === 'xy') {
            out.yDomain = projection.y.domain;
            if (projection.x.type !== 'band') out.xDomain = projection.x.domain;
          } else if (projection.kind === 'bands') {
            out.yDomain = projection.value.domain;
          }
        }
        if (view.kind === 'line' && (layout.kind === 'plot' || layout.kind === 'compact') && layout.projection.kind === 'xy') {
          // The same selection the scene made (scene/index.ts): the frame's x, the plot, the pixel ratio.
          const draw = drawing(view.frame.x.values, layout.projection, layout.plot, d.pixelRatio > 0 ? d.pixelRatio : 1);
          const window = view.visibleSlots.start;
          out.series = out.series.map((s, i) => {
            const series = view.frame.series[i]!;
            if (!view.visible[i]) return { ...s, kept: [], breaks: [], isolatedMarkers: false, keptBasis: d.streaming ? 'window' : 'rows' };
            const runs = simplifyLine({ ...draw, range: view.drawSlots[i]!, slot: series.slot, y: series.y });
            // A streaming chart's row indexes keep growing: its kept samples are given within the window shown.
            const kept = d.streaming
              ? Array.from(runs.indexes, slot => slot - window)
              : Array.from(runs.indexes, slot => series.row ? series.row[slot]! : slot);
            return {
              ...s, kept, breaks: Array.from(runs.breaks), isolatedMarkers: runs.isolated.length > 0,
              keptBasis: d.streaming ? 'window' : 'rows',
            };
          });
        }
        return out;
      },
      memory() {
        const d = probe.shown();
        // The store counts the frames still held with its own buffers, in one deduplicated set: a displayed
        // frame older than the store's head can hold buffers the head no longer has (verification, defect 12).
        const frames = probe.frames();
        const own = probe.store()?.ownedBytes?.(frames);
        const caller = new CallerBuffers();
        if (d) caller.add(d.table);
        const count = new ByteCount(caller);
        if (!own) for (const frame of frames) count.frame(frame);
        if (d) d.scene.marks.forEach((m, i) => {
          for (const [key, value] of Object.entries(m)) if (ArrayBuffer.isView(value)) count.add(`scene mark ${i} ${key}`, value);
        });
        const extra = count.result();
        const buffers = [...(own?.buffers ?? []), ...extra.buffers].map(b => ({ name: b.name, bytes: b.bytes }));
        return { bytes: (own?.total ?? 0) + extra.total, buffers };
      },
    };
  }
  if (__DEV__) {
    handle.__dev = {
      stages: () => ({ ...probe.stages.counts }),
      fail(name) {
        probe.stages.failing = name;
      },
      renderer: probe.renderer(),
      retainedRows: () => probe.retainedRows(),
      retainedSources() {
        // The store's private bookkeeping, read here only (development builds): its windows' row sources.
        const store = probe.store() as { revisions?: { windows?: Set<{ sources?: Map<number, unknown> }> } } | null;
        let count = 0;
        for (const window of store?.revisions?.windows ?? []) count += window.sources?.size ?? 0;
        return count;
      },
    };
  }
}

function describe(view: View): Omit<ReturnType<BenchHook['describe']>, 'renderer'> {
  if (view.kind === 'donut') {
    return { xDomain: null, yDomain: null, series: [] };
  }
  if (view.kind === 'scatter') {
    return {
      xDomain: view.xDomain, yDomain: view.yDomain,
      series: view.frame.series.map(s => ({
        key: s.key, points: s.x.length, oldestX: s.x[0] ?? NaN, newestX: s.x[s.x.length - 1] ?? NaN, missing: 0,
      })),
    };
  }
  const { frame } = view;
  return {
    xDomain: view.xDomain, yDomain: view.yDomain,
    series: frame.series.map(s => {
      let points = 0;
      let missing = 0;
      let first = -1;
      let last = -1;
      for (let i = 0; i < frame.length; i++) {
        const state = s.slot[i];
        if (state === SLOT_NO_ROW) continue;
        points++;
        if (first < 0) first = i;
        last = i;
        if (state !== SLOT_VALUE) missing++;
      }
      return {
        key: s.key, points, missing,
        oldestX: first < 0 ? NaN : frame.x.values[first]!, newestX: last < 0 ? NaN : frame.x.values[last]!,
      };
    }),
  };
}
