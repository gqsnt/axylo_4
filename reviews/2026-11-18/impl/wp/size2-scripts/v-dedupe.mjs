// Exact duplicate helpers made one (behaviour-neutral): once, sameRemainder, pageDistance, setText, object,
// lowerBound, sameStyle.
import { edit, remove, variant } from './lib.mjs';
const d = variant(process.argv[2] ?? 'dedupe', process.argv[3] ?? 'base');
edit(d, 'format/number.ts', [['\nfunction once(report', '\nexport function once(report']]);
remove(d, 'format/time.ts', 'function once(report');
edit(d, 'format/time.ts', [["import { dateTimeFormat } from './intl';", "import { dateTimeFormat } from './intl';\nimport { once } from './number';"]]);
edit(d, 'data/store-rows.ts', [['\nfunction sameRemainder(', '\nexport function sameRemainder(']]);
remove(d, 'data/store.ts', 'function sameRemainder(');
edit(d, 'data/store.ts', [["import { FrameSource, RowRevisions, StreamRows } from './store-rows';", "import { FrameSource, RowRevisions, StreamRows, sameRemainder } from './store-rows';"]]);
remove(d, 'core/focus.ts', 'export function pageDistance(');
edit(d, 'core/focus.ts', [["import { lowerBound } from '../lookup/search';", "import { lowerBound, pageDistance } from '../lookup/search';"]]);
remove(d, 'dom/figure.ts', 'function setText(');
remove(d, 'dom/tooltip.ts', 'function setText(');
edit(d, 'dom/attributes.ts', [['\nexport function setAttr(', '\nexport function setText(node: Node, text: string): void {\n  if (node.textContent !== text) node.textContent = text;\n}\n\nexport function setAttr(']]);
edit(d, 'dom/figure.ts', [["import { setAttr } from './attributes';", "import { setAttr, setText } from './attributes';"]]);
edit(d, 'dom/tooltip.ts', [["import { mappingOf } from './mapping';", "import { mappingOf } from './mapping';\nimport { setText } from './attributes';"]]);
edit(d, 'data/options.ts', [['\nfunction object(value', '\nexport function object(value']]);
remove(d, 'core/stages.ts', 'export function object(');
edit(d, 'core/stages.ts', [["import { sameValue, INTERNAL_KEYS, type OptionRecord } from './options';", "import { sameValue, INTERNAL_KEYS, type OptionRecord } from './options';\nimport { object } from '../data/options';\nexport { object };"]]);
remove(d, 'data/store-unaligned.ts', 'function lowerBound(');
edit(d, 'data/store-unaligned.ts', [["import { Reports } from './reports';", "import { Reports } from './reports';\nimport { lowerBound } from '../lookup/search';"]]);
remove(d, 'core/controller.ts', 'function sameStyle(');
edit(d, 'core/controller.ts', [['!sameStyle(textStyle, next)', '!sameTextStyle(textStyle, next)'],
  ["import { zoomApplies } from './focus';", "import { zoomApplies } from './focus';\nimport { sameTextStyle } from './environment';"]]);
