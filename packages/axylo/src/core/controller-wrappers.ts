import type { DatumRef, Frame, TextMeasurer, TextStyle } from './contracts';
import type { ChartEvents, Diagnostic } from '../public';
import type { ThemeResolution } from '../theme';
import type { ChartHandle, Probe, StageCounter } from './instrument';
import type { ControllerCore, Host, Size } from './controller-types';
import { SYNC, type SyncResolve } from './peer';
import { EXPORT, register, type ExportSeam } from '../export/contract';
import { pointForDatum } from './controller-helpers';

/**
 * What a destroyed controller holds instead of its host, so a handle kept by the page retains no DOM. One
 * object per destroyed chart: it is its own renderer, text layer, figure, interaction layer and measurer.
 */
export class DeadHost implements Host {
  readonly console = null;
  readonly timeZone = 'UTC';
  readonly page: object;
  readonly renderer: Host['renderer'];
  readonly text: Host['text'];
  readonly figure: Host['figure'];
  readonly interaction: Host['interaction'];
  readonly measurer: TextMeasurer;
  constructor(readonly id: string, readonly kind: Host['renderer']['kind']) {
    this.page = this.renderer = this.text = this.figure = this.interaction = this.measurer = this;
  }
  draw(): void {}
  render(): void {}
  update(): boolean { return false; }
  announce(): void {}
  prepare(): boolean { return false; }
  commit(): void {}
  clear(): void {}
  width(): number { return 0; }
  requestFrame(): number { return 0; }
  cancelFrame(): void {}
  locale(): string { return 'en'; }
  pageLang(): null { return null; }
  labelText(): null { return null; }
  textStyle(): TextStyle { return { font: '', letterSpacing: 0, wordSpacing: 0, lineHeight: 0 }; }
  measure(): Size { return { width: 0, height: 0 }; }
  devicePixelRatio(): number { return 1; }
  theme(): ThemeResolution { throw new Error('Axylo: the chart was destroyed.'); }
  dispose(): void {}
}

/** Replaces a lazy getter with the value it made, so later reads are plain properties. */
function own<T>(handle: object, key: string, value: T): T {
  Object.defineProperty(handle, key, { value, enumerable: true, configurable: true });
  return value;
}

/**
 * The handle the page holds. Prototype getters lazily bind and memoize each public method on first access,
 * keeping static charts allocation-free while preserving receiver-independent destructured/callback calls.
 */
export class Handle implements ChartHandle {
  readonly #c: ControllerCore;
  constructor(c: ControllerCore) {
    this.#c = c;
    // Encapsulated capability for axylo/sync (core/peer.ts), not enumerable. On the instance: a computed class
    // key would be work done at import time, and a bare import must bundle to nothing.
    Object.defineProperty(this, SYNC, {
      value: {
        get drawn() { return c.drawn; },
        sync(resolve: SyncResolve | null, origin: object) { c.host.interaction.sync?.(resolve, origin); },
        point(ref: DatumRef) { return c.drawn && pointForDatum(c.drawn, ref); },
        onDestroy(fn: () => void) {
          if (c.destroyed) return () => {};
          const set = c.disposers ??= new Set();
          set.add(fn);
          return () => { set.delete(fn); };
        },
      },
    });
    // The read-only capability for axylo/export (export/contract.ts), a separate object. The renderer's
    // element is the plot's surface: its parent is the plot and its figure the chart's, so a family whose
    // plot is not an SVG registers the same way. Reading through the host avoids retaining either element
    // through a handle kept after destruction. While a frame runs, the live figure may already show the next
    // caption, legend and note over the last committed marks (an author formatter can run in between), so the
    // plot is absent until the frame ends. The figure (what a container lookup finds) and the committed table stay.
    const plot = () => (c.host.renderer as { element?: Element }).element?.parentElement ?? null;
    const seam: ExportSeam = Object.freeze({
      get table() { return c.drawn?.reader.table ?? null; },
      get plot() { return c.inFrame ? null : c.drawn && plot(); },
      get figure() { return c.drawn && plot()?.closest?.('figure') || null; },
    });
    Object.defineProperty(this, EXPORT, { value: seam });
    const unregister = register(seam, plot()?.closest?.('figure'));
    if (unregister) (c.disposers ??= new Set()).add(unregister);
  }
  get update(): (patch: unknown) => void {
    return own(this, 'update', this.#c.update.bind(this.#c));
  }
  get append(): (rows: unknown, options?: { keep?: number }) => void {
    return own(this, 'append', this.#c.append.bind(this.#c));
  }
  get zoom(): (domain: unknown) => void {
    return own(this, 'zoom', this.#c.zoomDomain.bind(this.#c));
  }
  get on(): <E extends keyof ChartEvents<unknown>>(event: E, listener: (payload: ChartEvents<unknown>[E]) => void) => () => void {
    const c = this.#c;
    return own(this, 'on', <E extends keyof ChartEvents<unknown>>(event: E, listener: (payload: ChartEvents<unknown>[E]) => void): () => void => {
      if (c.destroyed) return () => {};
      const map = c.listeners ??= new Map();
      let set = map.get(event);
      if (!set) map.set(event, set = new Set());
      set.add(listener as (payload: never) => void);
      // Resolved through the chart's map, which destroy clears and nulls: a kept unsubscribe holds no one else.
      return () => { c.listeners?.get(event)?.delete(listener as (payload: never) => void); };
    });
  }
  get diagnostics(): Diagnostic[] {
    const c = this.#c;
    return c.publicDiagnostics(c.diagnosticInputs());
  }
  get destroy(): () => void {
    return own(this, 'destroy', this.#c.destroy.bind(this.#c));
  }
}

/** What the instrumentation reads of one chart (development and benchmark builds only). */
export class ControllerProbe implements Probe {
  readonly stages: StageCounter;
  constructor(private readonly c: ControllerCore) { this.stages = c.stages!; }
  revision(): number { return this.c.accepted?.revision ?? 0; }
  ready(): Promise<void> {
    const c = this.c;
    const revision = c.accepted?.revision ?? 0;
    if (c.destroyed || (c.settledRevision >= revision && !c.frameScheduled)) return Promise.resolve();
    return new Promise<void>(resolve => (c.waiters ??= []).push({ revision, resolve }));
  }
  shown(): ReturnType<Probe['shown']> {
    const c = this.c;
    const drawn = c.drawn;
    return drawn && {
      view: drawn.accepted.view, layout: drawn.layout, pixelRatio: c.currentRatio, scene: drawn.scene,
      streaming: drawn.accepted.stream !== null, table: drawn.accepted.source.table,
    };
  }
  renderer(): 'canvas' | 'svg' { return this.c.host.renderer.kind; }
  retainedRows(): number { return this.c.accepted?.stream?.store?.retainedRowCount ?? 0; }
  store(): ReturnType<Probe['store']> { return this.c.accepted?.stream?.store ?? null; }
  frames(): readonly Frame[] {
    const c = this.c;
    const live = new Set<Frame>();
    for (const f of [c.onScreen?.frame, c.drawn?.accepted.frame, c.accepted?.frame, c.held?.frame, c.inflight?.frame]) if (f) live.add(f);
    return [...live];
  }
}
