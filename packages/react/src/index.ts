'use client';
/**
 * React components for Axylo (plan 1.7). Each renders one empty <div> and drives a core chart inside it from
 * effects, so server rendering produces the container only and never reaches the core's browser code.
 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, Ref } from 'react';
import { area, bar, donut, line, scatter } from 'axylo';
import type {
  AreaOptions, BarOptions, Chart, ChartEvents, Diagnostic, DonutOptions, LineOptions, ScatterOptions,
} from 'axylo';
import { diff, looksSame, optionsOf, type Options } from './patch';

/** What a component's `ref` receives. `chart` is null before mount, after unmount and on the server. */
export interface ChartRef<Row, ChartOptions> {
  readonly chart: Chart<Row, ChartOptions> | null;
}

interface ComponentProps<Row, ChartOptions> {
  className?: string;
  style?: CSSProperties;
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

const EVENTS = [['onHover', 'hover'], ['onSelect', 'select'], ['onZoom', 'zoom']] as const;
let hinted = false;

function component(create: Create, name: string): unknown {
  const Axylo = forwardRef<ChartRef<unknown, Options>, Options>((props, ref) => {
    const target = useRef<HTMLDivElement>(null);
    const latest = useRef(props);
    const live = useRef<{ chart: AnyChart; applied: Options; repeats: number } | null>(null);
    // A throw inside an effect never reaches an error boundary; kept here and thrown from render instead.
    const [failure, setFailure] = useState<{ error: unknown } | null>(null);
    const [onDiagnostic] = useState(() => (d: Diagnostic) => (latest.current.onDiagnostic as Listener)?.(d));

    useImperativeHandle(ref, () => ({ get chart() { return live.current?.chart ?? null; } }), []);

    useEffect(() => { latest.current = props; });

    useEffect(() => {
      const options = optionsOf(latest.current, onDiagnostic);
      let chart: AnyChart;
      try {
        chart = create(target.current!, options);
      } catch (error) {
        setFailure({ error });
        return;
      }
      // Listeners go through `latest`, so a new handler is picked up without touching the chart.
      for (const [prop, event] of EVENTS) chart.on(event, payload => (latest.current[prop] as Listener)?.(payload));
      live.current = { chart, applied: options, repeats: 0 };
      return () => {
        live.current = null;
        chart.destroy();
      };
    }, []);

    useEffect(() => {
      const state = live.current;
      if (!state) return;
      const next = optionsOf(props, onDiagnostic);
      if (__DEV__ && !hinted) {
        const before = state.applied.data;
        state.repeats = next.data !== before && looksSame(before, next.data) ? state.repeats + 1 : 0;
        if (state.repeats >= 3) {
          hinted = true;
          console.warn(`[axylo/react] <${name}> received the same data as a new object three renders in a row, so the chart renormalizes it each time. Memoize \`data\` (useMemo, or keep it in state).`);
        }
      }
      const patch = diff(state.applied, next);
      if (!patch) return;
      try {
        state.chart.update(patch);
        state.applied = next;
      } catch (error) {
        setFailure({ error });
      }
    });

    if (failure) throw failure.error;
    // `axylo` is the class the core puts on its root; rendering it keeps React from removing it when
    // `className` changes.
    return createElement('div', { ref: target, className: props.className ? `axylo ${props.className as string}` : 'axylo', style: props.style as CSSProperties });
  });
  Axylo.displayName = name;
  return Axylo;
}

export const Line = component(line as unknown as Create, 'Line') as <Row>(props: LineProps<Row>) => ReactElement | null;
export const Area = component(area as unknown as Create, 'Area') as <Row>(props: AreaProps<Row>) => ReactElement | null;
export const Bar = component(bar as unknown as Create, 'Bar') as <Row>(props: BarProps<Row>) => ReactElement | null;
export const Scatter = component(scatter as unknown as Create, 'Scatter') as <Row>(props: ScatterProps<Row>) => ReactElement | null;
export const Donut = component(donut as unknown as Create, 'Donut') as <Row>(props: DonutProps<Row>) => ReactElement | null;
