// Class (b): the table's jump-to-x parser behind the composition; donut (no x axis) passes none.
import { edit, variant } from './lib.mjs';
const d = variant(process.argv[2] ?? 'donut-jump', process.argv[3] ?? 'base');
edit(d, 'dom/interaction.ts', [
  ['  readonly sliceList: SliceList | null;\n}', '  readonly sliceList: SliceList | null;\n  /** Reads a typed jump-to value on an x axis; null for donut, whose table has categories only. */\n  readonly readPosition: typeof readPosition | null;\n}'],
  ['      try { return readPosition(value, kind, zone); } catch { return NaN; }', '      try { return parts.readPosition!(value, kind, zone); } catch { return NaN; }'],
  ["import { readPosition } from '../reader/x';", "import type { readPosition } from '../reader/x';"],
]);
for (const k of ['line', 'area', 'bar', 'scatter']) {
  edit(d, `kinds/${k}.ts`, [['sliceList: null },', 'sliceList: null, readPosition },'],
    ["import type { Composition } from '../core/composition';", "import type { Composition } from '../core/composition';\nimport { readPosition } from '../reader/x';"]]);
}
edit(d, 'kinds/donut.ts', [['sliceList: donutSliceList },', 'sliceList: donutSliceList, readPosition: null },']]);
// …and the donut table's page lookup reads categories without the x parser.
edit(d, 'reader/x.ts', [["export function readPosition(", `export function categoryPosition(value: XValue, categories: readonly string[] | null): number {
  const i = value instanceof Date ? -1 : categories?.indexOf(String(value)) ?? -1;
  if (i >= 0) return i;
  return typeof value === 'number' && Number.isInteger(value) ? value : NaN;
}

export function readPosition(`], ["  if (kind === 'category') {\n    const i = value instanceof Date ? -1 : categories?.indexOf(String(value)) ?? -1;\n    if (i >= 0) return i;\n    return typeof value === 'number' && Number.isInteger(value) ? value : NaN;\n  }", "  if (kind === 'category') return categoryPosition(value, categories);"]]);
edit(d, 'reader/table.ts', [["import { readPosition } from './x';", "import { categoryPosition, readPosition } from './x';"], ["pageForX(x) { return page(readPosition(x, 'category', null, frame.labels), rowCount); },", "pageForX(x) { return page(categoryPosition(x, frame.labels), rowCount); },"]]);
