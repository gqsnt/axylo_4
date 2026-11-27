/**
 * What the interaction layer offers for a given state: readout mode, zoom, the table, the slice legend. Pure
 * predicates over ControlsState, shared by dom/interaction.ts and dom/slice-list.ts so neither duplicates them.
 */
import type { View } from '../core/contracts';
import type { Messages } from '../public';
import { defaultMessages } from '../messages';
import type { ToolbarItem } from './toolbar';
import type { Presentation } from './tooltip';
import type { ControlsState, InstructionKey, ReadoutMode, SeriesSwatch } from './interaction-types';

export const INSPECT = 1, RANGE = 2, RESET = 4, CLOSER = 8, LEFT = 16, RIGHT = 32, SERIES = 64;

export function readoutOf(state: ControlsState): ReadoutMode {
  const r = state.readoutMode ?? state.readout;
  return r === 'floating' || r === 'strip' || r === 'none' ? r : r === true ? 'strip' : 'floating';
}

export const presentationFor = (s: ControlsState): Presentation | 'none' => !s.interactive || !s.tooltip || s.tooSmall ? 'none' : readoutOf(s);

export const offersZoom = (d: ControlsState): d is ControlsState & { readonly zoom: true | 'touch'; readonly tooSmall: false; readonly view: Exclude<View, { kind: 'donut' }> } =>
  d.zoom !== false && !d.tooSmall && d.view.kind !== 'donut';
export const recoverable = <T extends ControlsState>(d: T | null): d is T & { readonly zoomed: true } =>
  d !== null && !d.ready && d.empty === true && d.zoom !== false && d.zoomed && !d.tooSmall;
export const canZoom = (d: ControlsState): d is ControlsState & { readonly zoom: true | 'touch'; readonly tooSmall: false; readonly view: Exclude<View, { kind: 'donut' }> } =>
  offersZoom(d) && (d.ready || recoverable(d));
export const canInspect = (d: ControlsState) => Boolean(d.reader.table && (d.ready || d.inspectable));
export const missingLang = (d: ControlsState, t: string) =>
  t === d.messages.noData ? d.english('noData') : t === d.messages.noObservation ? d.english('noObservation') : undefined;

export function showsSlices(d: ControlsState): d is ControlsState & { readonly view: Extract<View, { kind: 'donut' }> } {
  const { view } = d;
  return view.kind === 'donut' && !!d.legend && !d.tooSmall && !!(d.ready || d.inspectable || (view.slices.length > 0 && view.total === 0));
}

/**
 * Pushes onto `out` every input the controls are drawn from, so an unchanged list skips the redraw, and returns
 * which controls show. `closer` is whether zooming in further is possible (cached by the caller); `swatch` is the
 * composition's, whose key covers what its swatches read beyond the series' cue.
 */
export function collectControlInputs(d: ControlsState, out: unknown[], tableOpen: boolean, rangeOn: boolean, closer: boolean, swatch: SeriesSwatch): number {
  const { view } = d;
  let controls = canInspect(d) ? INSPECT : 0;
  out.push(d.messages, d.english('controlsLabel'), d.pageLang, d.legend, tableOpen, rangeOn, d.streaming, d.paused);
  if (tableOpen) out.push(d.reader.table, d.formatters);
  if (canZoom(d)) {
    const { xDomain: now, xFull: full } = d.view;
    if (d.ready) controls |= RANGE | (closer ? CLOSER : 0);
    if (d.zoomed) controls |= RESET | (now[0] > full[0] ? LEFT : 0) | (now[1] < full[1] ? RIGHT : 0);
  }
  if (showsSlices(d)) out.push(view, d.formatters, d.ready, d.english('noData'));
  else if (view.kind !== 'donut' && d.ready && d.legend && !d.tooSmall && view.frame.series.length > 1) {
    controls |= SERIES;
    const { series } = view.frame;
    for (let i = 0; i < series.length; i++) {
      const s = series[i]!, cue = view.cues[i];
      out.push(s.key, s.label, view.visible[i] === true, cue?.marker, cue?.dash.normal, cue?.dash.contrast, swatch.key?.(i, view));
    }
  }
  out.push(controls);
  return controls;
}

/** The toolbar's items for a state; `table` is the open table's element id, or null when it is closed. */
export function buildControlItems(d: ControlsState, controls: number, swatch: SeriesSwatch, rangeOn: boolean, table: string | null): ToolbarItem[] {
  const { messages: m, view } = d, items: ToolbarItem[] = [], inherited = d.english('controlsLabel') ? d.pageLang : null;
  if (controls & SERIES && view.kind !== 'donut') {
    view.frame.series.forEach(({ key, label }, i) => {
      const on = view.visible[i] === true;
      items.push({
        key: `series:${key}`, label, pressed: on, lang: inherited, className: 'axylo-control axylo-legend-entry',
        struck: !on, swatch: swatch(i, view.cues[i] ?? null, !on, view),
      });
    });
  }
  const btn = (key: Exclude<keyof Messages, InstructionKey>, disabled = false, extra?: Partial<ToolbarItem>): ToolbarItem =>
    ({ key, label: m[key] ?? defaultMessages[key], lang: d.english(key) ?? inherited, className: 'axylo-control', disabled, ...extra });
  if (controls & RANGE) {
    items.push(
      btn('zoomIn', !(controls & CLOSER)),
      btn('selectRange', false, { pressed: rangeOn, symbol: 'range', className: 'axylo-control axylo-control-symbol' }),
    );
  }
  if (controls & (RANGE | RESET)) items.push(btn('zoomOut', !(controls & RESET)));
  if (controls & RESET) items.push(btn('panLeft', !(controls & LEFT)), btn('panRight', !(controls & RIGHT)), btn('resetZoom'));
  if (d.streaming) items.push(d.paused ? btn('resume', false, { key: 'pause', action: 'resume' }) : btn('pause'));
  if (controls & INSPECT) {
    const open = table !== null;
    items.push(btn(open ? 'hideTable' : 'viewAsTable', false, { key: 'table', expanded: open, controls: table ?? undefined }));
  }
  return items;
}
