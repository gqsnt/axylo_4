// axylo/cartesian, instrumented production build (__BENCH__ true), from the artifact's own
// axylo/axylo-cartesian.bench.js (built by src/cartesian-artifact.mjs). See src/cartesian.js.
// The URL is computed, so esbuild leaves the import alone: this file never contains library code.
import { cartesianAdapter } from '../cartesian.js';
const bundle = new URL('../axylo/axylo-cartesian.bench.js', import.meta.url).href;
export default cartesianAdapter({ id: 'axylo-cartesian', load: () => import(bundle) });
