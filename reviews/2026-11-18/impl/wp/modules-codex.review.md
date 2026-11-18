<!-- Reviewer: Claude Opus 5.5 (requested effort xhigh; model observed in the subagent transcript), Agent-tool subagent a6d455f0efe10bf17, read-only. The code under review was written by Codex gpt-6.2-sol, so this is a cross-provider review of that code. Saved by the coordinator from the hand-back. -->

## Review of 7831371, c655ad5 + d4cbedb, 7c46ec9, 43fc75d (Axylo data / reader / lookup)

**Reviewer.** Claude Opus 5.5 (`claude-opus-5-5`). That ID comes from my session system prompt. I can't see harness metadata for requested or observed effort. The code is by Codex, so this is a cross-provider review.

**Baseline.** At 07:16 the requested run (`npx vitest run packages/axylo/test/data packages/axylo/test/reader packages/axylo/test/lookup`) passed 189/189.

At 07:40 the same run gave 2 failed / 187 passed. The cause is a working-tree edit that is neither mine nor committed: `src/data/normalize.ts` `pointFrame` now lists every non-value slot in `missingX`. The two failing tests are in `normalize.test.ts`, "normalizes scatter observations with missing y in gap/zero mode". This edit is related to finding 1.

**Scratch work.** All scratch tests ran under a private vitest config in `.scratch-review-b/`, which I have deleted. The test processes still running belong to other agents' browser runs.
- **Twin-store oracle.** Store A is read only at the end; store B is read the moment each frame exists. Every held frame of A is compared with B's snapshot. I also checked provenance (each slot's row really has that x, series and value) and that every held committed frame's `rowAt` returns its row until retired, then null.
- **Mutation runs.** I copied `src` plus the data, reader, lookup and messages tests into scratch, applied one mutation at a time, and recorded which tests failed.

---

### Findings, most severe first

**1. B: the scatter table leaves out invalid-y rows that the note sends the reader to (F2, F12).**
- Where: `normalize.ts:354` (committed) and the `contracts.ts:119-126` definition ("null or an absent field").
- What happens: an observation with a valid x and y = NaN or Infinity in a row (AX103) or a non-decimal string (AX106) is counted as "omitted". It is neither a point nor in `missingX`, so the table never lists it. The aligned table shows the same rows as "No data", because `formatters.missing` maps `SLOT_INVALID` to "No data".
- Ran: the `dirty` fixture `[10,20,null,NaN,'40',undefined,70]` on scatter.
  - Diagnostics: AX103 row 3, AX106 row 4, AX102 row 5.
  - Note: "Values not shown: 3. See table."
  - Table rows: `0|10, 1|20, 2|No data, 5|No data, 6|70`. Rows 3 and 4 are missing.
  - The same data as a line chart has slots `[0,0,1,2,2,5,0]`, and its table lists rows 3 and 4.
- Fix: a contract change to `missingX`: "observations with a valid x and no drawable y (SLOT_NULL, SLOT_ABSENT_FIELD, SLOT_INVALID) … with `missing: 'zero'` the null and absent ones are points with y = 0; invalid ones stay here".
  - Then update the normalize tests' expected values as a spec decision, not to make them pass.
  - The working-tree edit above implements the code half without the contract text or the test update.

**2. M: an in-place append after an outstanding preview rewrites a slot inside that preview's view.**
- Where: `store-buffers.ts:111-116` (`writeTail`), `store.ts:711-712`.
- Sequence (long form):
  1. Start with `[{x:1,s:a},{x:1,s:b},{x:2,s:a}]`.
  2. `P = prepareAppend([{x:3,s:a}], {keep:100})`.
  3. `store.append([{x:2,s:b,v:20}])` with no keep, which takes the in-place path.
- Result: P's `b.y` changes from `[10,NaN,NaN]` to `[10,20,NaN]`, and slot/row change with it. This happens whether or not P was read.
- Cause: base's tail token is unexposed, and `reserve(0)` skips the written-cursor check. Index `end-1` is an interior slot of P's longer view, so P has no tail token there.
- Random harness, 8,000 sequences per store kind: 5 failures (long form) and 4 (category), all of the form abandon/compete → in-place. With in-place appends removed: 0 failures in 40,000.
- Reach: only through `AlignedStore.append` without keep. The controller always calls `prepareAppend` (`controller.ts:619`). It still breaks the report's guarantee that "a superseded preview keeps its normalized values".
- Fix: `if (prepared || series.tail?.exposed || this.range.written.end > this.end) return this.copySeries(series);` (expose the written cursor from `BufferWindow`).

