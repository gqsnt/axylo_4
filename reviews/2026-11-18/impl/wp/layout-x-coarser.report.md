<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Narrow scatter x endpoint (verification defect 10): fixed

A narrow scatter now draws an x domain that ends on drawn ticks. No contract field is needed, and line, area and bar x axes are unchanged. Nothing is committed.

**F7 does require this.** Its row says the rule "is for value axes: the y axis of line, area and bar, and both axes of scatter", and that the automatic domain "ends at the first tick at or beyond each extreme". So a scatter's x must end on drawn ticks.

### Failing tests, written first
All are in `test/layout/layout.test.ts` and run end to end through the Node recording host, so the controller's real tick candidates and wider domains are used.

- **Your sequence:** x −3.3, 7.7, 1001.5 at 195, 205 and 215 px wide.
  - On the committed code all three widths drew domain [−500, 1500] with ticks [−500, 0, 500, 1000]. The end tick 1500 was dropped (fit remedy "rotated"); at 185 px it was 1000 that went missing instead.
  - Expected from F7 and the candidate sets: the end tick 1500 of [−500, 1500] cannot be drawn at these widths, so the next wider domain on a coarser step is drawn whole. That is [−1000, 2000] with ticks [−1000, 0, 1000, 2000]. The test also asserts the domain contains the data and that both ends are ticks.
- **Wide plots unchanged:** at 600 px the domain stays [−500, 1500] with ticks [−500, 0, 500, 1000, 1500].
- **Property test, 300 runs:** 2 to 6 x values with two decimals in ±1,000,000, widths 130 to 700 px. Wherever a plot is drawn, both ends of the x domain are drawn ticks.
  - This is stronger than the "or the layout says partial" clause you allowed.
  - The `Layout` output has no partial flag, and the stronger form holds; a scratch run of 600 cases found no counterexample.
- With the committed layout files restored, the three width cases and the property test fail; with the fix, all pass.

### What changed
1. **`src/layout/labels.ts`:** when the last-resort truncation in `fitBottom` drops ticks on a continuous axis, the fit now reports `partial: true`, as `fitValue` does. Wrapping and rotation keep every tick, so they still count as whole. Band axes never report partial.
2. **`src/layout/index.ts`:**
   - `layoutAxes` returns the x flag as `xPartial`, next to `partial`. This uses a layout-internal `AxisFit` type, so `core/contracts.ts` needs no field.
   - `computeLayout` first tries the y axis's wider domains, as before. Then, if the continuous x is still partial, it tries `input.x.coarser` in order and takes the first that fits whole without making a whole y partial.
   - Line, area and bar x axes have no `coarser`, so nothing changes for them. All existing layout tests pass unchanged.

### Something to know (not fixed, outside layout)
With extreme magnitudes, for example values around 1e-43 to 1e-243, the drawn domain and the ticks can disagree by floating-point rounding (domain −4.999999999999999e-69 against tick −4e-69), or the tick set comes back empty. That comes from domain and tick computation, not from fitting, so I left it alone. The property test above is limited to realistic magnitudes for that reason.

### Runs
- `npm run typecheck`: no errors; only the `tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist` line printed.
- `npx vitest run packages/axylo/test/layout packages/axylo/test/core`:
  ```
  Test Files  16 passed (16)
       Tests  295 passed (295)
  ```
- Whole Node suite: `Tests  1483 passed (1483)`.

### Files
- `packages/axylo/src/layout/index.ts`
- `packages/axylo/src/layout/labels.ts`
- `packages/axylo/test/layout/layout.test.ts`

No build was run. Scratch files are removed.
