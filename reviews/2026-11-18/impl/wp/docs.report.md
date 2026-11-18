<!-- Author: Claude Opus 5.5 (requested effort xhigh), Agent-tool subagent a04bfe28413f07034. Saved by the coordinator from the hand-back. -->

## Report: Axylo 1.0 documentation site (`apps/docs/**` only; nothing committed, no other file edited)

### What I built (ran and saw)
- **Build:** `node apps/docs/build.mjs` → `apps/docs/dist/`. It writes 19 pages, 29 diagnostic pages and 41 live examples in about 130 ms. It fails on any broken internal link, missing anchor or missing repository file.
- **Converter:** `lib/markdown.mjs`, a small one for the subset the pages use. It escapes all text and passes no raw HTML through. Heading ids follow GitHub's rules, so the links work on a code host too.
- **Embedding:** each example runs in its own page under `dist/examples/`, framed beside its full source. It loads the built `axylo.dev.js` and React adapter through an import map. Directives: `[example: …]`, `[source: …#Lx-Ly]`, `[table: …]`.
- **Data files:** the per-code pages come from `data/diagnostics.mjs`. For codes that can be raised in Node, the "What you see" message is the built `validate()` output.
- **Generated tables:** the theme-token and palette tables are read from `dist/axylo.css`, and the Messages table from the library source. No hex colour appears in prose.
- **Site look:** surfaces use the chart tokens, and the site follows light and dark by `prefers-color-scheme`.
- **Screenshots:** four, in `apps/docs/screenshots/`. I also looked at index, line, diagnostics, theming, options, compact, updating, migrate-chartjs, react and one code page at 390 and 1280 px in both schemes. One fix came out of that: wide tables scroll inside their own region on phones.

**Pages (words of prose):** index 579, getting-started 892, data 1,647, line 625, area 393, bar 484, scatter 327, donut 334, compact 385, updating 974, react 645, diagnostics 635, theming 671, accessibility 1,053, conformance 126 (clearly marked placeholder, not the A9 table), options 1,709, migrate-chartjs 818, migrate-recharts 714, stability 624. Total 13,635.

**Runnable examples:** 41 browser examples (`examples/*.ts|tsx|html`), plus 2 Node examples (`examples/node/validate.ts`, `examples/node/chart-data.test.ts`). The Getting started page quotes the other agent's three `examples/first-chart/*` snippets by reference; they existed by the time I built.

### Tests (ran and saw)
Run with `--config apps/docs/vitest.config.ts`, after `npm run build`, which I ran at 07:07.

| Test | Last lines |
|---|---|
| Options coverage (TypeScript 7 compiler API on the source types) | `Test Files 1 passed (1)` / `Tests 24 passed (24)` |
| Theming tokens against `css.ts` | `Tests 6 passed (6)` |
| Diagnostics coverage, DX4 (unit) | `Tests 84 passed (84)` |
| Diagnostics coverage, DX4 (browser: built pages, plus the 6 inputs that only arise in a page) | `Tests 9 passed (9)` |
| Markdown converter | `Tests 21 passed (21)` |
| Site pages (axe-core, no sideways scroll, no console errors; 390 px and 1280 px) | `Tests 48 passed (48)` |
| Node examples and server rendering | `Tests 3 passed (3)` |
| `chart-data.test.ts` example | `Tests 1 passed (1)` |
| **Examples, DX10** | **`× dates.ts` / `+ "AX143"` / `Tests 1 failed \| 43 passed (44)`** |

The `dates.ts` failure is a library defect (first item in the next section). I left the test strict; it stays red until the library is fixed.

The DX10 test uses the built `packages/*/dist` files, not a packed tarball as spec DX10 says. Scripts in the `.html` examples are checked with `checkJs` and `strictNullChecks: false`, so `querySelector` needs no guards; `.ts` and `.tsx` examples are fully strict.

### Where the library, spec and plan disagree
1. **Spurious AX143 and "Some labels hidden" note on time and date axes.** `layout/labels.ts:142` counts repeated tick text from denser candidate tick sets as hidden labels (inferred from the code, not traced). Observed:
   - the `dates.ts` instants chart at 752 px in America/Los_Angeles;
   - the AX111 minimal input in UTC;
   - `line-time.ts` at phone width;
   - `units.ts` at 364 px, where all four month labels are visible.

   This contradicts spec L1, where thinning is the remedy for these axes.
