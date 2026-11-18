/**
 * Browser test app for @axylo/react. The test drives it through `window.app`: it describes the charts to
 * render as JSON specs, and the app turns them into elements. Data is named, so a spec that names the same
 * dataset passes the same array identity; every other prop arrives as a fresh object on each render, which
 * is the inline-prop case the adapter has to absorb.
 */
import { nextFrames, probe } from './probe';
import { Component, createRef, StrictMode, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { Area, Bar, Donut, Line, Scatter, type ChartRef } from '../../src/index';
import { spy } from './spy-axylo';
import { hydrationTree } from './tree';

const components = { Line, Area, Bar, Scatter, Donut } as unknown as Record<string, (props: Record<string, unknown>) => ReactNode>;

export interface Spec {
  type: keyof typeof components;
  data: string;
  props?: Record<string, unknown>;
  /** Installs an onHover that records [tag, point index]. A new function is made on every render. */
  hover?: string;
}

class Boundary extends Component<{ reset: unknown; children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidUpdate(previous: { reset: unknown }) {
    if (this.state.error && previous.reset !== this.props.reset) this.setState({ error: null });
  }
  override render() {
    return this.state.error ? <p className="caught">{this.state.error.message}</p> : this.props.children;
  }
}

interface Bench { ready(): Promise<void>; describe(): { series: { key: string; points: number; newestX: number }[] } }
type Handle = { append(rows: unknown[]): void; __bench: Bench };

const datasets: Record<string, unknown[]> = {};
const refs: RefObject<ChartRef<unknown, unknown> | null>[] = [];
const events: [string, number | null][] = [];
const hydrationErrors: string[] = [];
let root: Root | null = null;

const settle = async () => { await new Promise(r => setTimeout(r, 0)); await nextFrames(2); };

const app = {
  spy, probe, events, hydrationErrors, nextFrames,
  setData(name: string, rows: unknown[]) { datasets[name] = rows; },
  chart(i: number): Handle | null { return (refs[i]?.current?.chart ?? null) as Handle | null; },
  async render(specs: Spec[], options: { strict?: boolean } = {}) {
    root ??= createRoot(document.getElementById('chart')!);
    const charts = specs.map((spec, i) => {
      const ref = refs[i] ??= createRef();
      const Chart = components[spec.type]!;
      const onHover = spec.hover ? (p: { index: number } | null) => events.push([spec.hover!, p ? p.index : null]) : undefined;
      return <Boundary key={i} reset={spec.data}><Chart ref={ref} data={datasets[spec.data]} onHover={onHover} {...spec.props} /></Boundary>;
    });
    flushSync(() => root!.render(options.strict ? <StrictMode>{charts}</StrictMode> : <>{charts}</>));
    await settle();
  },
  /** Waits until every mounted chart has drawn its accepted state. */
  async ready() {
    await Promise.all(refs.map(r => (r.current?.chart as Handle | null)?.__bench.ready()));
    await nextFrames(2);
  },
  async hydrate() {
    hydrateRoot(document.getElementById('chart')!, hydrationTree(), { onRecoverableError: e => hydrationErrors.push(String(e)) });
    await settle();
  },
};

(window as unknown as { app: typeof app }).app = app;
