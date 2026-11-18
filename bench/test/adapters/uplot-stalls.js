// Deliberately wrong: a streaming uPlot whose draw record stops advancing after 290 appends, while the data it holds
// stays right (the window is still trimmed to 600). The watchdog ends the stream; the run must be recorded as
// "incomplete", never as a timing, even though the final held window passes admission. Test use only.
import base, { createUplot } from '../../src/adapters/uplot.js';

export default {
  ...base,
  id: 'uplot-stalls',
  config: 'BROKEN: draw record stops after 290 appends',
  create(el, fix, opts) {
    const h = createUplot(el, fix, opts);
    let n = 0, frozen = NaN;
    return {
      get ready() { return h.ready; },
      append(x, ys) { n++; if (n === 290) frozen = h.drawnNewestX(); h.append(x, ys); },
      drawnNewestX: () => (n >= 290 ? frozen : h.drawnNewestX()),
      describe: () => h.describe(),
      destroy: () => h.destroy(),
    };
  },
};