2. **AX108 on the only series** shows the empty state "No data to show." instead of an error state or a visible "could not be drawn". Only the summary says it. Spec 3.5, line 150.
3. **Event values on a date axis.** The `zoom` event and `Point.x` give epoch milliseconds, while `controller.ts:751` says the window is given "as the author would write it". I documented what I observed and made the examples read both forms.
4. **Script-tag file names.** Plan line 147 says `axylo.js` and `axylo.min.js`; the build makes `axylo.iife.js` and `axylo.iife.min.js` (`scripts/build.mjs:11-12`).
5. **AX199 wording.** The message says it is "a defect in Axylo, not in your data" (`registry.ts:147`), but `validate()` also raises it when reading a row throws (`core/stages.ts:171-172`).
6. **Title element.** Plan line 221 shows an `<h3>`; the built chart uses `div role="heading"`.
7. **Plan 1.6 message examples** differ from the registry wording. The registry is what the docs follow.
8. **Zoom on category axes.** The type matrix says zoom "Yes" for line and area; I3 limits zoom to time, date and number x. I documented I3, which matches the built behaviour.
9. **Typing with `strictNullChecks: false`.** Wide `y: [{ field, label }]` fails to type-check (TypeScript 7.0.2, seen in a probe). Spec 2.3 promises TypeScript 5.4+ with no strictness condition.
10. **Smaller observations:**
    - donut legend percentages show up to six fraction digits (`17.241379%`);
    - a chart in the loading state has the summary "No data to show.";
    - the built instruction text once said "Enter shows one series at a time"; another agent fixed it during my run.

### Not verified
- Screen readers, Firefox, Safari, Edge, Windows, macOS and real phones. Only headless Chrome on Linux, with emulated widths.
- Written from the spec and decision records, not exercised: tooltip placement, the scatter coincident-points tooltip, drag, wheel and pinch zoom, the table pager and Jump to, print, forced colours, `prefers-contrast`, whether a strict CSP needs `axylo.css`, simplification (F5), and the 12 px marker rule.
- Exercised and seen working: keyboard select and series switching, Pan left and Pan right, Pause appearing after an append, strict rejection, patch semantics, the theme toggle, pinned colours, server rendering.
- Chart.js and Recharts facts that are not in the harness (`chartjs-plugin-annotation`, `ReferenceLine`, `stackId`, `layout="vertical"`) are from knowledge and were not run. The harness versions stated on the pages are Chart.js 4.6.1 (chartjs-adapter-date-fns 3.0.0, date-fns 4.4.0) and Recharts 3.11.0 with React 19.3.1.
- **Assumption:** what the stability promise covers (public.ts, codes, documented CSS properties, message keys; not DOM or plot roles) is my reading of DX4, DX6 and plan §5. You may want to confirm it.
- **Base URL:** registry messages carry no URLs today. The test requires any future URL to end in `/diagnostics/<code>.html`. Links into the repository are relative and work when the site is served from the repo root; no base URL is assumed.

### Lines for you to add (I did not make these changes)
- **`vitest.config.ts`:** replace the `include` with the lines below. I checked an identical copy of the root config against apps/docs: same results.
  ```ts
  include: process.env.AXYLO_BROWSER
    ? ['packages/*/test/**/*.browser.test.ts', 'apps/docs/test/**/*.browser.test.ts', 'apps/docs/examples/node/*.test.ts']
    : ['packages/*/test/**/*.test.ts', 'apps/docs/test/**/*.test.ts'],
  ```
- **`package.json` scripts:**
  ```json
  "docs:build": "node apps/docs/build.mjs",
  "docs:screenshots": "node apps/docs/screenshots.mjs"
  ```
- **`.gitignore`** (`apps/docs/dist` is already covered by `dist/`):
  ```
  apps/docs/.cache/
  apps/docs/.scratch/
  ```
- **CI:** once the include changes, nothing else is needed, because the existing `npx vitest run` with `AXYLO_BROWSER: 1` runs the docs tests and they build the site themselves. Optionally add `- run: node apps/docs/build.mjs` after `npm run build` to fail early on broken links. The tests call `tsc` through `process.execPath` so they can run on Windows, but they have not been run there.

### Processes
I started only test servers on random ports and headless Chrome instances, and closed each one. I deleted my own scratch folder `apps/docs/.scratch` before finishing.

