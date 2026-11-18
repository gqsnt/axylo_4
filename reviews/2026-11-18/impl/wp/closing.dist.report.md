<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; saved by the coordinator -->

## Distribution browser tests: report (no files changed)

All 12 failures have the same cause, and it is a product defect: a tooltip whose value text cannot wrap is never shown. So I left `tests/dist/**` unchanged. The tests reach the tooltip by today's rules, which I proved by making the value text wrap in an isolated build: all 8 CSP tests then pass. Behind the same defect, the 4 text tests hide a second, separate failure in the x-axis labels, which I have not judged.

**Where I ran.** In `.scratch-dist/` inside the project: `git archive` of HEAD 0d9532f, with `node_modules` really copied (`cp -a`), not linked, and `npm run build` there. The directory is now removed. `.scratch-cl/` at the root is not mine.

### The defect: a value text that cannot wrap hides the whole tooltip
It affects all 8 `csp.browser.test.ts` tests and all 4 `text.browser.test.ts` tests.

**Spec rows it breaks:**
- I1: "Pointing anywhere in the plot shows what is there … lists at most eight rows plus '+N more'".
- Decision 0004, rule 6: the tooltip "is never wider or taller than the visible part of the plot (its content wraps …). If no candidate is valid with one row, the candidate that overlaps the active box least is used".

**Sequence:**
- A line chart in a 640 × 320 box. The plot is 640 × 215, so this is not readout mode.
- Its y value text is too long to fit on one line. In the CSP page that is `format` returning `<img src=x onerror=…>1350` plus `unit: IMG`; in the text page it is the `<u data-axs="l-yf">…</u>` value plus the `<u data-axs="l-u">l-u</u>` unit.
- Move the pointer to the middle of the plot. Pointer events arrive, but the tooltip stays `hidden` and the readout stays hidden. There is no error and no diagnostic.

**Minimal reproduction** (outside CSP, acceptance page, HEAD build):
- `unit: 'x'.repeat(60)`, `unit: IMG` and `unit: 'word '.repeat(12)` all give no tooltip.
- `unit: 'u'`, or the same unit without the long `format`, gives a tooltip as usual.
- The area chart behaves the same. The stack total ("Total …") is in that same tooltip, which is why `total on #area` is missing.

**Code:**
- `packages/axylo/src/theme/css.ts:216`: `.axylo .axylo-tooltip-value { … white-space: nowrap; }` means the value cannot wrap within the 320 px maximum width (or the visible plot width).
- `packages/axylo/src/dom/tooltip.ts:386`: the fit loop skips every row count while `scrollWidth > clientWidth + 1`, so `size` stays 0.
- `tooltip.ts:392`: the rule-6 fallback runs only when `size.width > 0`.
- `tooltip.ts:395-397`: so the tooltip is hidden.

**Experiment (isolated copy only, reverted, not a proposed fix):** I replaced the `nowrap` with `overflow-wrap: anywhere`.
- All 8 CSP tests passed: `Tests 4 failed | 22 passed (26)`.
- The text tests got past lines 180 and 305.
- So each test's way of opening the tooltip is still current: a plain hover in a 640 × 320 or 760 × 520 box, with no rest, pin or class change needed.

### Second failure in the 4 text tests (seen only with the experiment; not judged)
Once past the tooltip, the text tests fail at:
- line 168: "scatter: xTick labels: expected 1 to be greater than or equal to 2";
- line 314: a page text holding a cut sentinel, `<u data-ax…-xt">0</u>`.

The test file states its premise: the charts are sized so that no sentinel label is truncated.

**Observed** (HEAD build, the text page's scatter options): at plot widths of 760, 900 and 1100 px, 4 of the 5 x tick labels (domain `[0, 80]`, step 20) are rotated and cut in the middle. The ticks are 190–275 px apart, and the labels are about 26 characters.

**Code:** the bottom-axis fitting in `packages/axylo/src/layout/labels.ts`, `fitBottom` (about lines 355–417), falls through thinning, wrapping and rotation to `truncateBottom` (about lines 331–353).

**Inferred, not verified:** the ticks at both ends of the domain, since 2bbef28 ("takes the next coarser domain"), may make every horizontal set conflict at the plot's edges. This is layout's area. Spec L1 allows middle truncation only when the labels still do not fit after the earlier remedies, so whether this is a defect is the layout author's call once the tooltip fix lands.

### `isolation.test.ts`
It passed twice:
- In my copy with really copied `node_modules`: `Tests 19 passed (19)` together with the instrumentation test.
- In the real tree: its 12 tests passed (`Tests 7 failed | 12 passed (19)`; the 7 failures are instrumentation, below).

So your symlinked `node_modules` explanation holds, and no change is needed.

Running there repacked the git-ignored `tests/dist/.packed` and fixtures from the shared dist. The dist itself was not touched.

### `instrumentation.test.ts` (first run)
- **Isolated HEAD build:** all 7 markers pass, absent from `axylo.js` and `axylo.iife.min.js` and present in `axylo.dev.js`.
- **Real tree:** all 7 fail, for example `axylo.js: expected 'var we=…' not to match /\bownedBytes\b/`. The shared `packages/axylo/dist` was built at 18:33, before ab82dad (18:40) put those members behind the build flags. They will pass once you rebuild the shared dist.

### Last lines (isolated HEAD build)
- **Browser** (`AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts`): `Test Files 2 failed | 3 passed (5)` / `Tests 12 failed | 14 passed (26)` / `Duration 31.96s`.
- **Node** (`npx vitest run --config tests/dist/vitest.config.ts`): `Test Files 11 passed (11)` / `Tests 90 passed (90)`.

### Not done
- No product fix (not mine); tests left as they are, as the defect rule says.
- The second text-test failure is not judged.
