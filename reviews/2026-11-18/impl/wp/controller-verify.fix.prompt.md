# Fix pass: the cross-provider verification of the controller fixes

Your eighth pass and its follow-ups were verified read-only by Codex gpt-6.2-sol (max): `reviews/2026-11-18/impl/wp/fixes-verify.controller.review.md`. Read all of it. Of the sixteen findings it rechecked, six are fixed, most others partly; it lists fourteen new defects with call sequences. This pass closes the ones in your files. The data, lookup and scene ones (defects 1, 13, 14, the store half of 12, the lookup half of 7) are with that author; defect 8 (pager repeats page one) is with the interaction author; defect 9 (strip estimate) you already fixed in 12492de: check the reviewer's donut case (112 px of plot room, a 48 px strip) against your fix and add it as a test if it is not covered.

Rules as always (`AGENTS.md`): your files are `packages/axylo/src/core` (not `focus.ts`), `src/kinds`, `src/theme/watch.ts`, `test/core`, your browser tests. Contracts fixed. For every item, first write the test that fails on the current code with the reviewer's sequence (expected values from the spec), then fix. If a sequence does not fail as described, report what you saw and change nothing.

## Yours, in the reviewer's numbering ("New defects")

- **2 (blocker). Hidden, paused chart retains unbounded history.** keep:1, Pause, hide the container, 500 appends: 502 rows retained. The retention baseline must stay stable while the chart is not measured; an absent displayed frame is `null`, not a new baseline each frame.
- **3 (blocker as written; judge it).** Two parts. (a) A stale AX160 published under a newer generation: fix, with the generation check. (b) A tick formatter that calls `update()` on every call never lets a frame publish. If prepared ticks can be reused for an update that changes no axis input at small cost (a key over the axis inputs you already have), do it. If not, do not build machinery for it: say so, and I will record it as a documented limit (a formatter must not change the chart).
- **4. Paused re-encoding loses held findings and raw rows.** AX130 must survive a re-encoding while paused, and `strict` must reject as it would when running; the scatter row with old `x: null` and a valid alternate field; the false omission note for a typed `NaN`.
- **5. A frozen scatter frame changes month precision** ("Mar 1, 2026" for a `YYYY-MM` point): read date precision through the same owned-row accessor as hover.
- **6. A throwing getter bypasses strict and can undo teardown.** Preparation state local to each call, used by `append` too; liveness checked before acceptance (a getter that calls `destroy()`).
- **7, your half.** With a hover subscriber, picking a row among 50,000 sharing x read 50,001 row indexes while building the payload: reuse the point index the pick already located. (The lattice being built on the first pointer move is the lookup author's.)
- **10. Narrow scatter drops the automatic x endpoint.** One extent for domain and tick selection (missing-y positions included), and the coarser-domain fitting path for scatter x. `src/layout` is not yours: if the fix needs a change there, tell me the exact change and I will route it.
- **11. Watcher acquisition stuck on reattachment.** Roll back that invocation's subscriptions and reset `watching` on failure.
- **12, your half.** The benchmark's memory figure omits live buffers: count buffers from every live frame with one deduplication set (`core/instrument.ts`). The store's cached copy that `ownedBytes()` skips is the data author's.
- **Finding 7 of the table (partly fixed):** untitled create differs from `validate()` by AX140; append has no preparation context. Close both or say why the difference is right.

## Tests the reviewer says do not establish what they claim ("Claims not confirmed")

- "the frame draws 3" leaves `[0,1,2]` on screen; removing the in-flight pin left all 37 final-review tests green. Add a test that fails without the pin (the reviewer's commit-time eviction probe: the row must be the correct one, not `null`).
- A throwing value formatter runs again after the first figure write in the Node host: find out whether that is a real double call and fix or explain.
- Missing regressions: eviction of the held datum itself (controller half), reattachment cleanup and font measurement after reattachment.
- The wider snapshot property: check zoomed marks independently, do not skip collapsed and faulted frames if they can be checked, exercise scatter hover provenance; tighten the retention assertion to the policy's real bound.

## Verify

`npm run typecheck`; `npx vitest run packages/axylo/test/core`; the whole Node suite once at the end; your browser tests on a private build with `AXYLO_BUNDLE` (no `npm run build`: the shared build is rebuilt by me at commit points). Do not commit; never kill by pattern.

## Report

Per item: the failing test written first, what changed, or what you observed instead. Last lines of each run. What is not done.
