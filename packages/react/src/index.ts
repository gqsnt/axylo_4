'use client';
/**
 * React components for Axylo (plan 1.7). Each renders one empty <div> and drives a core chart inside it from
 * effects, so server rendering produces the container only and never reaches the core's browser code.
 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useInsertionEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactElement, Ref } from 'react';
import { area, bar, donut, line, scatter } from 'axylo';
import type {
  AreaOptions, BarOptions, Chart, ChartEvents, Diagnostic, DonutOptions, LineOptions, ScatterOptions,
} from 'axylo';
import { diff, fieldsOf, isHostProp, looksSame, optionsOf, type Options } from './patch';

/** Replaced at build time: the development file keeps the memoization hint, the production file drops it. */
declare const __DEV__: boolean;

/** What a component's `ref` receives. `chart` is null before mount, after unmount and on the server. */
export interface ChartRef<Row, ChartOptions> {
  readonly chart: Chart<Row, ChartOptions> | null;
}

/** Attributes of the container <div>. `aria-*` is not one: the chart is named through `title` or `labelledBy`. */
export interface ContainerProps {
  id?: string;
  className?: string;
  style?: CSSProperties;
  [attribute: `data-${string}`]: string | number | boolean | undefined;
}

interface ComponentProps<Row, ChartOptions> extends ContainerProps {
  ref?: Ref<ChartRef<Row, ChartOptions>>;
  onHover?: (point: ChartEvents<Row>['hover']) => void;
  onSelect?: (point: ChartEvents<Row>['select']) => void;
}

interface ZoomEvent {
  onZoom?: (domain: ChartEvents<unknown>['zoom']) => void;
}

export type LineProps<Row> = LineOptions<Row> & ComponentProps<Row, LineOptions<Row>> & ZoomEvent;
export type AreaProps<Row> = AreaOptions<Row> & ComponentProps<Row, AreaOptions<Row>> & ZoomEvent;
export type BarProps<Row> = BarOptions<Row> & ComponentProps<Row, BarOptions<Row>> & ZoomEvent;
export type ScatterProps<Row> = ScatterOptions<Row> & ComponentProps<Row, ScatterOptions<Row>> & ZoomEvent;
export type DonutProps<Row> = DonutOptions<Row> & ComponentProps<Row, DonutOptions<Row>>;

type AnyChart = Chart<unknown, Options>;
type Create = (target: HTMLElement, options: Options) => AnyChart;
type Listener = ((payload: unknown) => void) | undefined;

/** One component instance's chart and the state of its handle. */
interface Instance {
  chart: AnyChart | null;
  applied: Options;
  /** The ref is attached (its layout effect is connected): not hidden by Suspense, not being deleted. */
  attached: boolean;
  /** This commit's props are not applied yet: between this commit's mutation phase and its layout effect. */
  committing: boolean;
  /** Calls made through the handle while it could not apply them, in call order. */
  waiting: (() => void)[];
  repeats: number;
  hinted: boolean;
}

const EVENTS = [['onHover', 'hover'], ['onSelect', 'select'], ['onZoom', 'zoom']] as const;

/**
 * The handle the ref exposes. A call made while the chart cannot take it in the order React committed
 * (Suspense hides the chart, or this commit's props are not applied yet) waits and is applied as soon as
 * they are, because dropping it would lose a streamed row and applying it early would apply it against old
 * props. A call after unmount throws: nothing can ever apply it, and a no-op would hide that.
 */
function handleFor(self: Instance, name: string): AnyChart {
  const live = (): AnyChart => {
    if (!self.chart) throw new Error(`[axylo/react] <${name}> is unmounted: the call cannot apply.`);
    return self.chart;
  };
  const call = (run: (chart: AnyChart) => void): void => {
    live();
    self.waiting.push(() => run(self.chart!));
    flush(self);
  };
  return {
    update: patch => call(c => c.update(patch)),
    append: (rows, options) => call(c => c.append(rows, options)),
    zoom: domain => call(c => c.zoom(domain)),
    on: (event, listener) => live().on(event, listener),
    get diagnostics() { return self.chart?.diagnostics ?? []; },
    destroy: () => self.chart?.destroy(),
  };
}

function flush(self: Instance): void {
  // One at a time: if a strict call throws, the rest stay queued and the throw reaches the error boundary.
  while (self.chart && self.attached && !self.committing && self.waiting.length) self.waiting.shift()!();
}

/** destroy() without letting its failure replace the error being handled, or reach an unrelated boundary. */
function dispose(chart: AnyChart, name: string): void {
  try {
    chart.destroy();
  } catch (error) {
    console.error(`[axylo/react] <${name}>: destroy() threw.`, error);
  }
}

