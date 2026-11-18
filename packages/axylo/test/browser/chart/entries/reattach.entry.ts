/**
 * A chart and the text measurer from one bundle, so the test reads the same per-document measurement cache
 * the chart uses (reattachment test, core/chart.ts).
 */
import { line } from '../../../../src/index';
import { createMeasurer, readTextStyle } from '../../../../src/core/environment';

declare global {
  interface Window {
    reattach: {
      line: typeof line;
      /** Width of `text` as the chart's measurer gives it, in the style of `element`'s text. */
      width(text: string, element: Element): number;
    };
  }
}

const measurer = createMeasurer(document);
window.reattach = { line, width: (text, element) => measurer.width(text, readTextStyle(element)) };
