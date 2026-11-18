<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed02-9c4c-7f30-8718-7c8ef99b55c0). -->

Six named acceptance tests turned green. A4 passes at the reader level and still needs a controller change. All 48 unit tests passed.

| Item | Result |
|---|---|
| **A4 · Aligned table headers** | The unit test “uses the declared x and y units in aligned table headers without formatting any rows” passes. The line, area, and bar “lazy table uses the heading and units” cases still fail. `AlignedFrame` has no x-unit field, and the controller already has the unit. To finish, pass `labels: { xUnit: a.resolved.x.unit }` to `buildReader`. This requires no change to the frozen contracts. [Reader table](/home/canarit/projects/axylo/packages/axylo/src/reader/table.ts:79) · [Controller](/home/canarit/projects/axylo/packages/axylo/src/core/controller.ts) |
| **F10 · Compact stacks** | Both “a missing … component has zero height and the reader is told which stack is incomplete” cases pass. The summary lists the formatted x positions for one to three visible incomplete stacks and gives a locale-formatted count for four or more. Unit tests cover both branches. [Reader summary](/home/canarit/projects/axylo/packages/axylo/src/reader/index.ts:117) · [Unit tests](/home/canarit/projects/axylo/packages/axylo/test/reader/index.test.ts:152) |
| **C5 · Table guidance** | All three compact “supplies omission text for the corner marker and summary” cases pass. Unit tests cover charts with a table, `table: false`, compact mode, and authored messages. The default wording with a table is preserved. [Message templates](/home/canarit/projects/axylo/packages/axylo/src/messages/index.ts:16) · [Reader tests](/home/canarit/projects/axylo/packages/axylo/test/reader/index.test.ts:46) |
| **F3 · AX143** | “Discloses hidden labels after fitting unordered categories” passes. The registry receives no chart type, so the message retains the general fitting advice and explicitly limits the horizontal-bar suggestion to vertical bars with category labels. [Registry](/home/canarit/projects/axylo/packages/axylo/src/diagnostics/registry.ts:130) · [Unit test](/home/canarit/projects/axylo/packages/axylo/test/diagnostics/registry.test.ts:114) |

**Exact `seeTable` comment**

> When the reader model has a table, this text is appended after one space to `valuesNotShown`, `valuesChanged`, `labelsHidden`, and `seriesNotDrawn`, including author overrides of those templates.

**Scatter rows.** `PointSeries.x`, `y`, and `row` cover the retained points. `RowSource.rowAt` requires a known source index and cannot enumerate the omitted observations. The smallest addition for table display is `readonly missingX?: Float64Array` on `PointSeries`, sorted by normalized x with one entry per row whose x is valid and whose y is null or absent. Duplicate x positions stay in the array and series membership comes from the owning `PointSeries`. The reader can merge those positions within `ScatterView.xDomain` into paging and render `messages.noData`. [Frame contracts](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:87) · [Scatter table](/home/canarit/projects/axylo/packages/axylo/src/reader/table.ts:55)

**Verification.** The requested combined run exited 1. Its remaining failures were the three A4 cases above, five A10 authored-warning cases that expect `Ausgelassen: 1.` without the newly required suffix, two F2 scatter missing-value cases, one F4 scatter date-precision case, two F7 scatter percent/ratio cases, four F7 first-drawn-tick cases, and five L3 zero-size cases that recorded an empty draw after concurrent controller changes.

```text
 Test Files  4 failed | 15 passed (19)
      Tests  22 failed | 520 passed (542)
   Start at  06:00:00
   Duration  13.30s (tests 86%, transform 8%, import 6%)
```

Scoped strict typechecking passed. Repository typechecking stopped at the browser test’s `warn` comparison. Verification was Node-only, so browser rendering and language tagging for mixed-language notes remain unverified. No commit was made and all test processes exited. [Typecheck failure](/home/canarit/projects/axylo/packages/axylo/test/browser/acceptance/a1-names.browser.test.ts:45)