import type { DatumRef, Frame, TextMeasurer, TextStyle } from './contracts';
import type { ChartEvents, Diagnostic } from '../public';
import type { ThemeResolution } from '../theme';
import type { Span } from './stages';
import type { ChartHandle, Probe, StageCounter } from './instrument';
import type { ControllerActions, ControllerCore, Host, Invalidate, Size } from './controller-types';
import { pointForDatum, positionValue, themeKeys } from './controller-helpers';

/**
 * What a destroyed controller holds instead of its host, so a handle kept by the page retains no DOM. One
 * object per destroyed chart: it is its own renderer, text layer, figure, interaction layer and measurer.
 */
export class DeadHost implements Host {
  readonly console = null;
  readonly timeZone = 'UTC';
  constructor(readonly id: string, readonly kind: Host['renderer']['kind']) {}
  get page(): object { return this; }
  get renderer(): Host['renderer'] { return this; }
  get text(): Host['text'] { return this; }
  get figure(): Host['figure'] { return this; }
  get interaction(): Host['interaction'] { return this; }
  get measurer(): TextMeasurer { return this; }
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
  constructor(c: ControllerCore) { this.#c = c; }
  get update(): (patch: unknown) => void {
    const c = this.#c;
    const fn = (patch: unknown): void => { c.update(patch); };
    return own(this, 'update', fn);
  }
  get append(): (rows: unknown, options?: { keep?: number }) => void {
    const c = this.#c;
    const fn = (rows: unknown, options?: { keep?: number }): void => { c.append(rows, options); };
    return own(this, 'append', fn);
  }
  get zoom(): (domain: unknown) => void {
    const c = this.#c;
    const fn = (domain: unknown): void => { c.zoom(domain); };
    return own(this, 'zoom', fn);
  }
  get on(): <E extends keyof ChartEvents<unknown>>(event: E, listener: (payload: ChartEvents<unknown>[E]) => void) => () => void {
    const c = this.#c;
    const fn = <E extends keyof ChartEvents<unknown>>(event: E, listener: (payload: ChartEvents<unknown>[E]) => void): () => void => {
      if (c.destroyed) return () => {};
      const map = c.listeners ??= new Map();
      let set = map.get(event);
      if (!set) map.set(event, set = new Set());
      set.add(listener as (payload: never) => void);
      // Resolved through the chart's map, which destroy clears and nulls: a kept unsubscribe holds no one else.
      return () => { c.listeners?.get(event)?.delete(listener as (payload: never) => void); };
    };
    return own(this, 'on', fn);
  }
  get diagnostics(): Diagnostic[] {
    const c = this.#c;
    return c.publicDiagnostics(c.diagnosticInputs());
  }
  get destroy(): () => void {
    const c = this.#c;
    const fn = (): void => { c.destroy(); };
    return own(this, 'destroy', fn);
  }
}

/** What the interaction layer may ask of one chart; everything goes through the public paths. */
export class ChartActions implements ControllerActions {
  constructor(private readonly c: ControllerCore) {}
  zoom(window: Span | null): void {
    const c = this.c;
    const a = c.accepted;
    if (!a || c.destroyed) return;
    c.zoom(window === null ? null : [positionValue(a.frame, window[0]), positionValue(a.frame, window[1])]);
  }
  toggle(seriesKey: string): void { this.c.toggleSeries(seriesKey); }
  pause(paused: boolean): void { this.c.setPaused(paused); }
  select(ref: DatumRef): void {
    const c = this.c;
    const d = c.drawn;
    const point = d && !c.destroyed ? pointForDatum(d, ref) : null;
    if (point) c.emit('select', point);
  }
  hover(ref: DatumRef | null): void {
    const c = this.c;
    const d = c.drawn;
    if (c.destroyed) return;
    // Nothing is built for a pointer move nobody listens to.
    if (!c.listeners?.get('hover')?.size) return;
    c.emit('hover', d && ref ? pointForDatum(d, ref) : null);
  }
}

/** What the page tells one chart (observers, watchers). */
export class ChartInvalidate implements Invalidate {
  constructor(private readonly c: ControllerCore) {}
  resize(): void {
    const c = this.c;
    if (c.destroyed) return;
    // Responsive CSS can change the font or spacing with the size (plan 2.2), and the strip's height (R11).
    c.dirtyTextAndStrip(true);
    c.schedule();
  }
  page(): void {
    const c = this.c;
    if (c.destroyed) return;
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
    if (c.destroyed) return;
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
    if (c.destroyed) return;
    c.fontEpoch++;
    c.dirtyTextAndStrip(true);
    c.schedule();
  }
  pixelRatio(): void {
    const c = this.c;
    if (c.destroyed) return;
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
