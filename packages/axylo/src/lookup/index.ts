import type { Formatters, Layout, Lookup, View } from '../core/contracts';
import type { Messages } from '../public';
import { alignedLookup } from './aligned';
import { donutLookup } from './donut';
import { scatterLookup } from './scatter';

/** Pass the chart locale to format donut shares with the same locale as its value readouts. */
export function buildLookup(view: View, layout: Layout, formatters: Formatters, messages: Messages, locale?: string): Lookup {
  const plot = layout.kind === 'plot' || layout.kind === 'compact' ? layout : null;
  switch (view.kind) {
    case 'donut': return donutLookup(view, plot, formatters, locale ?? new Intl.NumberFormat().resolvedOptions().locale);
    case 'scatter': return scatterLookup(view, plot, formatters);
    default: return alignedLookup(view, plot, formatters, messages);
  }
}
