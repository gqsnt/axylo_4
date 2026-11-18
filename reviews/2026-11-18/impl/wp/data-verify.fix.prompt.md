# Fix pass: the cross-provider verification, data, lookup and scene findings

After the plot-edge slack you are finishing now (report that first, separately at the top of your report), this pass: Codex gpt-6.2-sol (max) verified the controller and data fixes read-only, `reviews/2026-11-18/impl/wp/fixes-verify.controller.review.md`. Read all of it. The findings in your files (`packages/axylo/src/{data,lookup,scene,view,reader,format,diagnostics,messages}` and their tests), in the reviewer's numbering under "New defects":

- **1 (blocker). A typed append can return the wrong source row.** Typed x `[0,1]`, y `[0,10]`, `missing: 'zero'`; append `[{x:2,y:20},{x:3,y:null},{x:4,y:40}]`; hovering x=2 reports index 0 and `{x:0,y:0}`. When a null forces an explicit row index mid-batch, the identity entries for the slots already written in that batch must be initialised (`store-buffers.ts` about line 109, `store.ts` about 824). Add a property test: for any typed opening and any batch with missing values at any position, under every `missing` policy, `rowAt` and the per-series row index give the caller's row for every slot.
- **7, your half. The scatter lattice is built on the first pointer move** (32,000-point ring): build the fallback with the lookup (or at the first idle moment the contract allows) so a pointer move never does data-sized work. The payload scan over rows sharing x is the controller author's.
- **12, your half.** `ownedBytes()` skips a cached copy made when a competing tail fill is prepared and the old frame is then read (`store-bytes.ts` about 58, `store-buffers.ts` about 269): count already-materialised getter copies, deduplicated.
- **13. Compact bar patterns lose a non-colour distinction (spec A5).** Three equal-height series in one compact category: series 1 and 2 both use the diagonal fill and differ only in colour. Keep F9's 32 distinct colour-and-pattern combinations and make neighbouring series differ by pattern as well. `RectMark.pattern` in the contract is fixed: if no arrangement of the existing pattern values can do both, tell me the exact contract change (new pattern values) and what both renderers would need, and do not make it.
- **14 (minor). Scatter keeps a duplicate x column after the last missing point is evicted** (`store-unaligned.ts` about 157 and 187): drop it when every retained row is again represented by the point x column.
- **Table finding 15 (partly fixed), your side:** the candidate extent for automatic numeric x endpoints excludes missing-y positions (`view/index.ts` about 220); the controller's author is fixing the tick selection in `core/axes.ts` and may need a change in `src/layout` (yours): coordinate through me.
- **Table finding 8:** add the missing test for the first-pick construction cost once 7 is fixed.

The memory budget P7 is settled by the owner at 1.1 × the caller's two columns (spec row P7, commit 4a1db68); the test in `streaming-storage.test.ts` checks the new bound. Nothing to do there.

For every item, first write the test that fails on the current code with the reviewer's sequence (expected values from the spec and fixture, never pasted from the implementation), then fix. If a sequence does not fail as described, report what you saw.

Verify: `npm run typecheck`; `npx vitest run packages/axylo/test/{data,lookup,scene,view,reader}`; the whole Node suite once at the end. No `npm run build` (I rebuild the shared build at commit points). Do not commit; never kill by pattern.

Report: per item, the failing test written first, what changed, or what you observed instead; last lines of each run; any contract change you need; what is not done.
