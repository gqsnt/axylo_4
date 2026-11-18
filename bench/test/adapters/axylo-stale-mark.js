// Deliberately wrong theme readback: series 1 keeps the color it had before the first toggle while the other marks
// change. A signature over all marks would still alternate; the per-mark check must reject it. Test use only.
import { axyloAdapter } from '../../src/adapters/axylo-common.js';

const a = axyloAdapter('axylo-stale-mark', { renderer: 'svg' });
export default {
  ...a,
  config: 'BROKEN: series 1 mark keeps its first color',
  create(el, fix, opts) {
    const h = a.create(el, fix, opts);
    const read = h.themeColors;
    let first = null;
    h.themeColors = (e, o) => { const t = read(e, o); if (first === null) first = t.marks[1]; return { expected: t.expected, marks: t.marks.map((m, i) => (i === 1 ? first : m)) }; };
    return h;
  },
};
