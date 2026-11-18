// Feature ablations (class c bounds): the table, zoom, streaming. Each removes the feature's code paths so the
// bundler can drop them; the measured delta is what the feature costs, not a shippable change.
import { edit, regex, stub, variant } from './lib.mjs';

const kinds = ['line', 'area', 'bar', 'scatter', 'donut'];
const [pre = '', from = 'base'] = process.argv.slice(2);

// ── no table: no table model, no table view, no table control actions ──
{
  const d = variant(pre + 'no-table', from);
  edit(d, 'reader/index.ts', [
    ["const table = input.table === false || compact ? null : parts.table(", "const table = true ? null : parts.table("],
    ["export const alignedReader: ReaderParts = { table: alignedTable, text: cartesianText };", "export const alignedReader: ReaderParts = { table: null!, text: cartesianText };"],
    ["export const scatterReader: ReaderParts = { table: scatterTable, text: cartesianText };", "export const scatterReader: ReaderParts = { table: null!, text: cartesianText };"],
    ["export const donutReader: ReaderParts = { table: donutTable, text: donutText };", "export const donutReader: ReaderParts = { table: null!, text: donutText };"],
  ]);
  stub(d, 'dom/interaction.ts', 'function jumpTarget(', 'return null;');
  stub(d, 'dom/interaction.ts', 'function openTable(', '');
  stub(d, 'dom/interaction.ts', 'function cellRuns(', 'return text => [{ text, lang: null }];');
  stub(d, 'dom/interaction.ts', 'function renderTable(', '');
  stub(d, 'dom/interaction.ts', 'function closeTable(', '');
}

// ── no zoom: no zoom gestures, keys, buttons or zoom() call (the view still takes a null window) ──
{
  const d = variant(pre + 'no-zoom', from);
  for (const f of ['requestZoom', 'pan', 'onWheel', 'drawSelection', 'markRange', 'endRange', 'startPinch', 'pinchMove']) stub(d, 'dom/interaction.ts', `function ${f}(`, '');
  stub(d, 'dom/interaction.ts', 'function zoomBy(', 'return false;');
  regex(d, 'dom/interaction.ts', /\b(d|c\?|next|cs\?)\.zoom(ed)?\b(?!\s*[(:])/g, 'false');
  stub(d, 'core/controller.ts', 'function zoom(domain: unknown)', '');
  edit(d, 'core/controller.ts', [["const zoomOn = zoomApplies(view, a.options.zoom) ? (a.options.zoom === 'touch' ? 'touch' as const : true) : false;", 'const zoomOn = false;']]);
}

// ── no streaming: append does nothing, no store is ever opened ──
{
  const d = variant(pre + 'no-stream', from);
  stub(d, 'core/controller.ts', 'function append(rows: unknown', '');
  for (const k of kinds) regex(d, `kinds/${k}.ts`, /openStore: [^,]+,/, "openStore: null!,");
}
