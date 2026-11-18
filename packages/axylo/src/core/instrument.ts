/**
 * Test and benchmark instrumentation, in one place: the `__bench` handle the benchmark harness reads
 * (bench/README.md), the `__dev` handle the tests read (stage counters, the forced-failure hook), and the
 * stage counters behind them. It is present in the development files (`__DEV__`) and in a build made with
 * `__BENCH__` true (the benchmark harness's own build, where `__bench` is attached when the page set
 * `globalThis.__AXYLO_BENCH__`), and absent from every shipped production file: the controller calls in only
 * under `instrumented`, which the build folds to false. What the harness reads next goes here, from `Probe`.
 */
import type { Layout, View } from './contracts';
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
    }[];
    /** The mark renderer drawing this chart. */
    renderer: 'canvas' | 'svg';
  };
}

export interface DevHook {
  stages(): Record<Stage, number>;
  /** Makes the named stage throw, to test the internal-error state; null stops it. */
  fail(stage: Stage | null): void;
  readonly renderer: 'canvas' | 'svg';
  /** Rows the streaming store still holds for revisions not yet retired (0 for a static chart). */
  retainedRows(): number;
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
  shown(): { readonly view: View; readonly layout: Layout; readonly pixelRatio: number } | null;
  renderer(): 'canvas' | 'svg';
  retainedRows(): number;
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
        if (!d) return { xDomain: null, yDomain: null, series: [], renderer };
        const out = { ...describe(d.view), renderer };
        const view = d.view;
        if (view.kind === 'line' && d.layout.kind === 'plot' && d.layout.projection.kind === 'xy') {
          // The same selection the scene made (scene/index.ts): the frame's x, the plot, the pixel ratio.
          const draw = drawing(view.frame.x.values, d.layout.projection, d.layout.plot, d.pixelRatio > 0 ? d.pixelRatio : 1);
          out.series = out.series.map((s, i) => {
            const series = view.frame.series[i]!;
            if (!view.visible[i]) return { ...s, kept: [] };
            const runs = simplifyLine({ ...draw, range: view.drawSlots[i]!, slot: series.slot, y: series.y });
            return { ...s, kept: Array.from(runs.indexes, slot => series.row ? series.row[slot]! : slot) };
          });
        }
        return out;
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
