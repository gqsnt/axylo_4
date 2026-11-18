// Gzip sensitivity to module order: the same code, imports reordered (no behaviour change).
import { edit, variant } from './lib.mjs';
let d = variant('order-1');
edit(d, 'index.ts', [["import { createChart } from './core/chart';\n", ''], ["import { viewerTimeZone } from './core/environment';", "import { viewerTimeZone } from './core/environment';\nimport { createChart } from './core/chart';"]]);
d = variant('order-2');
edit(d, 'core/chart.ts', [["import { canvasRendererWith } from '../render/canvas';\nimport { svgRendererWith } from '../render/svg';\n", ''], ["import { object } from './stages';", "import { object } from './stages';\nimport { canvasRendererWith } from '../render/canvas';\nimport { svgRendererWith } from '../render/svg';"]]);
d = variant('order-3');
edit(d, 'core/controller.ts', [["import { createFormatters, type FormatSpec } from '../format';\n", ''], ["import { COMPOSITIONS } from '../kinds';", "import { COMPOSITIONS } from '../kinds';\nimport { createFormatters, type FormatSpec } from '../format';"]]);
