# Work package: scatter observations with no y value (spec F2)

Read `AGENTS.md`. You own `packages/axylo/src/data/**`, `src/reader/**` and their tests under `packages/axylo/test/data`, `test/reader`. Nothing else; in particular not `packages/axylo/test/acceptance/**` (make those tests pass by fixing the library) and not `src/core`, `src/dom`, `src/lookup`, `src/view`. Do not commit. You wrote both modules.

## The defect

Two acceptance tests fail (`packages/axylo/test/acceptance/f-missing-values.test.ts`; findings in `packages/axylo/test/acceptance/REPORT.md`, "F2 scatter omissions and zero imputation"):

- "F2 scatter: gaps are unplotted, zero is readable and the table says No data (reading: the table keeps omitted observations)": a scatter row whose y is null or absent is dropped by point normalization (`src/data/normalize.ts` near line 338) and never reaches the table (`src/reader/table.ts` near line 53), although the note tells the reader "Values not shown: N. See table."
- "F2 scatter: missing zero draws two imputed zero points and exposes all four observations": `missing: 'zero'` on the y field is ignored for scatter (near line 343 the value reader is called with imputation disabled).

Spec F2 (`docs/02-product-spec.md`): missing values are never drawn as zero unless the author asks; tooltip, table and announcements say "No data"; `missing: 'zero'` turns absent and null values into zeros.

## The contract

`PointSeries` in `packages/axylo/src/core/contracts.ts` now has an optional `missingX: Float64Array` (read its comment; it is the addition you proposed in `reviews/2026-11-18/impl/wp/reader-fix-2.report.md`). Implement it:

1. `src/data`: static normalization and `PointStore` (append, keep, replace, reencode, retire) fill `missingX` per series for observations with a valid x and a null or absent y. With `missing: 'zero'` they become points with y = 0 (row provenance kept) and are not listed in `missingX`. An observation whose x is invalid stays what it is today (reported by its diagnostic, not listed). Diagnostics and their counts must not change for inputs without `missing: 'zero'`; say exactly which diagnostic, if any, changes with it.
2. `src/reader`: the scatter table lists the missing observations in x order among the points, within the view's x range, with `messages.noData` in the value cell, and paging counts them. The summary's counts and extremes must not treat them as values.
3. Streaming storage: `missingX` follows the zero-copy rules you just built (shared storage, offset on keep, nothing retained after retirement). Add it to the model in your property test in `test/data/streaming-storage.test.ts`.

Tests first, in your own test directories, with hand-written fixtures; then the two acceptance tests must go green. Run `timeout 300 npx vitest run packages/axylo/test/data packages/axylo/test/reader packages/axylo/test/acceptance` and list what is still red in acceptance (other agents own the controller and scales and are changing them now; do not chase those). If lookup, view or the controller need to know about `missingX` for something the spec requires (for example the keyboard walk or a count in the accessible summary), do not edit them: say what and where.

Report: what you built, test names, the last lines of the run, any diagnostic whose behaviour changed, and what other modules need.
