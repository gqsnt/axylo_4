# N9b — `axylo/hierarchy` (`treemap` + `sunburst`): ledger

Author lane (Claude, `ts_builder` role, model `claude-opus-5-5` per harness environment) in the isolated Prism
workspace `runs/work/opus-5-01530a` (no `.git` here). **Ran and saw** and **expected / not run** are kept apart.
Nothing was committed (the coordinator commits). No browser was launched in this turn.

**Repair round 1** (see the section of that name below) was done in workspace `runs/work/opus-5-008d37` against
the eight blocking findings of review `sol-6.2-medium__20261127T165609Z`. Requested: `ts_builder` role (the
Director's routing names `opus-5.5-high`). Observed from the harness environment: model `claude-opus-5-5`;
the effort level is not visible to this lane. Sections below that the repair changed are updated in place;
the "Commands run" section of the first build is kept as history, and the repair's own final outputs are in
"Repair round 1 → Ran and saw".

## Ownership fence

`find . -newermt @<session start> -type f` (excluding `node_modules`, `.prism-cache`, `packages/axylo/dist`)
lists only these files, all new:

| File | What |
|---|---|
| `packages/axylo/src/hierarchy.ts` | Entry: `treemap`, `sunburst`, `validateTreemap`, `validateSunburst`, types. |
| `packages/axylo/src/hierarchy/tree.ts` | Shared model: nested / flat input → pre-order typed arrays, rollup, AX190–AX192, shares, paths. |
| `packages/axylo/src/hierarchy/core.ts` | Options, patch rule, `prepare` (validation + reader), DOM-free `validateHierarchy`. |
| `packages/axylo/src/hierarchy/reader.ts` | Messages, the per-node text, the unpaginated five-column `TableModel`, the summary. |
| `packages/axylo/src/hierarchy/nav.ts` | Hierarchical keyboard movement and click targets (pure). |
| `packages/axylo/src/hierarchy/draw.ts` | SVG helpers, paints (CSS expressions through CSSOM), label fitting. |
| `packages/axylo/src/hierarchy/styles.ts` | The hierarchy charts' own constructable stylesheet (tokens light/dark/forced, structure). |
| `packages/axylo/src/hierarchy/chart.ts` | Browser host: figure, breadcrumb nav, plot (`role="tree"`), tooltip, table; handle; strict commit. |
| `packages/axylo/src/hierarchy/treemap/layout.ts`, `render.ts` | Squarified layout + picking; tiles, headers, labels, outlines. |
| `packages/axylo/src/hierarchy/sunburst/layout.ts`, `render.ts` | Radial partition + picking + sector paths; arcs, labels, center disc, outlines. |
| `packages/axylo/test/hierarchy/*.test.ts`, `fake-dom.ts`, `fixtures.ts` | Unit, fast-check property and public-handle tests (Node). |
| `packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts` | Real-Chrome + axe suite (**not run here**). |
| `docs/progress/n9b-hierarchy-ledger.md` | This file. |

Zero edits to `public.ts`, `core/**` (incl. `contracts.ts`), `dom/**`, `render/**`, `theme/**`, `export*`,
`spatial/**`, `package.json`, `scripts/*`. Shared modules are imported read-only: `core/delivery` (`Delivery`,
`StrictError`, `strictViolations`, `diagnosticKey`), `diagnostics/collector`, `diagnostics/registry`
(`createDiagnostic` for AX140/AX150/AX160 only), `format/number` (`createNumberReadout`, `shareText`),
`theme/palette` (`LIGHT`, `DARK`). **No contract change is needed.**

## Architecture decision: a standalone host, not the shared controller

The shared controller/interaction (`core/controller.ts`, `dom/interaction.ts`) hard-codes donut and Cartesian key
semantics (`ArrowUp`/`ArrowDown` = next/previous slice, `Escape` = unpin, `Enter` = select) and its `Frame`/`View`
unions have no hierarchy shape. The brief's keys (Left/Right siblings, Down/Enter child, Up/Escape parent,
Home/End) cannot be expressed through `Composition` without editing `dom/interaction.ts` (forbidden). So
`hierarchy/chart.ts` is its own small host over the same delivery, diagnostics and formatting modules. Cost:
features of the shared figure that are not re-implemented here (see "Not done").

## What was built

### Model (`tree.ts`)
- **Input.** `data` is a nested tree (one object = the root; an array = several top-level nodes under a made-up
  root named `rootLabel`, else the title, else "All") **or** flat rows. Flat is detected by a `parent` key on any
  row (nested nodes never have one). Flat rows with a `null`/`undefined`/`''` parent are top-level; one top-level
  row is the root, several get a made-up root.
- **Typed arrays, pre-order.** `parent` `Int32Array`, `depth` `Uint32Array`, CSR children (`childStart`,
  `childList`), `sibling`, `value` `Float64Array`, scaled totals `mant` `Float64Array` + `expo` `Int32Array`,
  `state` `Uint8Array`, `row` `Int32Array`; `labels` and `ids` are string arrays (one string per node, as
  category names elsewhere). Input is read straight into growable typed columns (`Columns` in `tree.ts`): no
  draft record and no stack record per node. The nested walk keeps its stack as a caller-object array plus an
  `Int32Array` of parents, and its active ancestors as a `Set` (constant-time cycle test, linear overall); the
  flat walk uses `Int32Array` stacks. No recursion (20,000- and 200,000-level chains are tested).