function component(create: Create, name: string): unknown {
  const Axylo = forwardRef<ChartRef<unknown, Options>, Options>((props, ref) => {
    // Chosen at the first render, not at import: a document installed later in the same runtime still gets
    // the layout phase. On the client, the chart exists, has the committed options and calls the committed
    // handlers before a parent's layout effect or callback ref can reach it (plan 1.5). On the server neither
    // effect runs, and useEffect avoids React 18's useLayoutEffect warning.
    const client = useRef<boolean | null>(null);
    client.current ??= typeof document !== 'undefined';
    const useCommitEffect = client.current ? useLayoutEffect : useEffect;
    const target = useRef<HTMLDivElement>(null);
    const latest = useRef(props);
    const self = useRef<Instance | null>(null);
    self.current ??= { chart: null, applied: {}, attached: false, committing: false, waiting: [], repeats: 0, hinted: false };
    const instance = self.current;
    const forward = useRef((d: Diagnostic) => (latest.current.onDiagnostic as Listener)?.(d)).current;
    const handle = useRef<AnyChart | null>(null);
    handle.current ??= handleFor(instance, name);

    // Runs in the mutation phase, before any layout effect of this commit.
    useInsertionEffect(() => { instance.committing = true; });

    // Errors thrown here (a `strict` chart rejecting its options) reach the nearest error boundary as they are.
    useCommitEffect(() => {
      latest.current = props;
      const next = optionsOf(props, forward);
      if (!instance.chart) {
        const chart = create(target.current!, next);
        try {
          // Listeners go through `latest`, so a new handler is picked up without touching the chart.
          for (const [prop, event] of EVENTS) chart.on(event, payload => (latest.current[prop] as Listener)?.(payload));
        } catch (error) {
          dispose(chart, name);
          throw error;
        }
        Object.assign(instance, { chart, applied: next, repeats: 0, hinted: false });
      } else {
        if (__DEV__) hint(instance, next, name);
        const patch = diff(instance.applied, next);
        if (patch) instance.chart.update(patch);
        // Also on a no-op: the next render then compares against these identities and stops at the first check.
        instance.applied = next;
      }
      instance.committing = false;
      flush(instance);
    });

    // Attachment follows the layout phase: Suspense hiding the chart, and deletion, disconnect it before
    // the passive cleanup runs.
    useCommitEffect(() => {
      instance.attached = true;
      flush(instance);
      return () => { instance.attached = false; };
    }, []);

    // Destroyed in the passive cleanup, which runs on unmount but not when Suspense hides the subtree: a
    // revealed chart is the same chart, with its appended rows and zoom.
    useEffect(() => () => {
      const chart = instance.chart;
      instance.chart = null;
      instance.attached = false;
      const dropped = instance.waiting.splice(0).length;
      if (dropped) console.error(`[axylo/react] <${name}> unmounted with ${dropped} call(s) made while it was hidden or being removed; they were not applied.`);
      if (chart) dispose(chart, name);
    }, []);

    useImperativeHandle(ref, () => ({ get chart() { return instance.attached && instance.chart ? handle.current : null; } }), []);

    // `axylo` is the class the core puts on its root; rendering it keeps React from removing it when
    // `className` changes.
    const host: Options = { ref: target, className: props.className ? `axylo ${props.className as string}` : 'axylo' };
    for (const key of Object.keys(props)) if (isHostProp(key)) host[key] = props[key];
    return createElement('div', host);
  });
  Axylo.displayName = name;
  return Axylo;
}

function hint(self: Instance, next: Options, name: string): void {
  if (self.hinted) return;
  const before = self.applied.data;
  self.repeats = next.data !== before && looksSame(before, next.data, fieldsOf(next)) ? self.repeats + 1 : 0;
  if (self.repeats < 3) return;
  self.hinted = true;
  console.warn(`[axylo/react] <${name}> was given \`data\` as a new object three renders running, each time with the same length and the same first and last values in the plotted fields (only those are compared). A new object is normalized again; if the content has not changed, memoize it (useMemo, or keep it in state).`);
}

export const Line = /* @__PURE__ */ component(line as unknown as Create, 'Line') as <Row>(props: LineProps<Row>) => ReactElement | null;
export const Area = /* @__PURE__ */ component(area as unknown as Create, 'Area') as <Row>(props: AreaProps<Row>) => ReactElement | null;
export const Bar = /* @__PURE__ */ component(bar as unknown as Create, 'Bar') as <Row>(props: BarProps<Row>) => ReactElement | null;
export const Scatter = /* @__PURE__ */ component(scatter as unknown as Create, 'Scatter') as <Row>(props: ScatterProps<Row>) => ReactElement | null;
export const Donut = /* @__PURE__ */ component(donut as unknown as Create, 'Donut') as <Row>(props: DonutProps<Row>) => ReactElement | null;
