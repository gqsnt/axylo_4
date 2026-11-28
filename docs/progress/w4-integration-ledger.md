# W4 integration ledger

## Seal fix: `TableModel.row(-1)` returns `null`

- **Finding** (review `sol-6.2-medium__20261128T015736Z`): the bubble reader (`src/spatial/bubble/composition.ts`,
  `readerWith`) used a negative ordinal on `table.row(...)` to offer a deferred AX160 size-format failure again,
  so an author's `table.row(-1)` returned `undefined`/`false` instead of `null` (`TableModel.row`: "null outside
  the range", spec A4).
- **Fix:** the deferred offer (`sizeMissed(meta)`) now runs inside the `row` getter itself, under the same
  table-ownership guard (`state.reading` set to this table and restored on every exit). `row(i)` only calls the
  bubble table, which returns `null` for `i < 0` and `i >= rowCount`. The setter and the controller's per-table
  row cache are unchanged. Follow-up (review `sol-6.2-medium__20261128T020445Z`): the guard is written inline
  around `built.row(i)` and around `sizeMissed(meta)` (no shared callback helper), so an uncached row read during
  CSV export allocates no closure.
- **Regression:** `test/spatial/bubble/ax160-review7.test.ts` (pending-CSV / onDiagnostic-only update case) checks
  `row(-1)`, `row(-2)`, `row(rowCount)`, `row(rowCount + 1)` are `null` before the pending export, while pending
  after it, and after publication (placed after the first owned CSV read, since looking `row` up is the retry
  hook). The existing assertions (reused table, cached fallback, no formatter rerun, report once to the new
  handler, note) are kept. Confirmed the new checks fail on the previous code (`expected undefined to be null`).
- Contracts and `public.ts` unchanged. Size gate: Director-measured.