- **Rollup.** Bottom-up in one reverse pre-order pass. Only finite leaf values ≥ 0 contribute. A branch's own
  `value` is ignored (its value is its children's sum). Every subtree keeps its own scaled total
  `mant · 2^expo` (`mant` in [1, 2)): a branch sums its children at the scale of its largest child. Shares are
  `ratio(a, b)` of two scaled totals, so a 1e-200 : 2e-200 branch beside a 1e200 sibling keeps its exact
  1/3 : 2/3 split, and a total above `Number.MAX_VALUE` keeps exact shares (its `value` reads "more than
  1.797…e308"). `% of Root` is always of the original root, whatever is drilled.
- **Ids (repair round 3).** Flat: the row's `id` as text, untouched (duplicates are AX191). Nested, built in
  two linear stack-free passes (read, then name in pre-order with typed-array child lists):
  - an explicit `id` that is non-empty and occurs **once in the whole tree** is the node's public id on its
    own, escaped (`\`, `/`, `#` get a backslash; an ordinary id reads as written: `id: 'ops'` → `ops`). It does
    not depend on ancestors, siblings, their order or generated suffixes; descendants without their own unique
    id get paths under it (`ops/x`), so the whole subtree keeps its ids wherever it moves.
  - every other node — label-only, or carrying an explicit id **repeated** somewhere in the tree — gets a path:
    its escaped explicit id, else label, else pre-order index, joined by `/` to its parent's id (no prefix for
    the root and for top-level nodes of a forest): `Company/Sales`. A path already taken gets `#2`, `#3`, …;
    among siblings, repeated explicit ids claim their paths first in the caller's order, then labels.
  - collision freedom: every once-used explicit id is reserved before any path is made, so a generated id
    that would equal it (only possible for an unprefixed root/top-level component) is numbered instead
    (`ops#2`), never the explicit one. Distinct explicit ids escape to distinct strings; a `#n` suffix or a
    joining `/` is unescaped, which an escaped explicit id never contains. A made-up root is `''`.
  - **repeated explicit ids are ambiguous** and are not stable identities: each occurrence gets a path
    (`R/Region/ops`, `R/Region#2/ops`) that follows position, like a label.
  `drill(id)`, the focus/drill continuity across updates and the handle's points use these.
- **Row indexes** in diagnostics: flat = the caller's row index; nested = the caller's node index in pre-order
  (the only stable "row" a nested tree has).

### Diagnostics (AX190–AX192; AX193/AX194 unused)
Local factory `createHierarchyDiagnostic` (the finance/core.ts pattern), public string codes, `DiagnosticSink`.

| Code | Level | Effect | Condition | Recovery |
|---|---|---|---|---|
| AX190 (`field: 'value'`) | warning | `omitted` | Leaf value missing (`null`/`undefined`), negative, NaN, ±∞ or not a number; `rows` = caller rows (flat) / caller pre-order indexes (nested), first 10 | Leaf kept (table, tooltip, keyboard) reading "No data" / "Not shown: invalid value"; contributes 0 |
| AX190 (`field: 'value'`) | warning | `changed` | A branch total passes the largest double | Drawn from scaled totals (exact proportions); total reads "more than …"; disclosed in the note |
| AX191 (`field: 'parent'`) | warning | `omitted` | Flat: parent id not found, own parent, cycle (and their descendants) | That node and its descendants are left out |
| AX191 (`field: 'id'`) | warning | `omitted` | Flat: row without a usable id, or a duplicate id (2nd+) | That row is left out |
| AX191 (`field: 'children'`) | warning | `omitted` | Nested: an object that contains itself (rows = the repeat's pre-order index) | The repeat is left out |
| AX192 | warning | `none` | Nothing positive to draw (empty, no data, all zero, all invalid) | Empty state message; plot is `role="img"` |

All are `origin: 'call'`, so `strict: true` rejects the create/update that finds them. AX160 (a value formatter
that throws) is `presentation` and never thrown. AX140 (no title/labelledBy) and AX150 (unknown option key) come
from the shared registry.

### Treemap (`treemap/layout.ts`, `render.ts`)
- Bruls–Huizing–van Wijk squarify: children sorted by weight (ties keep input order), rows grown while the worst
  aspect ratio does not get worse, laid along the shorter side. The last tile of a row and the last row take
  exactly what is left, so **Σ child area = parent inner area** (float tolerance only).
- Nested branches get an 18 px header strip (when ≥ 2× that tall and wide) and 2 px padding (when room);
  inner area = rect − header − padding. The drilled root fills the plot with no header (the breadcrumb names it).
- Leaves: palette fill of their top-level ancestor; 1 px background stroke = ≥ 1 px separator (A5).
  Branches: background fill + muted outline + bold header label.
- Labels: fitted by binary search on the prefix with an ellipsis; omitted when the tile is shorter than one line
  + padding or nothing fits. Full label always in tooltip, focused tree item, breadcrumb `title` and table.
- Zero-weight children get an empty tile at the inner corner (laid out, never overlapping).

### Sunburst (`sunburst/layout.ts`, `render.ts`)
- Drilled root = center disc spanning the full turn; equal ring thickness `R / (levels + 1)`; child arcs split
  the parent's span exactly by weight in input order; the last positive child ends exactly at the parent's end.
- Angles clockwise from 12 o'clock with the donut convention `x = cx + sin(a)·r`, `y = cy − cos(a)·r`; a full
  turn is drawn as two half arcs. Separator: 1.5 px background stroke. Deeper rings of a family are lighter
  (`fill-opacity` down to 0.55) so ring boundaries do not rest on the separator alone.
- Labels: horizontal at the arc's mid angle/radius, kept only if all corners and edge midpoints of the label box
  stay inside the sector (else cut, else omitted). Center: the drilled root's label.

### Interaction and reader (`chart.ts`, `nav.ts`, `reader.ts`)
- **Structure.** `<figure class="axylo-hierarchy">` → header (`<hN>` title, `<nav aria-label="Hierarchy path"><ol>`
  breadcrumb — ancestors as buttons, current as `<span aria-current="location">`), visually hidden summary and
  key instructions, the plot (`role="tree"`, `tabindex=0`, `aria-activedescendant` → one visually hidden
  `role="treeitem"` that carries the focused node: `aria-level/-setsize/-posinset/-expanded`, text
  "Path: value. % of Parent x, % of Root y."), the aria-hidden SVG, the aria-hidden tooltip, the table toggle
  and a focusable `role="region"` holding the table. The breadcrumb uses the figure-header route (the
  `InteractionParts.sliceList` route only yields a `<ul>` and is not used by this host).
- **Pointer.** Hover → deepest node under the pointer, tooltip (path, value, % of parent, % of root) placed
  beside the pointer, never over it; `hover` event. Click activates by chart (pure `activate` in `nav.ts`):
  **treemap** — a branch (its header strip) drills in, a leaf is selected in place (`select`, focus moves to
  it, the parent is never opened); **sunburst** — any arc, a leaf included, is promoted to the center (`drill`).
  A click on the drilled root (sunburst center, treemap plot area of the root) goes up one level.
- **Keyboard** (pure `navigate`): Left/Right siblings (stop at ends), Home/End first/last sibling, Down first
  child, Up/Escape parent (from the drilled root the view goes up too, focus to the parent). Enter/Space use the
  same activation rule as a click: treemap branch drills (focus on its first child), treemap leaf `select`,
  treemap drilled root goes into its first child; sunburst arc is promoted (branch: focus on its first child;
  leaf: focus stays on it). On the sunburst center (the top-level root or a drilled branch) Enter/Space go to
  its first child, as ArrowDown does (repair round 2); only a centered leaf, having no child, goes up with focus
  kept on it. A click on the center still goes up. Escape closes a visible
  pointer tooltip (I1) **and on the same key ascends** when the focused node has a parent; at the top root it
  only dismisses (pointer tooltip and keyboard reading). A dismissed pointer tooltip stays closed until the
  pointer reaches another datum. Focus ring (3 px focus token) and keyboard tooltip show only for keyboard focus
  (`:focus-visible` or a key press), not after a click.
- **Leaf roots and empty drilled roots.** A positive one-node treemap is drawn as one full tile. A sunburst keeps
  a promoted leaf at its center across updates that keep its id. A drilled node whose subtree has nothing
  positive shows a visible (aria-hidden) "Nothing to show in {label}…" message; the plot stays a `role="tree"`,
  and the breadcrumb, Up/Escape and a click on the plot go back up. AX192 (whole tree empty) is still the
  `role="img"` empty state.
- **Focus continuity.** Breadcrumb jump focuses the ancestor's child on the old path; center ascent keeps the
  old root focused; an update keeps drilled root and focus by id (else the root).
- **Same text everywhere.** Tooltip, tree item, breadcrumb crumbs (`handle.breadcrumb`) and table read one
  `NodeText` per node (`reader.ts`), formatted by `createNumberReadout` (value + unit/format) and `shareText`.
- **Handle.** `update`, `on('hover'|'select'|'drill')`, `drill(id|null)`, `diagnostics`, `table` (committed
  unpaginated `TableModel`, `pageSize = rowCount`; null with `table: false`), `breadcrumb`, `drilled`, `focused`,
  `element` (the figure), `destroy`. `table`, `breadcrumb`, `drilled` and `element` are what `p2_w4_wire` needs
  to attach `Symbol.for('axylo.export')`.
- **Strict.** `update` merges the patch (present key replaces, `undefined` resets, data borrowed, never walked),
  runs `prepare`; if strict with a call-origin warning/error, findings go to that call's `onDiagnostic`, a
  `StrictError` is thrown, and nothing changed (model, diagnostics, drill, focus, open table, DOM). A strict
  create throws before mounting anything.
- **Theme.** Paints are CSS expressions set via CSSOM: `var(--axylo-forced-series, var(--axylo-series-k,
  var(--axylo-h-series-k)))`, `var(--axylo-background, var(--axylo-h-bg))`, …; defaults come from the shared
  palette, dark via `prefers-color-scheme`, forced colors via `CanvasText`/`Canvas`/`Highlight`. Labels have a
  background halo (`paint-order: stroke`), so they read on any fill and under forced colors.

## Decisions where the brief or spec left room (for review)

1. **Own stylesheet, not `theme/css.ts`.** Importing `theme/styles` pulls `AXYLO_CSS`, whose module-level
   template calls survive `ignoreAnnotations: true` (measured: 25,306 raw bytes for a bare import). So the
   hierarchy stylesheet is built inside a function and adopted on first create. Consequence: the hierarchy
   charts do not run the shared backdrop probe; light/dark follow `prefers-color-scheme`, and the figure paints
   its own background so contrast holds on any page. An author's `--axylo-*` public properties still apply.
2. **All three codes are warnings.** AX192 is "nothing to draw", shown as the empty state (like `state: {empty}`),
   not the error state. AX190/AX191 leave data out and say so. Owner may prefer AX192 as `error`.
3. **Missing leaf values are AX190**, not silently zero ("never guess silently").
4. **Sibling order** is the caller's order (keyboard, table, sunburst). The treemap sorts by size only for
   placement, so arrow order and visual order differ on a treemap; the table and keyboard agree.
5. **Table** lists the whole tree (not the drilled subtree), unpaginated; `% of Root` is of the whole tree, also
   in the tooltip while drilled. Root row: `% of Parent` reads "—".
6. **`role="tree"` with one active-descendant item** instead of one DOM element per node, with the brief's keys
   (they differ from the WAI-ARIA tree pattern's Left/Right = collapse/expand); the instructions say so.
7. **Diagnostic `chart` name**: the title, else the generated "Treemap chart"/"Sunburst chart" (not the
   element id).
8. **Up from the drilled root** moves both view and focus to the parent (consistent "Up = parent"); clicking the
   sunburst center instead keeps the old root focused.
9. **Test expectation I corrected (my own, not spec-given):** a first draft expected a 1e-300 share next to 1 to
   get a positive treemap area. That cannot hold in doubles (100 − 1e-298 = 100). The test now checks a
   representable tiny share (1e-9 → positive area) and, separately, that a 1e-300 share is laid out with
   no representable area while the total is conserved.

## Commands run and what they printed (ran and saw)

All from the workspace root unless noted. Scratch scripts live in `.prism-cache/tmp/`.

Final pass (after the last edit):

```text
$ npm run typecheck
> typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist


$ npx vitest run packages/axylo/test/hierarchy --configLoader native --no-cache
 Test Files  4 passed (4)
      Tests  63 passed (63)
   Start at  17:54:33
   Duration  410ms (tests 58%, transform 34%, import 7%, worker 1%)

$ node .prism-cache/tmp/purity.mjs
bare import, ignoreAnnotations:true, raw bytes = 0 ""
full hierarchy entry min raw 48685 gzip-9 18774

$ node .prism-cache/tmp/ssr.mjs
DOM globals present: []
exports: sunburst,treemap,validateSunburst,validateTreemap
validateTreemap codes: AX191,AX190,AX192
validateSunburst codes: (none)
treemap in Node throws: [axylo] a hierarchy chart needs a DOM; use validateTreemap or validateSunburst in Node.

$ node .prism-cache/tmp/graph.mjs
index.ts: 114 inputs, hierarchy inputs: 0
static.ts: 115 inputs, hierarchy inputs: 0

$ npm run build
built axylo.css, axylo.dev.js, axylo.iife.js, axylo.iife.min.js, axylo.js, cartesian.d.ts, cartesian.dev.js, cartesian.js, export.d.ts, export.dev.js, export.js, finance.d.ts, finance.dev.js, finance.js, hierarchy.d.ts, index.d.ts, public.d.ts, static.d.ts, static.dev.js, static.js, stats.d.ts, stats.dev.js, stats.js, stream.d.ts, stream.dev.js, stream.js, sync.d.ts, sync.dev.js, sync.js
axylo.js raw=435488 gzip-9nc=158539 sha256=77815b3711a7782c
static.js raw=385433 gzip-9nc=141362 sha256=ebd8a118e164d08e
axylo.iife.min.js raw=435980 gzip-9nc=158765 sha256=2424f213a981c127
```

Full Node unit suite, also after the last edit (`npx vitest run --configLoader native --no-cache`):

```text
 Test Files  134 passed (134)
      Tests  2352 passed (2352)
   Start at  17:54:13
   Duration  18.61s (tests 57%, transform 33%, import 9%)
exit 0
```

What these show:
- **0 raw bytes** for a bare `import 'axylo/hierarchy'` with esbuild `bundle + minify + treeShaking +
  ignoreAnnotations: true` (`purity.mjs`, stdin `import './packages/axylo/src/hierarchy.ts'`).
- **Node SSR**: the entry bundled for `platform: 'neutral'` imports in plain Node with no DOM globals; the
  validators run; a chart create throws a clear "needs a DOM" error.
- **0 B root/static tax**: the esbuild graphs of `src/index.ts` and `src/static.ts` contain no
  `src/hierarchy` input (`graph.mjs`), so their bundles cannot change. Measured `gzip -9nc`: `axylo.js`
  158,539 B, `axylo.iife.min.js` 158,765 B, `static.js` 141,362 B; the sha256 prefixes are the same as in my
  first build of this session (taken before the later hierarchy edits), as expected. I could not build the
  baseline tree itself (no `.git` here, and the source repo is not mine to build in); the Coordinator can `cmp`
  these hashes against a baseline build.
- The hierarchy entry itself (not wired yet): 48,685 B minified, 18,774 B gzip-9 (largest inputs: `chart.ts`
  11.2 kB, shared `diagnostics/registry.ts` 7.0 kB, `tree.ts` 5.6 kB, `styles.ts` 4.5 kB).

Test inventory (63 Node tests, 4 files):
- `tree.test.ts` (20): nested/flat rollup, shares and table rows by hand; flat ≡ nested; made-up root; five-column
  unpaginated table; property: every branch = Σ children (integers, exact) and child shares sum to 1;
  determinism; AX190 (negative/NaN/∞/string/missing) with rows and counts; zero is valid; overflow → AX190
  `changed` with exact 0.5 shares; tiny positive shares; AX191 orphans/self-parent/cycle/duplicates with
  descendants; nested self-containment; shared object ≠ cycle; AX192 ×4; 20,000-level chains; validators in Node;
  AX140/AX150.
- `layout.test.ts` (15): Bruls et al. first steps for 6,6,4,3,2,2,1 in 6×4 worked by hand; 2×2 grid; property
  (200 runs): inner-area conservation, no sibling overlap, children inside the inner rect, area ∝ weight; zero
  tiles and picking; drilled subtree; tiny and sub-resolution shares; overflow proportions; sunburst 12 o'clock
  clockwise geometry, picking and the SVG arc start; property: Σ root child spans = 2π, each parent span conserved
  and split by weight, last positive child ends at the parent's end; property: ring monotonicity; drilled center;
  `inSector`; `fitLabel` cases and property.
- `nav.test.ts` (5): fixture moves; Enter/Space drill vs select; up from the drilled root; click targets;
  property (400 runs) of the parent/child/sibling invariants and that focus never leaves the drilled subtree.
- `handle.test.ts` (23, both handles via `describe.each`): structure and destroy; **strict update rollback**
  (data, diagnostics, drilled root, focus, tree item, breadcrumb, open table) then a valid update keeping the
  drill by id; strict create mounts nothing; strict → non-strict retry; keyboard path with ARIA attributes and
  focus ring; Enter on a leaf selects; breadcrumb return; tooltip = tree item = breadcrumb = table texts;
  `table: false`; AX160 never thrown under strict; treemap pointer hover/drill/leave; sunburst arc click /
  center ascent; label fitting/omission/non-overlap (treemap) and sector-fit omission (sunburst); F12 note;
  AX160 found after an update is delivered once, as presentation.

### Scratch scripts (in `.prism-cache/tmp/`, excluded from the patch; reproduced here)

`purity.mjs`:

```js
import { build } from 'esbuild';
const r = await build({
  stdin: { contents: "import './packages/axylo/src/hierarchy.ts';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', minify: true, treeShaking: true, ignoreAnnotations: true,
  define: { __DEV__: 'false' }, logLevel: 'silent',
});
console.log('bare import, ignoreAnnotations:true, raw bytes =', r.outputFiles[0].contents.length, JSON.stringify(r.outputFiles[0].text));
const r2 = await build({
  stdin: { contents: "export { treemap, sunburst, validateTreemap, validateSunburst } from './packages/axylo/src/hierarchy.ts';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', minify: true, define: { __DEV__: 'false' }, logLevel: 'silent',
});
const { gzipSync } = await import('node:zlib');
console.log('full hierarchy entry min raw', r2.outputFiles[0].contents.length, 'gzip-9', gzipSync(r2.outputFiles[0].contents, { level: 9 }).length);
```

`graph.mjs`:

```js
import { build } from 'esbuild';
for (const e of ['index', 'static']) {
  const r = await build({ entryPoints: [`packages/axylo/src/${e}.ts`], bundle: true, write: false, metafile: true, format: 'esm', define: { __DEV__: 'false' }, logLevel: 'silent',
    plugins: [{ name: 'css', setup(b) { b.onLoad({ filter: /theme[\\/]css\.ts$/ }, () => ({ contents: 'export const AXYLO_CSS = "";', loader: 'js' })); } }] });
  const inputs = Object.keys(r.metafile.inputs);
  console.log(`${e}.ts: ${inputs.length} inputs, hierarchy inputs: ${inputs.filter(i => i.includes('src/hierarchy')).length}`);
}
```

`ssr.mjs`:

```js
import { build } from 'esbuild';
const r = await build({
  entryPoints: ['packages/axylo/src/hierarchy.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral',
  define: { __DEV__: 'false' }, logLevel: 'silent',
});
const url = 'data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64');
console.log('DOM globals present:', ['document', 'window', 'HTMLElement', 'navigator'].filter(k => typeof globalThis[k] !== 'undefined' && k !== 'navigator'));
const mod = await import(url);
console.log('exports:', Object.keys(mod).sort().join(','));
const d = mod.validateTreemap({ title: 'T', data: [{ id: 'a', parent: null }, { id: 'b', parent: 'a', value: -1 }, { id: 'c', parent: 'zz', value: 1 }] });
console.log('validateTreemap codes:', d.map(x => x.code).join(','));
console.log('validateSunburst codes:', mod.validateSunburst({ title: 'T', data: { label: 'R', children: [{ label: 'x', value: 2 }] } }).map(x => x.code).join(',') || '(none)');
try { mod.treemap('#x', { data: [] }); } catch (e) { console.log('treemap in Node throws:', e.message); }
```

## Not done / not verified

- **Browser suite not run** in the first build nor in repair round 1 (worker rule). Pending for the Coordinator — exact command:
  `npm run build && AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts`
  (or `npm run test:browser -- packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts`). It needs
  `dist/axylo.iife.js` + `dist/axylo.css` only for the shared test page; the hierarchy code is bundled in memory.
  Risks I could not check without Chrome: axe `color-contrast` on SVG `<text>` labels (fill is the text token
  over a halo; axe may report them as incomplete), `:focus-visible` after a breadcrumb click, the sampled sector
  interior point helper.
- Not re-implemented from the shared figure: `subtitle`, `state` (loading/error), `legend`, `lang="en"` marking of built-in strings (A10), AX141 contrast
  probe, compact variant, touch-specific handling, resize debouncing (a `ResizeObserver` redraws synchronously).
- Table is unpaginated by design (brief): a 100,000-node tree builds 100,000 rows when opened, and a very deep
  chain makes path strings O(depth²) in total.
- `axylo/hierarchy` is not in `package.json`/`scripts/build.mjs`/`scripts/size.mjs` (Director's `p2_w4_wire`).
- Independent cross-provider review: not done by this lane.

## Repair round 1 — review `sol-6.2-medium__20261127T165609Z` (eight blocking findings)

Workspace `runs/work/opus-5-008d37`, same fence. Files changed (all inside the fence; `find -newermt` over the
workspace, excluding `node_modules` and `.prism-cache`, lists only these): `src/hierarchy/{tree,core,reader,
nav,chart}.ts`, `src/hierarchy/treemap/{layout,render}.ts`, `src/hierarchy/sunburst/layout.ts`,
`test/hierarchy/{tree,layout,nav,handle}.test.ts`, new `test/hierarchy/review.test.ts`,
`test/browser/chart/n9b-hierarchy.browser.test.ts`, this ledger. No contract change needed.

### Decisions, by finding

1. **Activation by chart** (`nav.ts` `activate`, used by both click and Enter/Space). Treemap: a branch drills
   (focus on its first child), a leaf is `select`ed in place and focused, never opening its parent; Enter on
   the treemap's drilled root goes into its first child (the root is the whole plot). Sunburst: any non-center
   arc, a leaf included, is promoted to the center (`drill` event; a branch focuses its first child, a leaf
   keeps focus on itself); activating the centered node (center click or Enter) goes up with focus kept on it.
   `drill(id)` accepts a leaf on a sunburst only; an update keeps a sunburst leaf root when its id survives.
2. **Escape** dismisses a visible pointer tooltip and, on the same key, ascends when the focused node has a
   parent. At the top root it only dismisses (pointer tooltip and keyboard reading). A dismissed pointer
   tooltip stays dismissed while the pointer stays on that datum.
3. **Subtree-local scaled totals** replace the single global `weight`/`scale`: `mant · 2^expo` per subtree,
   summed per branch at its largest child's scale; layout and `% of Parent` use `ratio(child, parent)`; `% of
   Root` uses `ratio(node, 0)` of the original tree. Covered: siblings 1e200 / {1e-200, 2e-200} (local shares
   1/3, 2/3 in the model and table; both drilled layouts: treemap areas 1 : 2 of the plot, sunburst spans
   2π/3 and 4π/3 covering the full turn), overflowing 1e308 siblings (exact 1 : 2 : 1), and a property over
   magnitudes 1e-300…1e300.
4. **Leaf root tile and drilled empty state.** A positive leaf root is drawn as one tile (fill: palette slot 1).
   A drilled zero-valued branch shows a visible message (`messages.emptyBranch`, aria-hidden; the focused item
   reads the value) while the plot stays a navigable tree; ascent by breadcrumb, Up/Escape and plot click.
5. **Revisions.** Each commit (and destroy) bumps `revision`; each commit, drilled-root change and destroy bumps
   `view`. Every prepared state gets its own presentation sink, which drops findings unless that state is the
   committed one — so reads through an old `TableModel` never deliver or attach AX160 to the new revision. The
   reader's summary is lazy, so validation never runs the author's formatter. Draw steps that run author code
   (`node()`, table rows, summary) check the revision before writing and build DOM before swapping it in.
   Diagnostics and events are queued with payloads taken (and frozen) at once and handed out when the
   outermost chart work ends — after DOM and handle agree — skipping a diagnostic of a replaced revision and an
   event of a replaced view; a destroy stops dispatch. `breadcrumb` re-reads if author code moved the chart on.
6. **Delivery and disclosure.** The committed revision tracks what its handler was handed (`sentTo`/`sent`): a
   replacement handler — on a strict-rejected call or a committed one — gets every finding it has not seen.
   AX190 carries `field: 'value'`; flat AX191 is split into `field: 'parent'` and `field: 'id'`; nested AX191
   carries `field: 'children'`; rows are the caller's row indexes (flat) or pre-order node indexes (nested).
   The note (figure, and named in the plot's `aria-describedby`) now also discloses `changed` findings:
   overflow (`messages.totalsCapped`) and formatter fallback (`messages.formatFallback`, updated when found late).
7. **Unique nested ids**: escaped components, `#k` suffix for repeats, one id used by lookup, `drill`, events
   and update restoration.
8. **Linear construction**: columnar input storage (`Columns`), typed stacks, `Set` of active ancestors; the
   sunburst picker follows child links from the drilled root without the per-move `subtreeEnd` scan.

Browser test changes (not run): the leaf-click shortcut is gone; per-chart activation tests click the real
treemap branch header (asserting the click point is above the children), select a treemap leaf in place, and
promote a sunburst leaf by click and by Enter, then return by the center and the breadcrumb with focus
assertions in the DOM and in Chrome's accessibility tree (the suite's own `axOf` helper from
`test/browser/acceptance/util.ts`: CDP `DOM.describeNode` + `Accessibility.getPartialAXTree`; asserted: the tree
or its item is `focused`, the item's role is `treeitem`, its computed name and `level`). A mixed pointer +
Escape case is added. Risk I could not check: whether Chrome reports the `focused` state on the tree or on the
active-descendant item — the assertion accepts either, and requires one.

### Ran and saw (final pass, after the last edit)

Recorded in the report of this round; the exact outputs are repeated here.

```text
$ npm run typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
(exit 0)

$ npx vitest run packages/axylo/test/hierarchy --configLoader native --no-cache
 Test Files  5 passed (5)
      Tests  95 passed (95)

$ node .prism-cache/tmp/n9b-ssr.mjs
bare import (ignoreAnnotations: false): 0 raw bytes
bare import (ignoreAnnotations: true): 0 raw bytes
DOM globals present: []
validateTreemap codes: AX191:parent AX190:value AX192:
validateSunburst codes: []
treemap in Node throws: [axylo] a hierarchy chart needs a DOM; use validateTreemap or validateSunburst in Node.

$ node .prism-cache/tmp/n9b-graph.mjs
index.ts: 114 inputs, hierarchy inputs: 0
static.ts: 115 inputs, hierarchy inputs: 0
full hierarchy entry min raw 51837 gzip-9 20207
```

Package-scoped Node run (`npx vitest run packages/axylo --configLoader native --no-cache`), first pass during
this round: `Test Files 1 failed | 129 passed (130)`, `Tests 1 failed | 2133 passed (2134)`. The one failure is
outside the fence and does not import hierarchy code: `test/core/final-review.test.ts` > "what is drawn after
each frame is the model's window…" (fast-check `seed: -1569745957, path: "28:4:13:12"`, `expected 3 to be
close to -3`). That file alone passed 3 of 3 reruns (42/42). I did not investigate it further; it is not a
repaired pass of anything and is reported as seen. Final package run, after the last edit: `Test Files 130
passed (130)`, `Tests 2136 passed (2136)`, exit 0 (randomly seeded property tests; one passing run does not
clear the earlier `core/final-review` seed).

Mutation checks of the new Node regressions (patch one guard out of `chart.ts`, run, restore; restoration
checked with `cmp`): removing the presentation-owner check, the per-draw stale check in the tree item, the
Escape ascent, emit deferral, per-handler delivery tracking, both event-view checks, or sunburst leaf-root
retention each fails at least one test. Two single mutants survived because a second guard covers the same
case (outer vs inner event-view check; late-finding deferral vs the per-draw stale check).

### Remaining for the Coordinator

- Browser: `npm run build && AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts`
  (or `npm run test:browser -- packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts`).
- Package wiring (`./hierarchy` export, build, size) and `Symbol.for('axylo.export')` stay with `p2_w4_wire`.
- Fresh independent review of this sealed candidate.

## Repair round 2 — review `sol-6.2-medium__20261127T171804Z` (four blocking findings)

Workspace `runs/work/opus-5-0076fe` (no `.git`), same fence. Requested role `ts_state_writer` (the Director's
routing names `opus-5.5-high`). Observed from the harness environment: model `claude-opus-5-5`; the effort level
is not visible to this lane. No browser launched, no `npm pack`, nothing in `/tmp`, no package wiring or fixed
contract touched, nothing committed. Scratch in `.prism-cache/tmp`. The Director's verification of the previous
candidate (typecheck, 135 Node files / 2384 tests, 18 Chrome tests) does **not** apply to this candidate.

Files changed: `src/hierarchy/chart.ts` (transaction model, delivery bookkeeping), `src/hierarchy/tree.ts`
(explicit-id claims), `src/hierarchy/nav.ts` (Enter on the center), `test/hierarchy/tree.test.ts` (one
expected id list, see below), new `test/hierarchy/transactions.test.ts`, `test/browser/chart/n9b-hierarchy.browser.test.ts`
(source only, not run), this ledger. Items 5 and 6 of repair round 1 ("Revisions", "Delivery") are superseded
by 1 and 2 here.

### Decisions, by finding

1. **Transaction / view ownership (`chart.ts`).** The per-function `stale(rev)` guards are replaced by one
   scheme. Every piece of chart work (handle call, input event, resize) runs in `run`: it changes state at once,
   takes event payloads (`pointOf`) from the state it just set, marks the DOM parts it invalidates (`CHROME`,
   `NOTE`, `CRUMBS`, `TABLE`, `PLOT`, `ITEM`, `FOCUS`, `OVERLAY`) and bumps `epoch`. When the outermost piece
   ends, `paint` draws the marked parts in that order, then `flush` hands out notifications. A part that runs
   author code (summary, crumbs, table rows, tree item, tooltip — all through `reader.node`) reads all its text
   first; if `epoch` moved meanwhile, it writes nothing, is marked again and drawn from the new state. A nested
   call made by a formatter during `paint` only changes state and marks parts (it never draws), so the last
   change wins and nothing written refers to an index or text of a superseded model or view. Events keep
   their established rule (dropped when the view — commit, drilled-root change, destroy — has changed since
   they were queued), which now also covers same-revision drills from a formatter: drilling R/A whose crumb
   formatter drills R/B delivers exactly one `drill:R/B`; a hover, select or keyboard move superseded by a
   formatter's update or drill is not delivered. Updates stay synchronous: an update from a listener or
   `onDiagnostic` (during `flush`) paints before it returns; an update from inside a formatter is painted by the
   enclosing paint before the outer call returns. Picking (`pick`) answers only for the model and root the marks
   were drawn for. A breadcrumb button of a replaced bar does nothing. State setters no-op when nothing changes
   (no epoch bump), so a formatter that repeats an idempotent drill cannot loop; a formatter that changes the
   chart on every read is stopped after 32 superseded parts with `console.error` (assumption: an author error,
   reported rather than hung on).
2. **Delivery recorded when it happens.** `delivered` (handed to the committed handler) and `pending` (queued
   for the committed revision) replace `sent`. `flush` records a finding as delivered just before calling the
   handler; an update with the same handler keeps only findings actually delivered; a finding only queued for a
   replaced revision is queued again for the new one. A strict-rejected call treats delivered and pending
   findings as known (same handler), so nothing is handed twice. Late findings (AX160) still belong to their
   own revision and are deduped against delivered and pending.
3. **Explicit nested ids.** See "Ids" above: explicit ids claim their path before sibling labels. The one
   pre-existing expected value that encoded the old order-dependent policy (`tree.test.ts`, "duplicate sibling
   labels…", where the explicit `Ops` used to be `R/Ops#3`) was changed to the new policy, worked out by hand
   from the claim rule; this is a requested behaviour change, not a weakened check. Claims are allocated only
   for sibling lists that contain an explicit id; the walk stays iterative and linear.
4. **Enter on the sunburst center** goes to its first child (top-level root and drilled branch); a centered
   leaf still goes up; center click still goes up; leaf-arc click/Enter promotion unchanged.

### Tests added (`transactions.test.ts`, 29 tests, expected values from the fixture and the contract)

- Both report reproductions end to end: hover with a tooltip formatter that updates (no hover payload of the old
  model is delivered; tooltip hidden; next move reads the new model), and breadcrumb drill R/A → formatter
  drills R/B (one `drill:R/B`, a current crumb, the whole bar, and no crumb element ever built for R › A).
- Same-revision reentry in nearby paths: keyboard focus, leaf select, table open with update and with drill,
  update whose summary formatter drills, pointer leave, and the runaway-formatter stop.
- Diagnostics: AX191 + AX190 + AX192 with a handler that retitles on the first finding → all three once; then
  same-handler dedupe; then a replacement handler gets all three once; a handler whose update drops findings
  is not handed them, and a late AX160 still reaches it once.
- Ids: explicit vs label-only `Ops` in both orders and with colliding inserts; duplicate explicit ids; forest
  and nested claims; fast-check property (any siblings, any order: explicit ids map to `R/<escaped id>`, all
  ids unique); handle drill and focus restored through reorder and insert (both charts). Existing escaping,
  uniqueness/determinism property and the 200,000-node linear test still pass.
- Enter: pure `navigate` (initial center, drilled center, centered leaf, arc promotion, treemap unchanged), a
  fast-check property over any tree and centered node, and the public handle; browser suite source gains Enter on the top-level center (**not run**).

### Ran and saw (this round)

Mutation checks (patch, run the hierarchy suite, restore, `cmp`): the previous `chart.ts` fails 10 of the new
tests (breadcrumb ×2, hover ×2, keyboard ×2, select, runaway formatter, diagnostics ×2); the table tests also
passed on the previous `chart.ts`, so they are regression coverage only. Dropping the crumbs' epoch check
fails both breadcrumb tests; counting queued findings as delivered fails both diagnostic tests; removing the
sunburst-center Enter fails 2; removing explicit-id claims fails 7. Not every part's epoch check has its own
killing test: the item, table and tooltip checks guard transient writes that the nested change's own marks
redraw before the paint ends, so their final DOM is right either way.

Final outputs after the last edit (scratch script `.prism-cache/tmp/n9b-ssr.mjs`: esbuild bundle + minify +
tree-shaking of a bare `import './packages/axylo/src/hierarchy.ts'`, then the entry bundled for
`platform: 'neutral'` and imported in plain Node):

```text
$ npm run typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
(exit 0)

$ npx vitest run packages/axylo/test/hierarchy --configLoader native --no-cache
 Test Files  6 passed (6)
      Tests  124 passed (124)

$ npx vitest run packages/axylo --configLoader native --no-cache     (Node only; *.browser.test.ts excluded)
 Test Files  131 passed (131)
      Tests  2165 passed (2165)

$ node .prism-cache/tmp/n9b-ssr.mjs
bare import (ignoreAnnotations: false): 0 raw bytes
bare import (ignoreAnnotations: true): 0 raw bytes
full hierarchy entry min raw 52942 gzip-9 20717
DOM globals present: []
validateTreemap codes: AX191:parent AX190:value AX192:
validateSunburst codes: ["AX140"]          (no title given: the expected accessibility finding)
treemap in Node throws: [axylo] a hierarchy chart needs a DOM; use validateTreemap or validateSunburst in Node.
```

The package-scoped count (131 files) is narrower than the Director's repository run (135 files / 2384 tests);
the two are not comparable. The full hierarchy entry grew from 51,837 to 52,942 raw bytes (opt-in entry only;
the root and static bundles do not import hierarchy code, unchanged fence).

### Not done / not verified (this round)

- **Browser:** not run (worker turns must not launch Chrome). The suite source gained one Enter-on-center step
  in the sunburst test. Remaining for the Coordinator: `npm run build && npm run test:browser --
  packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts`.
- Root/static byte identity was not re-measured this round (no file outside `src/hierarchy*` changed).
- Independent cross-provider review of this candidate: not done by this lane.

## Repair round 3 — review `sol-6.2-medium__20261127T173601Z` (two blocking findings)

Workspace `runs/work/opus-5-9019df`, role `bounded_ts_fix` (the Director's routing names `opus-5.5-medium`).
Observed from the harness environment: model `claude-opus-5-5`; effort is not visible to this lane.

### Decisions

1. **Persistent AX160 and a handler that updates on each delivery** (`chart.ts`). AX160 is found while drawing,
   so every revision finds it again; the commit only carried forward deliveries of validation findings, so each
   callback's update re-queued it and `update` never returned. Now a queued finding records whether it came
   from drawing (`late`); once actually handed out it joins `lateSent`. On a non-strict commit `lateSent` is
   kept and merged into `delivered` only when the handler is the same function **and** the value format
   (`value.format`, by `Object.is`) is the same; otherwise it starts empty. The rediscovered finding is still
   pushed to the revision's late findings, so `diagnostics` and the reader note show it; only the callback is
   not repeated. Unchanged: a queued-but-superseded finding is queued again (pending is not delivered), reads
   through an old `TableModel` are dropped, a strict rejected call hands its own findings and nothing of the
   committed state it already handed.
2. **Stable explicit nested ids** (`tree.ts`): the scheme in "Model → Ids" above. Under two label-only
   `Region` siblings, `ops` and `sales` are `ops` and `sales` in either order and after colliding inserts;
   drill, focus and `drill(<pre-update id>)` survive. Label-only trees keep exactly their earlier ids, so the
   browser suite's ids (`Company/Sales`, …) are unchanged. Deliberate fixture changes (public id semantics):
   `tree.test.ts` (explicit `Ops` is `Ops`; the label-only `Ops` siblings are `R/Ops`, `R/Ops#2`) and
   `transactions.test.ts` section 3 (explicit ids are bare; a top-level label `k` beside explicit `k` is
   `k#2`; drill/focus via `Ops`, `Ops/y`). The duplicate-sibling-explicit fixture is unchanged.

### Tests added (`test/hierarchy/repair3.test.ts`, 15 tests, both handles where a handle is involved)

- AX160 with a retitling handler and a sentinel (stops after 8 callbacks): one callback, `update` returned, the
  new title committed, `diagnostics` = `[AX160]` for the new chart name, note shown; further same-handler,
  same-format updates (also a new `value` object with the same function) hand nothing; a strict rejection
  does not re-hand AX160.
- Replacement handler, unchanged format: the new handler gets AX160 once, the old never again.
- Changed throwing format, same handler: handed again once; a working format clears it; the same format back
  after a working one is handed again.
- Ids: swapped `Region` wrappers and colliding inserts; generated-vs-explicit collision (`ops#2`); escaped
  explicit `a/b` vs generated `R/a/b`; repeated explicit ids get paths; fast-check property (any order of
  wrappers, colliding labels, rooted and forest input: ids unique, each once-used explicit id and its subtree
  keep their ids); flat ids untouched; handle drill/focus/lookup through the swap for treemap and sunburst.
- Mutation checks (ran and saw, then restored): without the carry-forward 6 of these fail (the sentinel tests
  report repeated callbacks); resetting only on handler change fails the 4 format tests; resetting only on
  format change fails the 2 replacement-handler tests.


### Ran and saw (final pass, after the last edit)

```text
$ npm run typecheck
exit 0 (tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist)
$ npx vitest run packages/axylo/test/hierarchy --configLoader native --no-cache
 Test Files  7 passed (7)
      Tests  139 passed (139)
$ npx vitest run packages/axylo --configLoader native --no-cache   (Node; before the last test-only type fix)
 Test Files  132 passed (132)
      Tests  2180 passed (2180)
$ node .prism-cache/tmp/purity.mjs
bare import, ignoreAnnotations:true, raw bytes = 0 ""
full hierarchy entry min raw 53622 gzip-9 20950
$ node .prism-cache/tmp/graph.mjs
index.ts: 114 inputs, hierarchy inputs: 0
static.ts: 115 inputs, hierarchy inputs: 0
$ node .prism-cache/tmp/ssr.mjs
DOM globals present: []
exports: sunburst,treemap,validateSunburst,validateTreemap
validateTreemap codes: AX191,AX190,AX192
validateSunburst codes: (none)
treemap in Node throws: [axylo] a hierarchy chart needs a DOM; use validateTreemap or validateSunburst in Node.
```

Scripts: the `purity.mjs`, `graph.mjs`, `ssr.mjs` listed above, recreated verbatim from this ledger.

### Not done / not verified (this round)

- **Browser:** not run (worker rule). The browser suite source is unchanged and uses label-only ids, which
  this round keeps byte-for-byte. Remaining for the Coordinator: `npm run build && npm run test:browser --
  packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts`.
- Root/static byte identity not re-measured (only `src/hierarchy/*` changed; `graph.mjs` shows 0 hierarchy inputs).
- Independent cross-provider review of this candidate: not done by this lane.

## Repair round 4 — review `sol-6.2-medium__20261127T174653Z` (identity ownership on restore)

Finding: `update` restored drill and focus by public id string alone. A public id can change owner across an
update: an anonymous root `Sales` becomes `Sales#2` when a child takes the explicit id `Sales`, and that child
inherits the old root's id. In the other direction, a removed explicit `Sales` lets an anonymous `Sales`
branch inherit the id. Either way, drill and focus moved to a different node without a drill action.

### Decisions

- **The public id scheme is unchanged.** `ids`, `drill(id)` lookup, flat ids, unique explicit ids, generated
  paths and `#k` numbering are byte-for-byte as in round 3. The fix only changes the internal restore step.
- **New compact column `idKind: Uint8Array`** in `HierarchyModel` (`tree.ts`, an owned module, not a fixed
  contract). It records who owns each id: `ID_FLAT` (the caller's flat row id), `ID_EXPLICIT` (a nested
  explicit id used once in the tree), `ID_REPEATED` (a nested explicit id used more than once, so a path),
  `ID_GENERATED` (no explicit id, so a path from the label or position) and `ID_SYNTHETIC` (a made-up root
  `''`). It takes one byte per node and is filled in the same id passes. Nothing is allocated per node.
- **`restoreIndex(prev, i, next)`** replaces `indexOfId(next, prev.ids[i])` for the drilled root and the
  focus in `update` (`chart.ts`):
  - Old node 0 always maps to new node 0. The top-level view stays the top-level view, whatever id it now
    has and even when its old id now belongs to a child.
  - Otherwise the node with the same id must have the **same kind**. Flat and unique explicit ids name the
    node on their own: they are accepted with no ancestry check. A unique explicit id therefore still
    survives any reorder or rewrap of its ancestors (the round 3 property test is unchanged and passes).
  - A path (repeated explicit or generated) is only the same node when each ancestor, walking up both trees
    together, has the same id and the same kind, up to the first unique explicit ancestor (which anchors the
    path) or the root. This rejects a coincidental path string that is reused when an explicit ancestor and
    a generated ancestor swap ownership of a name, or when a generated ancestor becomes a repeated explicit id.
  - The check is iterative. It costs one id lookup plus a walk of at most the depth, only for the two
    restored nodes, and it allocates nothing.
- **Fallback for a missing or ambiguous identity:** the drilled root falls back to node 0, the top-level view.
  The focus is restored on its own by the same rule if it still lies within the root. Otherwise it falls back
  to the root. This is the same fallback as before, with stricter matching.
- **Accepted ambiguity, unchanged from round 3:** among generated siblings with the same label and the same
  kind chain, `#k` numbering is positional. Reordering such look-alike anonymous siblings can therefore move
  focus between them, which was already the documented behavior. Give the node a unique explicit id when that
  matters.

### Tests added (`test/hierarchy/repair4.test.ts`, 15 tests; both handles for every handle case)

- Model: `idKind` per kind for nested, forest and flat input. Flat ids restore across reparenting. Old node 0
  maps to new node 0. A node that disappears maps to -1. A fast-check property: for any nested tree or forest
  with repeated or explicit ids, every node restores to itself in a rebuild of the same data.
- Public handles (`treemap` and `sunburst`):
  - Review direction 1: anonymous root `Sales` with focus `Sales/East`, then an explicit child `Sales`
    (`Wholesale sales`) with its own `East`. Expected after the update: drilled is the root (depth 0, label
    `Sales`, id `Sales#2`), focus is the root, the breadcrumb is `['Sales']` and no `drill` event fires.
    `drill('Sales')` still reaches `Wholesale sales`.
  - Review direction 2: drilled into explicit `Sales` with focus `Sales/x`, then the explicit branch is
    removed and an anonymous `Sales` branch is added. Expected: drilled and focus are the made-up root `''`.
    `drill('Sales')` reaches the anonymous branch.
  - Descendants: drill `R/A` and focus `R/A/a1` under an anonymous root `R`, then `R` becomes an explicit id
    in a forest. Both fall back, and `drill('R/A')` reaches the new owner.
  - Descendants: drill `R/ops` and focus `R/ops/k`, then `ops` becomes a repeated explicit id. Both fall back.
  - Focus only: focus `R/B/b1` while the drill stays at the root, then `B` becomes repeated. The focus falls
    back. The same shape with unchanged ownership then keeps the focus, with the new value 3.
  - Positive control: a unique explicit drill survives a reorder of its anonymous ancestors.

Mutation check (ran and saw): with `restoreIndex` short-circuited to the old id-only lookup, the 10 handle
regressions fail (5 per chart). The 5 controls (model, property, stable drill) pass. The file was then
restored. One expectation in my first draft was wrong: I had assumed the made-up root label was `All`.
The spec option comment says it defaults to the title, here `T`. I corrected the test to the spec value.

### Ran and saw (final pass, after the last edit)

```text
$ npm run typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
(exit 0)

$ npx vitest run packages/axylo/test/hierarchy --configLoader native --no-cache
 Test Files  8 passed (8)
      Tests  154 passed (154)

$ node .prism-cache/tmp/purity.mjs
bare import, ignoreAnnotations:true, raw bytes = 0 ""
full hierarchy entry min raw 54017 gzip-9 21104

$ node .prism-cache/tmp/graph.mjs
index.ts: 114 inputs, hierarchy inputs: 0
static.ts: 115 inputs, hierarchy inputs: 0

$ node .prism-cache/tmp/ssr.mjs
DOM globals present: []
exports: sunburst,treemap,validateSunburst,validateTreemap
validateTreemap codes: AX191,AX190,AX192
validateSunburst codes: (none)
treemap in Node throws: [axylo] a hierarchy chart needs a DOM; use validateTreemap or validateSunburst in Node.

$ npx vitest run --configLoader native --no-cache        # full Node suite
 Test Files  138 passed (138)
      Tests  2443 passed (2443)
```

### Not done / not verified (this round)

- **Browser:** not run (worker rule). The browser suite does not exercise ownership changes. Remaining for the
  Coordinator: `npm run build && npm run test:browser -- packages/axylo/test/browser/chart/n9b-hierarchy.browser.test.ts`.
- Root/static byte identity not re-measured (only `src/hierarchy/*` changed; `graph.mjs` shows 0 hierarchy inputs).
- Independent cross-provider review of this candidate: not done by this lane.
