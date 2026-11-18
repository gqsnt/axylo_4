<!-- Author: Claude Opus 5.5 (high), agent a1d73b9f46c46814f; saved by the coordinator -->

## WebKit late-font measurement: fixed

After a late font load, the measurer now measures with the new font in WebKit, and Chrome and Firefox measure as before. Nothing is committed; I did not run `npm run build` or touch the shared `dist`.

### What failed on WebKit before
I probed in Playwright's WebKit: a 2D context, then a `FontFace` loaded and added late, then `'14,000 Sessions'` measured at 16px "Late Sans".

| Engine | Same font string assigned again | A different font first, then the wanted one | Fresh context |
|---|---|---|---|
| Chromium | 146.13 | 146.13 | 146.13 |
| Firefox | 146.10 | 146.10 | 146.10 |
| WebKit | 118.70 (stale: the width before the load) | 146.13 | 146.13 |

The new test (below) failed on WebKit before the fix: after the load the measured width was 27.4 px off the rendered width. It passed on Chromium and Firefox.

### Mechanism chosen
- **What it does:** `createMeasurer` in `packages/axylo/src/core/environment.ts` records, per document, the font epoch its context last resolved fonts in. When the epoch has moved on (`noteFontLoad`), it first assigns a different font (`10px serif`, or `10px sans-serif` if that is already set), then the wanted one.
- **Why this one:** it is the least mechanism that works in WebKit. The extra assignment happens once per font load, the one context per document is kept, and there is nothing extra per call on the layout hot path.
- **Not chosen:** a fresh context per epoch also works, but it allocates a canvas. Chrome and Firefox were already correct with either.

### Test
- **Files:** `packages/axylo/test/browser/chart/late-font.browser.test.ts`, with a small entry `test/browser/chart/entries/measure.entry.ts` that exposes the real measurer. It is loaded through the harness's `openEntry`, which builds into `test/browser/.out`, not `dist`. No CDP.
- **Checks:**
  - before the load, the measured width equals the rendered width of a span in the same font, within 0.5 px;
  - the font changes the width by more than 5 px;
  - after the load is noted, measured equals rendered within 0.5 px.

### Last lines
- **Type check:** `tsc -p packages/axylo --noEmit` exits 0.
- **Node core tests:** `Test Files 14 passed (14)`, `Tests 223 passed (223)`.
- **Late-font test:**
  - `AXYLO_ENGINE=chromium`: `Tests 1 passed (1)`
  - `AXYLO_ENGINE=firefox`: `Tests 1 passed (1)`
  - `AXYLO_ENGINE=webkit`: `Tests 1 passed (1)`

### Not run
The acceptance L1 "late font" tests on WebKit: they load the shared build, which I was told not to rebuild.

