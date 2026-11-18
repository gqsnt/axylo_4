You wrote the `lookup`, `reader` and `messages` modules of Axylo in this repository (brief: `reviews/2026-11-18/impl/wp/lookup-reader.prompt.md`). An independent reviewer from another provider tried to break them and found 15 defects. Read `AGENTS.md` again, then the review at `reviews/2026-11-18/impl/wp/lookup-reader.review.md`.

The contracts changed in response to this review. Re-read these parts of `packages/axylo/src/core/contracts.ts` before anything else:
- `Formatters` now has `percent(ratio)` and `count(n)`: use them for every percentage and every count you put into text. Do not import number formatting from the format module and do not fall back to the runtime's default locale.
- `Lookup.count` and `Lookup.ordinal`: the comment now defines position exactly (aligned: place of the datum's x among the visible slots, values or not).
- `Lookup.resolve`: the comment now defines when a datum is "there" and where focus goes when it is not. `step` must start from the resolved datum.
- The point variant of `DatumRef` carries `x`.
And in `packages/axylo/src/public.ts`, `Messages` gained keys: `category`, `percentage`, `series`, `value`; `typeLine`, `typeArea`, `typeBar`, `typeScatter`, `typeDonut`; `donutSummary`, `seriesNoData`, `seriesNotDrawn`, `referenceLine`, `referenceBand`. The type check currently fails in `messages/index.ts` and in your tests until you add them.

You own, as before, only: `packages/axylo/src/lookup/**`, `packages/axylo/src/reader/**`, `packages/axylo/src/messages/**` and their three test directories.

**Compatibility while you work:** another agent is calling `buildLookup`, `buildReader`, `resolveMessages`, `fill` and `defaultMessages` right now. Do not rename or remove any exported function, parameter or result field; additions must be optional.

For each finding: reproduce it with a failing test first, then fix it. Decisions already taken:

- **1.** Implement `resolve` and `step` as the contract now states. Tests: a focused datum whose series is then hidden; a focused datum zoomed out of view; the same for scatter; `step` from a stale ref moves from where `resolve` puts it.
- **2.** Position as the contract now states. `pointOf` is filled with `ordinal + 1` and `count`. Add a property test with at least two visible series and with a hidden series between visible ones.
- **3.** The table caption is never empty: the reader input gains an optional caption text supplied by the caller (the heading's text when `labelledBy` is used); without it use the generated name.
- **4.** Omitted values use `valuesNotShown` with the omitted count; changed values use `valuesChanged` with the changed count; both sentences when both apply; counts through `formatters.count`. Reword the two default templates so they read correctly for a count of 1 ("Values not shown: {count}. See table." and "Values shown differently from the data: {count}. See table.").
- **5.** No English string may be produced outside `messages`. Use the new keys for column headers, nouns and chart type names; a missing label falls back to the field name, never to a hard-coded English word.
- **6.** A stack total where no component is a value reads as the missing text, not "0".
- **7.** One `seriesNoData` sentence ("{series}: no data.") for a series with no value in range; no value range when it is not finite; no series sentences after the empty statement.
- **8.** Donuts use `donutSummary` ("{type} chart with {count} slices. Total {total}.") followed by one sentence per drawn slice with value and percentage; no x or y range; grouped categories are named through the "Other" slice only.
- **9.** A series that cannot be drawn gets a `seriesNotDrawn` sentence ("{series} could not be drawn. See table.").
- **10.** References: `referenceLine` ("Reference line {label} at {from}.") and `referenceBand` ("Reference band {label} from {from} to {to}."), positions formatted with the right formatter for their axis; references are also appended to the table caption. Keep `referenceSummary` as a deprecated alias that is no longer used.
- **11, 12.** Make keyboard steps and table rows cheap at scale: locate a point ref by binary search on `ref.x` then a scan of the equal-x run; `series-next` by binary search in the target series; `next`/`previous` across series as a successor search (O(series × log points)); table pages through a merge cursor so a 100-row page costs about 100 steps whatever the series count; one grid pass per pick, and cells that hold more than a few hundred points are subdivided or searched through a secondary order so a pointer move never examines more than a few thousand candidates. State the bounds you achieve and assert them in tests through counters.
- **13.** Keep the use of the data module's x parsing, but through one small adapter function in your module that depends only on what the data module exports from its index (if what you need is not exported there, say exactly what is missing).
- **14.** One rule for a step that cannot move: null. A donut slice folded into "Other" resolves to the "Other" slice through `members`.
- **15.** Fix the tests the reviewer names: remove expectations that pin defective output, widen the generators, and add the untested cases (reversed pixel ranges, irregular time spacing, hidden focused series, zoomed-out ref, all-missing stack total, `labelledBy` caption). Build `PointFrame`s by hand where you need points that share an x.

Run `npm run typecheck` and `npm test` from the repository root. Other agents are mid-change elsewhere; failures in files you do not own are not yours.

Report per finding: reproduced (yes/no), fixed (yes/no), the test that covers it, and anything you disagree with and why. Paste the last lines of the test run.
