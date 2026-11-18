import type { AlignedView, DonutView, Formatters, Layout, Lookup, ScatterView, View } from '../core/contracts';
import type { Messages } from '../public';
import { alignedLookup } from './aligned';
import { donutLookup } from './donut';
import { scatterLookup } from './scatter';

/** A chart kind's lookup, in buildLookup's terms (a kind's composition holds only its own). */
export type LookupBuilder = (
  view: View, layout: Layout, formatters: Formatters, messages: Messages, locale?: string, devicePixelRatio?: number,
) => Lookup;

function plotOf(layout: Layout) {
  return layout.kind === 'plot' || layout.kind === 'compact' ? layout : null;
}

export const donutLookupFor: LookupBuilder = (view, layout, formatters, _messages, locale) =>
  donutLookup(view as DonutView, plotOf(layout), formatters, locale);

export const scatterLookupFor: LookupBuilder = (view, layout, formatters, _messages, _locale, devicePixelRatio = 1) =>
  scatterLookup(view as ScatterView, plotOf(layout), formatters, undefined, devicePixelRatio);

export const alignedLookupFor: LookupBuilder = (view, layout, formatters, messages) =>
  alignedLookup(view as AlignedView, plotOf(layout), formatters, messages);

/** The optional locale is retained for callers that supplied it before Formatters owned all readouts. */
export function buildLookup(
  view: View, layout: Layout, formatters: Formatters, messages: Messages, locale?: string, devicePixelRatio = 1,
): Lookup {
  switch (view.kind) {
    case 'donut': return donutLookupFor(view, layout, formatters, messages, locale, devicePixelRatio);
    case 'scatter': return scatterLookupFor(view, layout, formatters, messages, locale, devicePixelRatio);
    default: return alignedLookupFor(view, layout, formatters, messages, locale, devicePixelRatio);
  }
}
