import type { DatumRef, Frame, TextMeasurer, TextStyle } from './contracts';
import type { ChartEvents, Diagnostic } from '../public';
import type { ThemeResolution } from '../theme';
import type { Span } from './stages';
import type { ChartHandle, Probe, StageCounter } from './instrument';
import type { ControllerActions, ControllerCore, Host, Invalidate, Size } from './controller-types';
import { SYNC, type SyncResolve } from './peer';
import { pointForDatum, positionValue, themeKeys } from './controller-helpers';

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
  }
  get update(): (patch: unknown) => void {
    return own(this, 'update', (patch: unknown): void => { this.#c.update(patch); });
  }
  get append(): (rows: unknown, options?: { keep?: number }) => void {
    return own(this, 'append', (rows: unknown, options?: { keep?: number }): void => { this.#c.append(rows, options); });
  }
  get zoom(): (domain: unknown) => void {
    return own(this, 'zoom', (domain: unknown): void => { this.#c.zoom(domain); });
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
    return own(this, 'destroy', (): void => { this.#c.destroy(); });
  }
}

/**
 * What the interaction layer may ask of one chart; everything goes through the public paths. Destroy nulls the
 * accepted and drawn state and the listeners, so those checks also stop a destroyed chart.
 */
export class ChartActions implements ControllerActions {
  constructor(private readonly c: ControllerCore) {}
  zoom(window: Span | null): void {
    const c = this.c;
    const a = c.accepted;
    if (!a) return;
    c.zoom(window === null ? null : [positionValue(a.frame, window[0]), positionValue(a.frame, window[1])]);
  }
  toggle(seriesKey: string): void { this.c.toggleSeries(seriesKey); }
  pause(paused: boolean): void { this.c.setPaused(paused); }
  select(ref: DatumRef): void {
    const c = this.c;
    const d = c.drawn;
    const point = d && pointForDatum(d, ref);
    if (point) c.emit('select', point);
  }
  hover(ref: DatumRef | null): void {
    const c = this.c;
    const d = c.drawn;
    // Nothing is built for a pointer move nobody listens to.
    if (!c.listeners?.get('hover')?.size) return;
    c.emit('hover', d && ref ? pointForDatum(d, ref) : null);
  }
}

/**
 * What the page tells one chart (observers, watchers). A destroyed chart schedules no frame (schedule checks),
 * holds no accepted state and has a dead host, so what these set on it is never read.
 */
export class ChartInvalidate implements Invalidate {
  constructor(private readonly c: ControllerCore) {}
  resize(): void {
    const c = this.c;
    // Responsive CSS can change the font or spacing with the size (plan 2.2), and the strip's height (R11).
    c.dirtyTextAndStrip(true);
    c.schedule();
  }
  page(): void {
    const c = this.c;
    // Back in the document: anything the page could have changed meanwhile is read again, the pixel ratio
    // and web fonts included (review 3, finding 19).
    c.themeDirty = true;
    c.dirtyTextAndStrip(true);
    c.pixelRatio = c.host.devicePixelRatio();
    c.fontEpoch++;
    c.schedule();
  }
  theme(): void {
    const c = this.c;
    c.themeDirty = true;
    c.dirtyTextAndStrip(false);
    // The colours are resolved and written now, in the observer's callback, so the marks show the new
    // scheme in the first frame after the change (L4): their paint refers to the custom properties written
    // here. The light-dark() defaults follow prefers-color-scheme in CSS. Resolve AX141 when the
    // media query's change event arrives. Only when what is on screen is also what is
    // accepted, so the colours written belong to the marks shown.
    const a = c.accepted;
    const drawn = c.drawn;
    if (!c.inFrame && a && drawn && c.theme && drawn.accepted.view === a.view) {
      try {
        const keys = themeKeys(a.view);
        c.resolveTheme(keys, a.options.colors);
        if (!c.themeDirty) c.deliverChanges();
      } catch {
        c.themeDirty = true;
      }
    }
    c.schedule();
  }
  language(): void { this.c.schedule(); }
  fonts(): void {
    const c = this.c;
    c.fontEpoch++;
    c.dirtyTextAndStrip(true);
    c.schedule();
  }
  pixelRatio(): void {
    const c = this.c;
    c.pixelRatio = c.host.devicePixelRatio();
    c.textStyleDirty = true;
    c.schedule();
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
      view: drawn.accepted.view, layout: drawn.layout, pixelRatio: c.pixelRatio, scene: drawn.scene,
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
