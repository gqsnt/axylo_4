/**
 * A recording host for driving the chart controller in Node (the method of the core review): a manual
 * animation-frame queue, and substitutes for the figure, the renderers and the interaction layer that keep
 * what they were given. Sizes come from a small model of the figure's CSS: the plot gets what the caption
 * and the controls leave of the container.
 */
import type { Layout, PlacedText, Scene, TextStyle } from '../../src/core/contracts';
import { createController, type ChartKind, type Controller, type Host, type Size } from '../../src/core/controller';
import type { FigureModel } from '../../src/dom/figure';
import type { Committed, ControlsState } from '../../src/dom/interaction';
import { TOKEN_BINDINGS } from '../../src/theme';

export interface Recording {
  readonly host: Host;
  readonly controller: Controller;
  /** Runs every queued animation frame (and those they queue), at most `limit` rounds. */
  frames(limit?: number): number;
  readonly pending: number;
  draws: Scene[];
  texts: (readonly PlacedText[])[];
  models: FigureModel[];
  announcements: string[];
  prepared: ControlsState[];
  committed: Committed | null;
  commits: number;
  clears: number;
  themeCalls: { keys: readonly string[]; colors: Record<string, string> }[];
  printed: string[];
  disposed: number;
  /** Host writes (figure, renderer, text, interaction) made after `dispose`. */
  writesAfterDispose: number;
  /** The last surfaces(visible) call: false while the error revision hides marks and text. */
  surfaces: boolean;
  /** The container (CSS px). The plot's height is what the caption and the controls leave. */
  container: { width: number; height: number } | null;
  /** Height of one caption line and of the controls row in the model of the figure. */
  readonly lineHeight: number;
  ids: Record<string, string>;
  readonly layout: Layout | null;
}

export interface HostOptions {
  readonly container?: { width: number; height: number } | null;
  readonly console?: boolean;
  readonly timeZone?: string;
  readonly locale?: string;
  readonly textWidth?: Host['measurer']['width'];
  readonly captionLineHeight?: number;
  /** The page's `lang` (A10); 'en' when not given. */
  readonly pageLang?: string;
  /** The target element's own id (an untitled chart's name in diagnostics). */
  readonly targetId?: string;
}

export function record(kind: ChartKind, options: Record<string, unknown>, settings: HostOptions = {}): Recording {
  const queue = new Map<number, (time?: number) => void>();
  /** Animation frame time: one value per batch of callbacks, as a browser gives it. */
  let clock = 0;
  let handles = 0;
  const rec = {
    draws: [] as Scene[], texts: [] as (readonly PlacedText[])[], models: [] as FigureModel[], announcements: [] as string[],
    prepared: [] as ControlsState[], committed: null as Committed | null, commits: 0, clears: 0,
    themeCalls: [] as { keys: readonly string[]; colors: Record<string, string> }[], printed: [] as string[], disposed: 0,
    writesAfterDispose: 0, surfaces: true,
    container: settings.container === undefined ? { width: 720, height: 400 } : settings.container,
    lineHeight: settings.captionLineHeight ?? 20, ids: {} as Record<string, string>,
  };
  let model: FigureModel | null = null;
  let controls: ControlsState | null = null;
  const style: TextStyle = { font: '400 12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 15 };

  /** The plot size the model figure gives: container minus caption (title, subtitle, visible summary) and controls. */
  function plotSize(): Size | null {
    const box = rec.container;
    if (box === null) return null;
    let used = 0;
    if (model && !model.compact) {
      if (model.title?.visible) used += rec.lineHeight;
      if (model.subtitle) used += rec.lineHeight;
      if (model.summaryVisible) used += 2 * rec.lineHeight;
      if (model.note) used += rec.lineHeight;
    }
    if (controls && controls.interactive) {
      // The legend and toolbar take a row; the fallback offers only the table control, which is a row too
      // but shorter (no legend).
      used += controls.tooSmall ? rec.lineHeight : 1.5 * rec.lineHeight;
    }
    return { width: box.width, height: box.height - used };
  }

  const host: Host = {
    id: 'axylo-test',
    targetId: settings.targetId ?? null,
    console: settings.console === false ? null : {
      warn: (...args: unknown[]) => { rec.printed.push(String(args[0])); },
      info: (...args: unknown[]) => { rec.printed.push(String(args[0])); },
      error: (...args: unknown[]) => { rec.printed.push(String(args[0])); },
    },
    page: {},
    timeZone: settings.timeZone ?? 'UTC',
    renderer: { kind: 'svg', draw: scene => { if (rec.disposed) rec.writesAfterDispose++; rec.draws.push(scene); } },
    text: { render: texts => { if (rec.disposed) rec.writesAfterDispose++; rec.texts.push(texts); } },
    surfaces(visible) {
      rec.surfaces = visible;
    },
    figure: {
      update(next) {
        if (rec.disposed) rec.writesAfterDispose++;
        const before = model;
        model = next;
        rec.models.push(next);
        return before === null || before.summaryVisible !== next.summaryVisible || before.note !== next.note ||
          before.title?.text !== next.title?.text || before.subtitle !== next.subtitle;
      },
      announce: text => { rec.announcements.push(text); },
    },
    interaction: {
      prepare(state) {
        const before = controls;
        controls = state;
        rec.prepared.push(state);
        return before === null || before.tooSmall !== state.tooSmall || before.interactive !== state.interactive;
      },
      commit(state) {
        if (rec.disposed) rec.writesAfterDispose++;
        rec.committed = state;
        rec.commits++;
      },
      clear() {
        rec.committed = null;
        rec.clears++;
      },
    },
    measurer: { width: settings.textWidth ?? (text => text.length * 7) },
    requestFrame(callback) {
      const handle = ++handles;
      queue.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      queue.delete(handle);
    },
    locale: option => typeof option === 'string' ? option : settings.locale ?? 'en-US',
    pageLang: () => settings.pageLang ?? 'en',
    labelText: id => Object.hasOwn(rec.ids, id) ? rec.ids[id]! : null,
    textStyle: () => style,
    measure: plotSize,
    devicePixelRatio: () => 1,
    theme(keys, colors) {
      rec.themeCalls.push({ keys: [...keys], colors });
      const series = keys.map((_, i) => `var(--axylo-series-color-${i + 1})`);
      const paints = { tokens: { ...TOKEN_BINDINGS }, series };
      return {
        bindings: { tokens: TOKEN_BINDINGS, series },
        theme: { scheme: 'light', forcedColors: false, moreContrast: false, paints },
        resolved: true, backdropKnown: false,
      };
    },
    dispose() {
      rec.disposed++;
    },
  };

  const controller = createController(kind, options, host);
  // Accessors stay accessors: `pending` and `layout` are read when asked (review 3, finding 20).
  return Object.defineProperties(Object.assign(rec, {
    host, controller,
    frames(limit = 10): number {
      let rounds = 0;
      while (queue.size && rounds < limit) {
        rounds++;
        const callbacks = [...queue.values()];
        queue.clear();
        clock += 16;
        for (const cb of callbacks) cb(clock);
      }
      return rounds;
    },
  }), {
    pending: { get: () => queue.size, enumerable: true },
    layout: { get: () => rec.committed?.layout ?? null, enumerable: true },
  }) as unknown as Recording;
}

export const lastModel = (r: Recording): FigureModel => r.models[r.models.length - 1]!;
