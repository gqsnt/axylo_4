/**
 * Browser test app for @axylo/react. The test drives it through `window.app`: it describes the charts to
 * render as JSON specs, and the app turns them into elements. Data is named, so a spec that names the same
 * dataset passes the same array identity; every other prop arrives as a fresh object on each render, which
 * is the inline-prop case the adapter has to absorb.
 */
import { nextFrames, probe } from './probe';
import {
  Component, createRef, startTransition, StrictMode, Suspense, use, useEffect, useLayoutEffect, useState, type ReactNode, type Ref, type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { Area, Bar, Donut, Line, Scatter, type ChartRef } from '../../src/index';
import { spy } from './spy-axylo';
import { hydrationTree } from './tree';

const components = { Line, Area, Bar, Scatter, Donut } as unknown as Record<string, (props: Record<string, unknown>) => ReactNode>;

/** A chart call made from the parent's layout effect, in the same commit as the props it follows. */
export type Action = { append: unknown[] } | { zoom: unknown } | { update: Record<string, unknown> };

export interface Spec {
  type: keyof typeof components;
  data: string;
  props?: Record<string, unknown>;
  /** Installs handlers that record [`${event}:${tag}`, detail]. New functions are made on every render. */
  on?: { hover?: string; select?: string; zoom?: string; diagnostic?: string };
  /** Boundary key: changing it remounts the chart. Defaults to the position. */
  key?: string;
  /** Gives the chart a callback ref that records what it sees when attached. */
  callbackRef?: boolean;
  /** Runs in the parent's layout effect of this commit, through the ref. */
  layout?: Action;
  /** Props passed explicitly as undefined (JSON cannot carry them). */
  unset?: string[];
  /** The parent removes the chart in a passive effect right after this commit. */
  removeAfterCommit?: boolean;
  /** colors given as a counting proxy over this record, made once per name. */
  countedColors?: { name: string; colors: Record<string, string> };
}

class Boundary extends Component<{ reset: unknown; children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { caught.push(error); return { error }; }
  override componentDidUpdate(previous: { reset: unknown }) {
    if (this.state.error && previous.reset !== this.props.reset) this.setState({ error: null });
  }
  override render() {
    return this.state.error ? <p className="caught">{(this.state.error as Error).message}</p> : this.props.children;
  }
}

interface Bench { ready(): Promise<void>; describe(): { series: { key: string; points: number; newestX: number }[] } }
type Handle = { append(rows: unknown[]): void; zoom(d: unknown): void; update(p: Record<string, unknown>): void; diagnostics: unknown[]; __bench: Bench };

const datasets: Record<string, unknown[]> = {};
const refs: RefObject<ChartRef<unknown, unknown> | null>[] = [];
const callbackRefs: Ref<ChartRef<unknown, unknown>>[] = [];
const events: [string, unknown][] = [];
/** What the parent saw in its layout effects and callback refs, in order. */
const seen: unknown[] = [];
const caught: unknown[] = [];
const hydrationErrors: string[] = [];
const counted: Record<string, { reads: number; proxy: Record<string, string> }> = {};
let root: Root | null = null;

const settle = async () => { await new Promise(r => setTimeout(r, 0)); await nextFrames(2); };

function run(chart: Handle, action: Action): unknown {
  try {
    if ('append' in action) chart.append(action.append);
    else if ('zoom' in action) chart.zoom(action.zoom);
    else chart.update(action.update);
    return 'ok';
  } catch (error) {
    return String(error);
  }
}

function Slot({ spec, index }: { spec: Spec; index: number }) {
  const ref = refs[index] ??= createRef();
  const [removed, setRemoved] = useState(false);
  useEffect(() => { if (spec.removeAfterCommit) setRemoved(true); });
  useLayoutEffect(() => {
    const chart = ref.current?.chart as Handle | null | undefined;
    seen.push({ index, effect: 'parent layout', chart: !!chart, diagnostics: chart ? chart.diagnostics.length : null });
    if (spec.layout && chart) seen.push({ index, action: run(chart, spec.layout) });
  });
  const Chart = components[spec.type]!;
  const record = (event: string) => {
    const tag = spec.on?.[event as keyof NonNullable<Spec['on']>];
    return tag === undefined ? undefined : (detail: unknown) => events.push([`${event}:${tag}`, detail && typeof detail === 'object' ? ('index' in detail ? detail.index : 'code' in detail ? detail.code : detail) : detail]);
  };
  const handlers: Record<string, unknown> = {};
  if (spec.on?.hover !== undefined) handlers.onHover = record('hover');
  if (spec.on?.select !== undefined) handlers.onSelect = record('select');
  if (spec.on?.zoom !== undefined) handlers.onZoom = record('zoom');
  if (spec.on?.diagnostic !== undefined) handlers.onDiagnostic = record('diagnostic');
  const callback = callbackRefs[index] ??= (handle: ChartRef<unknown, unknown> | null) => {
    ref.current = handle;
    seen.push({ index, effect: 'callback ref', attached: handle !== null, chart: handle ? handle.chart !== null : null });
  };
  const props: Record<string, unknown> = { ...handlers, ...spec.props };
  for (const key of spec.unset ?? []) props[key] = undefined;
  if (spec.countedColors) props.colors = countedColors(spec.countedColors.name, spec.countedColors.colors);
  if (removed) return null;
  return <Chart ref={spec.callbackRef ? callback : ref} data={datasets[spec.data]} {...props} />;
}

function countedColors(name: string, colors: Record<string, string>) {
  const entry = counted[name] ??= {
    reads: 0,
    proxy: new Proxy({ ...colors }, { ownKeys(t) { entry.reads++; return Reflect.ownKeys(t); } }),
  };
  return entry.proxy;
}

const never = new Promise<never>(() => {});
function Never(): ReactNode { use(never); return null; }

/**
 * Rendered before the charts, outside their Suspense boundary: its layout effect runs in every commit after
 * the mutation phase (ref detachment, deletion) and before the charts' own layout effects.
 */
function Watcher(): null {
  useLayoutEffect(() => {
    unreadable.armed = true;
    if (app.duringLayout) seen.push({ effect: 'watcher', result: app.duringLayout() });
  });
  return null;
}

/**
 * Rendered after the charts. Between the watcher's layout effect and this one, only the charts' own layout
 * effects run, so the unreadable column throws there and nowhere else (React's development build reads props
 * deeply in its own passive-phase logging, which is not what the test is about).
 */
function Trailer(): null {
  useLayoutEffect(() => { unreadable.armed = false; });
  return null;
}
const unreadable = { armed: false };

function tree(specs: Spec[], options: { strict?: boolean; suspend?: boolean }) {
  const charts = specs.map((spec, i) => <Boundary key={spec.key ?? i} reset={spec.data}><Slot spec={spec} index={i} /></Boundary>);
  const body = <><Watcher /><Suspense fallback={<p className="fallback">loading</p>}>{charts}{options.suspend ? <Never /> : null}</Suspense><Trailer /></>;
  return options.strict ? <StrictMode>{body}</StrictMode> : body;
}

const app = {
  spy, probe, events, seen, caught, hydrationErrors, nextFrames, counted,
  setData(name: string, rows: unknown[]) { datasets[name] = rows; },
  /** The public handle, as the ref exposes it. */
  chart(i: number): Handle | null { return (refs[i]?.current?.chart ?? null) as Handle | null; },
  /** The core's own handle (with its development hooks) of the i-th chart not yet destroyed. */
  raw(i: number): Handle | null { return (spy.charts.filter(c => c.destroys === 0)[i]?.chart.deref() ?? null) as Handle | null; },
  /** When set, the watcher calls it in each commit's layout phase and records what it returns. */
  duringLayout: null as null | (() => unknown),
  /** Typed columns with an extra column the chart does not plot, whose endpoints throw when read. */
  setColumns(name: string, n: number) {
    const extra = {
      length: n,
      get 0(): number { if (unreadable.armed) throw new Error('unplotted column read'); return 0; },
    } as ArrayLike<number>;
    datasets[name] = { columns: { t: Float64Array.from({ length: n }, (_, i) => i), v: Float64Array.from({ length: n }, (_, i) => 10 + i), extra } } as unknown as unknown[];
  },
  handle(i: number) { return refs[i]?.current ?? null; },
  /** Renders and commits synchronously, then lets the page settle. */
  async render(specs: Spec[], options: { strict?: boolean } = {}) {
    app.commit(specs, options);
    await settle();
  },
  /** Renders and commits synchronously, and returns before any frame. */
  commit(specs: Spec[], options: { strict?: boolean; suspend?: boolean } = {}) {
    root ??= createRoot(document.getElementById('chart')!);
    flushSync(() => root!.render(tree(specs, options)));
  },
  /** A transition that never commits: a sibling suspends forever, so React keeps the committed tree. */
  async abandon(specs: Spec[]) {
    startTransition(() => root!.render(tree(specs, { suspend: true })));
    await new Promise(r => setTimeout(r, 300));
    await nextFrames(2);
  },
  /** Waits until every mounted chart has drawn its accepted state. */
  async ready() {
    await Promise.all(spy.charts.filter(c => c.destroys === 0).map(c => (c.chart.deref() as Handle | undefined)?.__bench.ready()));
    await nextFrames(2);
  },
  async hydrate() {
    hydrateRoot(document.getElementById('chart')!, hydrationTree(), { onRecoverableError: e => hydrationErrors.push(String(e)) });
    await settle();
  },
};

(window as unknown as { app: typeof app }).app = app;
