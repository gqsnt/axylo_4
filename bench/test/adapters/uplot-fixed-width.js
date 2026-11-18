// Deliberately wrong: uPlot that never follows its container (no ResizeObserver), so it stays 1,200 px wide while the
// box shrinks to 400 px and back. The final geometry is right again at 1,200 px; only the check at the narrowest
// width catches it. Test use only.
import base, { createUplot } from '../../src/adapters/uplot.js';

export default {
  ...base,
  id: 'uplot-fixed-width',
  config: 'BROKEN: ignores container resizes',
  create: (el, fix, opts) => createUplot(el, fix, { ...opts, resize: false }),
};
