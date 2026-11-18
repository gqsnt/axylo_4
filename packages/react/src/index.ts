'use client';
/**
 * React components for Axylo (plan 1.7). Each renders one empty <div> and drives a core chart inside it from
 * effects, so server rendering produces the container only and never reaches the core's browser code.
 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactElement, Ref } from 'react';
import { area, bar, donut, line, scatter } from 'axylo';
import type {
  AreaOptions, BarOptions, Chart, ChartEvents, Diagnostic, DonutOptions, LineOptions, ScatterOptions,
} from 'axylo';
import { diff, isHostProp, looksSame, optionsOf, type Options } from './patch';

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
interface Live { chart: AnyChart; applied: Options; repeats: number; hinted: boolean }

const EVENTS = [['onHover', 'hover'], ['onSelect', 'select'], ['onZoom', 'zoom']] as const;

/**
 * The layout phase on the client: the chart exists, has the committed options and calls the committed
 * handlers before a parent's layout effect or callback ref can reach it, so calls made there apply in the
 * order React committed them (plan 1.5). On the server neither kind runs; useEffect there avoids React 18's
 * useLayoutEffect warning.
 */
const useCommitEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

function component(create: Create, name: string): unknown {
  const Axylo = forwardRef<ChartRef<unknown, Options>, Options>((props, ref) => {
    const target = useRef<HTMLDivElement>(null);
    const latest = useRef(props);
    const live = useRef<Live | null>(null);
    const forward = useRef((d: Diagnostic) => (latest.current.onDiagnostic as Listener)?.(d)).current;

    // Errors thrown here (a `strict` chart rejecting its options) reach the nearest error boundary as they are.
    useCommitEffect(() => {
      latest.current = props;
      const next = optionsOf(props, forward);
      const state = live.current;
      if (!state) {
        const chart = create(target.current!, next);
        try {
          // Listeners go through `latest`, so a new handler is picked up without touching the chart.
          for (const [prop, event] of EVENTS) chart.on(event, payload => (latest.current[prop] as Listener)?.(payload));
        } catch (error) {
          chart.destroy();
          throw error;
        }
        live.current = { chart, applied: next, repeats: 0, hinted: false };
        return;
      }
      if (__DEV__) hint(state, next.data, name);
      const patch = diff(state.applied, next);
      if (patch) state.chart.update(patch);
      // Also on a no-op: the next render then compares against these identities and stops at the first check.
      state.applied = next;
    });

    // Destroyed in the passive cleanup, which runs on unmount but not when Suspense hides the subtree: a
    // revealed chart is the same chart, with its appended rows and zoom.
    useEffect(() => () => {
      const state = live.current;
      live.current = null;
      state?.chart.destroy();
    }, []);

    useImperativeHandle(ref, () => ({ get chart() { return live.current?.chart ?? null; } }), []);

    // `axylo` is the class the core puts on its root; rendering it keeps React from removing it when
    // `className` changes.
    const host: Options = { ref: target, className: props.className ? `axylo ${props.className as string}` : 'axylo' };
    for (const key of Object.keys(props)) if (isHostProp(key)) host[key] = props[key];
    return createElement('div', host);
  });
  Axylo.displayName = name;
  return Axylo;
}

function hint(state: Live, data: unknown, name: string): void {
  if (state.hinted) return;
  state.repeats = data !== state.applied.data && looksSame(state.applied.data, data) ? state.repeats + 1 : 0;
  if (state.repeats < 3) return;
  state.hinted = true;
  console.warn(`[axylo/react] <${name}> was given \`data\` as a new object three renders running, each time with the same length and the same first and last rows (only those are compared). A new object is normalized again; if the content has not changed, memoize it (useMemo, or keep it in state).`);
}

export const Line = /* @__PURE__ */ component(line as unknown as Create, 'Line') as <Row>(props: LineProps<Row>) => ReactElement | null;
export const Area = /* @__PURE__ */ component(area as unknown as Create, 'Area') as <Row>(props: AreaProps<Row>) => ReactElement | null;
export const Bar = /* @__PURE__ */ component(bar as unknown as Create, 'Bar') as <Row>(props: BarProps<Row>) => ReactElement | null;
export const Scatter = /* @__PURE__ */ component(scatter as unknown as Create, 'Scatter') as <Row>(props: ScatterProps<Row>) => ReactElement | null;
export const Donut = /* @__PURE__ */ component(donut as unknown as Create, 'Donut') as <Row>(props: DonutProps<Row>) => ReactElement | null;
