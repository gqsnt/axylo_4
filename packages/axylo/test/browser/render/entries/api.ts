/** What the render test entry exposes on `window.axr`. Shared by the entry and the tests (types only). */
import type { PaintBindings, PlacedText, ResolvedTheme } from '../../../../src/core/contracts';

export type RendererKind = 'canvas' | 'svg';

export interface MountOptions {
  readonly keys?: readonly string[];
  readonly colors?: Readonly<Record<string, string>>;
  /** 'fixed' (default): the hand-built test scene. 'line': one path of `vertices` vertices. */
  readonly scene?: 'fixed' | 'line';
  readonly vertices?: number;
}

export interface WatchRecord {
  readonly id: number;
  /** Canvas only: pixel at the probe point before and after the draw the callback made. */
  readonly before: readonly number[] | null;
  readonly after: readonly number[] | null;
}

export interface TextProbe {
  readonly box: { x: number; y: number; width: number; height: number };
  readonly rect: { x: number; y: number; width: number; height: number };
}

export interface AxrApi {
  readonly css: string;
  ensureStyles(): number;
  mount(kind: RendererKind, left: number, top: number, options?: MountOptions): number;
  redraw(id: number): void;
  draws(id: number): number;
  theme(id: number): { theme: ResolvedTheme; bindings: PaintBindings; attribute: string | null };
  canvasInfo(id: number): { width: number; height: number; cssWidth: number; cssHeight: number };
  /** RGBA of the scene canvas backing store at a device pixel. */
  canvasPixel(id: number, x: number, y: number, layer?: 'scene' | 'overlay'): number[];
  /** Computed stroke-dasharray of the SVG renderer's dashed path. */
  svgDash(id: number): string;
  /** Redraws with the path moved; reports whether every scene element was reused. */
  svgReuse(id: number): { sameNodes: boolean; dChanged: boolean; count: number };
  overlay(id: number, on: boolean): void;
  svgOverlayCount(id: number): number;
  /** watchTheme on every mount; the callback re-resolves all and redraws only canvas mounts. */
  watch(probe: readonly [number, number]): void;
  stopWatch(): void;
  fired(): number;
  records(): readonly WatchRecord[];
  /** Text layer with three labels whose boxes are computed from canvas metrics of the layer's font. */
  mountText(left: number, top: number): TextProbe[];
  measureText(): TextProbe[];
  textReuse(): { sameNodes: boolean; markupInert: boolean };
  frames(n: number): Promise<void>;
  time(kind: RendererKind, vertices: number, repeats: number): Promise<{ draw: number[]; painted: number[] }>;
}

declare global {
  interface Window { axr: AxrApi }
}

export type { PlacedText };
