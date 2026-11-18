<!-- Author: Claude Opus 5.5 (high), agent a1d73b9f46c46814f; saved by the coordinator -->

## Strip reservation no longer removes a readable plot

Both items are done: the controller no longer commits `readoutMode='strip'` with a too-small layout, and the controller half of C3-5 has a test. Nothing is committed and the shared `dist` was not touched. The private build directory `.core-private` was removed.

### What failed before
- **Node, with a stand-in host that reserves a real strip:**
  - A 112 px unstripped plot with a 98 px strip committed `readoutMode='strip'`; rule 5 says `'none'`.
  - With a 32 px strip (which leaves exactly 80 px), the plot stayed at 112 px. The strip was never reserved, because the controller re-measured only when `prepare()` reported a change.
- **Browser, on a private build of HEAD:** a page at 40 px with small axis text (`--axylo-font-size: 12px`, so the old estimate was about 30 px against a real strip of about 98 px), in a 900 × 340 container. The plot disappeared, the same `strip` plus too-small case the reviewer found.

### What changed
- **`src/core/chart.ts`: a new host method `stripHeight()`.** It measures the strip as the stylesheet would reserve it: a hidden copy of `.axylo-readout` inside an `axylo-readout-mode` holder in this figure, read from its computed height, so it is two line heights of the strip's own font.
- **`src/core/controller.ts`:**
  - The decision uses that measured height, re-measured whenever the text style changes. A host without the method falls back to an estimate of two lines of at least 24 px.
  - Once the strip is reserved, its real height is the difference between the plot's column and the plot.
  - Reserving or releasing the strip now always re-measures the plot.
  - If the layout comes out too small only because of the strip (the plot was readable without it), the frame retries with no strip and `readoutMode='none'`. The measured height keeps later frames there.
  - A chart too small even without a strip stays too small.
- **`test/core/host.ts`:** new options `strip` (a reserved strip takes that height from the plot's column, and the host reports it) and `stripUnknown` (the host does not report it).

### Tests
- **Node (`final-review.test.ts`, "never removes a readable plot"):**
  - 112 px plot, 98 px strip: `'none'`, and the plot stays.
  - Boundary: exactly 80 px left beside the strip keeps the strip (plot 80 px); 79.9 px gives `'none'`.
  - With no measured height and a 135 px plot (estimate leaves 87 px, real strip 98 px): retried as `'none'` and still `'none'` after a resize. With the retry disabled this test fails, so it does exercise the retry.
  - Too small without a strip stays too small.
- **Browser (`test/browser/chart/scale.browser.test.ts`):** the large-font case above. It failed on HEAD (plot height 0) and passes now: plot between 80 and 140 px, no strip, no floating tooltip when pointing.
- **C3-5, controller half (`final-review.test.ts`):** after a full data replacement:
  - The epoch changes, and the controls prepared for that frame carry the committed epoch and view.
  - The lookup is the new frame's: an old datum does not resolve, and a new one reads its own value.
  - Selecting (as Enter does) reports the new row.
  - It passes as is; I did not see it fail. The DOM half (focused text, ring and Enter in the page) is still the interaction author's.

### Last lines
- **Type check:** `tsc -p packages/axylo --noEmit` exits 0.
- **Node core tests:** `Test Files 14 passed (14)`, `Tests 223 passed (223)`.
- **My browser tests (private build of the working tree, `AXYLO_BUNDLE`):** `Test Files 1 passed (1)`, `Tests 6 passed (6)`. That is the 5 scale tests from before plus the large-font test.

