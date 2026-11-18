/** What the render test entry exposes on `window.axr`. Shared by the entry and the tests (types only). */
import type { PaintBindings, PlacedText, ResolvedTheme } from '../../../../src/core/contracts';

export type RendererKind = 'canvas' | 'svg';

/** Hand-built scenes, all in a 400 × 300 box unless `width`/`height` say otherwise. */
export type SceneName = 'fixed' | 'line' | 'markers' | 'ring' | 'negative' | 'overlap' | 'dash' | 'mixed' | 'short' | 'pattern';

export interface MountOptions {
  readonly keys?: readonly string[];
  readonly colors?: Readonly<Record<string, string>>;
  readonly scene?: SceneName;
  readonly vertices?: number;
  readonly width?: number;
  readonly height?: number;
  /** CSS selector of the element to mount into (default: body). */
  readonly parent?: string;
  /** Custom properties or styles set on the chart root before the first draw. */
  readonly style?: Readonly<Record<string, string>>;
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
  /** True when the label's content is wider or taller than its box (it would be clipped). */
  readonly overflow?: boolean;
}

export interface TextSpec {
  readonly lines: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly anchor: PlacedText['anchor'];
  readonly baseline: PlacedText['baseline'];
  readonly rotate: number;
}

export interface ResolveInfo {
  readonly theme: ResolvedTheme & { plotBackground?: string | null };
  readonly bindings: PaintBindings;
  readonly attribute: string | null;
  readonly resolved: boolean | undefined;
  readonly backdropKnown: boolean | undefined;
  readonly invalidColors: readonly string[] | undefined;
  readonly lowContrast: readonly number[];
}

export interface AxrApi {
  readonly css: string;
  ensureStyles(): number;
  mount(kind: RendererKind, left: number, top: number, options?: MountOptions): number;
  redraw(id: number): void;
  /** Replaces the mount's scene with a named one and draws. */
  drawScene(id: number, scene: SceneName): void;
  draws(id: number): number;
  theme(id: number): { theme: ResolvedTheme; bindings: PaintBindings; attribute: string | null };
  info(id: number): ResolveInfo;
  /** resolveTheme on an element that is not in the document. */
  detached(): ResolveInfo;
  move(id: number, parent: string): void;
  canvasInfo(id: number): { width: number; height: number; cssWidth: number; cssHeight: number; overlayWidth: number; overlayHeight: number; overlayCssWidth: number };
  /** RGBA of the scene canvas backing store at a device pixel. */
  canvasPixel(id: number, x: number, y: number, layer?: 'scene' | 'overlay'): number[];
  /** Computed stroke-dasharray of the SVG renderer's dashed path. */
  svgDash(id: number): string;
  /** Redraws with the path moved; reports whether every scene element was reused. */
  svgReuse(id: number): { sameNodes: boolean; dChanged: boolean; count: number };
  /** Tag names of the SVG scene group's children. */
  svgTags(id: number): string[];
  /** Attribute and style mutations caused by drawing the same scene object again. */
  mutationsOnRedraw(id: number): Promise<number>;
  overlay(id: number, on: boolean): void;
  svgOverlayCount(id: number): number;
  /** watchTheme on the first mount; the callback re-resolves all and redraws only canvas mounts. */
  watch(probe: readonly [number, number]): void;
  stopWatch(): void;
  fired(): number;
  records(): readonly WatchRecord[];
  /** Text layer with three labels whose boxes are computed from canvas metrics of the layer's own font. */
  mountText(left: number, top: number): TextProbe[];
  /** Text layer with the given labels. */
  mountTextSpecs(left: number, top: number, specs: readonly TextSpec[], font?: string): TextProbe[];
  /** Recomputes every box from the layer's current computed font and spacing (as layout would), renders, measures. */
  relayoutText(): TextProbe[];
  measureText(): TextProbe[];
  textReuse(): { sameNodes: boolean; markupInert: boolean };
  /** Adds a font from bytes under `family` and waits for it to load. */
  loadFont(family: string, base64: string): Promise<boolean>;
  setRootStyle(id: number, name: string, value: string): void;
  frames(n: number): Promise<void>;
  time(kind: RendererKind, vertices: number, repeats: number): Promise<{ draw: number[]; painted: number[] }>;
  /** Mounts an SVG chart inside a shadow root, installing styles there. */
  shadowMount(left: number, top: number): { position: string; adoptedInShadow: number; adoptedInDocument: number };
  /** Calls ensureStyles after removing constructable-stylesheet support from this page. */
  ensureStylesWithoutAdoption(): { styleElements: number; second: number; position: string };
}

declare global {
  interface Window { axr: AxrApi }
}

export type { PlacedText };
