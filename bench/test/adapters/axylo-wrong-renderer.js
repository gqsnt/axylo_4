// Deliberately wrong: claims the Canvas renderer but asks Axylo for SVG, the way an adapter that omitted
// `__renderer` measured the library default (now SVG) under a Canvas label. The renderer readback must reject it.
// Test use only.
import { axyloAdapter } from '../../src/adapters/axylo-common.js';

const a = axyloAdapter('axylo-wrong-renderer', { renderer: 'svg' });
export default { ...a, config: 'BROKEN: labelled canvas, draws svg', expectRendererFor: () => 'canvas' };