**3. M: the prepared path copies a series' whole window on every shared-x fill.**
- Where: `store-buffers.ts:112`, where `prepared` always leads to `copySeries`, which copies at full capacity.
- Effect: in long-form streams where each series' value for an x arrives in its own `append`, every fill after the first costs O(retained). That contradicts the brief, plan 2.2, and the intent of `review.test.ts:142` ("does not copy the window on shared-x single-row appends"). That test only exercises the in-place path, which the controller never uses.
- Ran: 20k slots × 2 series, controller-style prepare+commit gave 520,051 typed-array bytes per x tick, with or without keep. Node time per tick:

| Window | Series | ms per tick |
|---|---|---|
| 600 | 1 | 0.019 |
| 600 | 3 | 0.055 |
| 600 | 8 | 0.122 |
| 50k | 3 | 0.34 |

- P3 (600 points) is not threatened; large windows are.
- Rendering reads `y` and exposes the tail, so after a draw the copy cannot be avoided under the current contract.
- Fix for the several-appends-per-frame case:
  - Store the tail's y/slot/row values in `OpenSlot` when it is created.
  - Let the first draft claim it (`owner`) and write in place; any other writer copies.
  - Frames read the captured values.
  - Document the cost of a fill after a draw.

**4. M (P7, older than these commits): opening a store on a large static chart costs about 8× the caller's columns.**
- Ran with `--expose-gc`: 1M-point typed-column line chart, then `fromFrame` + one append. The store holds 132 MB; the caller's columns are 16 MB.
- Sources:
  - `FrameBuffers` 2× capacity: about 44 MB.
  - 256-row block copies: 16 MB.
  - A per-row `Map` entry in `RawRows.columns` and in `StreamRows.positions`, plus `Observations`.
- Fix: implicit row indexes for column sources (blocks in an array indexed by `row >> 8`), positions in typed arrays, and a capacity of `end + max(16, end/8)`.

**5. M: the `{seeTable}` sentence is built in two places, and they disagree.**
- `controller.ts` (working tree, about line 911) builds `seriesNotDrawn` itself as `fill(…, { seeTable: '' }).trim()`:
  - It drops "See table." even when the chart has a table, while the summary keeps it.
  - It trims an override that has no placeholder, which the rule says must be used as written.
  - An override like `'{series} ({seeTable})!'` becomes "B ()!".
- `noteLangFor` (about line 1046) tags the note `lang="en"` only by the three template keys. A sentence that mixes keys can't be tagged correctly (A10):
  - Override only `seeTable` and German text gets tagged `en`.
  - Override only `valuesNotShown` and the built-in English "See table." is left untagged.
- Fix: one exported reader helper that the controller uses too, and per-segment language for the note.

**6. M: the lookup tests don't pin the spec's "ties go to the later row".**
- Two mutations survive every lookup test: removing `later()` from `consider` (`scatter-grid.ts:193`), and making the group representative the first point instead of the latest (line 147).
- Reason: the brute-force oracle numbers rows series by series, so insertion order equals row order.
- The real code is correct: I checked interleaved rows across series (A row 5 versus B row 2, identical and equidistant cases).
- Fix: shuffle row numbers across series in the property generator, and add identical positions across series.

**7. M: the streaming property test cannot reach the shared-storage hazards.**
- Where: `streaming-storage.test.ts:191-265`.
- What the generator never produces:
  - more than one series, a series field, or tail writes;
  - categories;
  - out-of-order or duplicate x;
  - null y on line or donut;
  - abandoned or competing previews, or in-place appends.
