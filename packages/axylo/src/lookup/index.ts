import type { Formatters, Layout, Lookup, View } from '../core/contracts';
import type { Messages } from '../public';
import { alignedLookup } from './aligned';
import { donutLookup } from './donut';
import { scatterLookup } from './scatter';

/** The optional locale is retained for callers that supplied it before Formatters owned all readouts. */
export function buildLookup(
  view: View, layout: Layout, formatters: Formatters, messages: Messages, locale?: string, devicePixelRatio = 1,
): Lookup {
  const plot = layout.kind === 'plot' || layout.kind === 'compact' ? layout : null;
  switch (view.kind) {
    case 'donut': return donutLookup(view, plot, formatters, locale);
    case 'scatter': return scatterLookup(view, plot, formatters, undefined, devicePixelRatio);
    default: return alignedLookup(view, plot, formatters, messages);
  }
}