- Every snapshot is read after every operation, so tails are always exposed and the `OpenSlot` paths never run.
- With keep ≤ 7, an O(window) copy is under 400 B and fits the 2,048 B-per-append allowance.
- `expectCollected` (lines 57-67) returns silently when `gc` is absent, and the default `npm test` has no gc (checked). So every "releases …" GC assertion is vacuous in CI. The tests pass 26/26 with `--expose-gc`.
- Mutations that survive the whole suite:
  - draft writes the tail in place when unexposed;
  - no compaction on drop;
  - `Labels.push` ignores the written cursor (competing donut previews would overwrite each other's labels).
- The "competing previews" test (lines 345-361) never re-reads the accepted frame. Removing the written-cursor check entirely is caught by only one scatter `missingX` test.
- The "captured series view" test (lines 363-377) reads before preparing and uses the prepared path, so the unexposed `changed` path is covered only by `review.test.ts`.

**8. m: removing `{seeTable}` leaves debris when there is no table.**
- Where: `reader/index.ts:49-52`.
- Ran:
  - `'Values not shown ({seeTable}): {count}.'` gives "Values not shown (): 3."
  - `'{seeTable} Values…'` gives a leading space.
  - A trailing U+200F gives "3. ‏", because `trimEnd` keeps the mark.
- No test covers a mid-sentence placeholder without a table.
- Fix: collapse the whitespace around the removed placeholder and remove an empty bracket pair; strip trailing bidi marks before trimming.

**9. m: the compact incomplete-stack sentence is put together from fragments.**
- Where: `reader/index.ts:122-137`.
- It builds `label + " (incomplete): " + positions/"Total N" + "."` and reuses `messages.total` as a count of stacks, giving "Distance (incomplete): Total 4."
- No template exists, so A10 can't be met for this sentence. Fix: add one template with `{count}`/`{positions}`.

**10. m: `retire` with a revision at or above the current one has surprising effects.**
- Where: `store-rows.ts:318-333`.
- Ran: `retire(current+5)` releases the current frame's rows (`rowAt` returns null). Revisions published later at or below that number stay live.
- Fix: clamp to the current revision, or document "through r at call time".

**11. m: an abandoned preview pins memory.**
- Where: `store-rows.ts:258-260`, via the `live` closure created in `store.ts:563` and `store-unaligned.ts:406`.
- The preview's `FrameSource` keeps the draft `StreamRows` (the appended caller rows) and the base frame alive for as long as anyone holds the preview, even though `rowAt` already returns null.
- Fix: set `read = null` the first time `live()` is false.

**12. m: `scatterPosition` only handles values exactly equal to a domain end.**
- Where: `geometry.ts:9-16`.
- A value one or two ulps inside the end can still project outside the plot in extreme spans: 4 of 20,000 random domains such as `[-1e6, 1.16e-10]`. Realistic nice domains: 0 of 20,000, across device pixel ratios 1–3 and fractional rects.
- The `domain[0]` branch is dead code, because `map(d0)` is exactly `r0`.
- Fix: clamp a projected position that lies within about 1e-9·|extent| of the rect into it.

**13. m: lookup test gaps beyond finding 6.**
- Removing the `contains(plot)` filter at grid build (`scatter-grid.ts:74`) survives, so nothing checks that a point outside the plot (for example, outside the author's y domain) can't be picked from inside.
- The brute-force property uses identity scales, so it never exercises scale rounding. Fully reverting `scatterPosition` is caught only by the latency edge test.

**14. m: the open worst case for picking is all points equidistant from the pointer.**
- Ran: a ring of 200,000 points at 20 px gives 200,042 visits (count 1,591). A jittered 10k cluster costs only 68–472 visits.
- Under the exact tie rule, O(N) is inherent for any bounding-box tree: every arc's box has a lower bound below r.
- Achievable bound: merge positions to the device-pixel lattice when building, keeping max row and count per cell. A pick then visits at most (2·24.5·dpr)² cells (about 9.6k at dpr 2), independent of N, with error at most 0.35 device px.

**15. m: module-boundary rule.**
- `store-unaligned.ts:3` (added in d4cbedb) imports `lookup/search`. The data layer now depends on lookup, against the rule in the `contracts.ts` header.

**16. m: AX143 now tells every chart type about vertical bars.**
- Where: `registry.ts:130`. The registry has no chart type, so the sentence appears for line, area, scatter and horizontal bars too.
- Fix: pass the chart type in the details.

---

### Areas I examined closely and found sound
- **Committed-frame lifetime under the controller's call pattern:** 0 failures in 40,000 randomized sequences against the twin oracle, including provenance and row-source checks. Covered: prepare/commit, abandoned and competing previews, keep sliding past held offsets, growth, compaction, replace, re-encode, out-of-order rebuilds, duplicate x, a ninth series, new categories, and retire older/twice/never.
- **Growth and compaction:** a 200k burst then keep 600 leaves 9,600-byte buffers in all three stores and 600 retained rows. Steady streams copy amortised O(1), apart from finding 3 and one reallocation after each abandoned preview.
- **Borrowed columns:** nothing writes them (`readX`/`readValues` copy on write; stores copy when they open). Caller arrays were unchanged after 200 appends with `missing:'zero'` and keep.
- **`missingX` in streaming:** append, keep, re-encode, replace and retire match static normalization, including `missing:'zero'` (streaming and static both gave x `[2,3,3,4]`, y `[0,0,5,2]`). Diagnostics follow 3.5: null silent; absent field is AX102 omitted, or changed with zero; typed NaN silent.
- **Scatter table:** the merge cursor, points-before-gaps at a tied x, and `pageForX` are correct.
- **Picking:** edges on realistic domains, coincident grouping, counts above eight, and the interleaved-row tie-break are correct.

**Verdict on the narrowed assertion in `transactions.test.ts`: the narrowing was right.** The old check compared spare capacity, which the `FrameBase` comment explicitly allows to be shared. The frame's own view bytes are exactly what a holder is promised. But the test is not sufficient: it never re-checks the discarded preview after the accepted append, and it uses a single wide series, so it cannot see finding 2. Add a before/after `contents(discarded.frame)` check and a series field.

