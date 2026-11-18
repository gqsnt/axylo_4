# Round 3, controller author

Read `reviews/2026-11-18/impl/wp/round3.common.md` first. Your items, in the reviewer's naming:

1. **C2 (blocker, partly fixed).** Alternating hide, append with `keep: 1`, show, while paused: 102 rows retained with only x=2 displayed. Showing the same paused frame again must not reset the retention baseline to the grown store size (`controller.ts` about lines 1611 to 1620). Test: 100 hide/append/show cycles stay within the policy's bound; then Resume shows the newest row.
2. **C4 remainder and R7.** Paused re-encoding: (a) the displayed window's own option findings are discarded, so `strict` accepts a field that exists only in held rows and the plot goes blank; (b) the backward scan misses a retained imputed-zero row behind an evicted source index, and reads 1,002 source indexes for two displayed rows. Enumerate the displayed revision's actual retained indexes; validate the displayed window as well as the held one.
3. **C6 remainder.** A throwing option getter runs in `preview()` before strict is set; a strict chart then accepts AX199 and shows the error state. Strict must reject.
4. **C7 remainder and R6.** Hover payload: use the new `Lookup.slot(ref)` (see the common part; the lookup's author lands it first) for the point's index and read the normalized y from the frame; never walk a run of equal-y points (50,000 reads today) and never read the caller's row again on a pointer move (a getter that throws after drawing makes hover throw today). The caller's row object is still delivered in the event where the contract promises it: read it through the owned-row accessor once, guarded.
5. **R8, your half.** After the layout takes a coarser x domain for a narrow scatter, the drawn domain is [−1000, 2000] but zoom clamping uses [−500, 1500]. One effective x domain for projection, gesture bounds and `zoom()` clamping: the one that is drawn. Put it where the interaction layer reads its bounds (`ControlsState` already has the fields it uses: check which; no contract change expected, tell me if one is needed).
6. **R11.** The strip's measured height is stale after a resize in which responsive CSS changes it: invalidate on resize or when its computed style changes.
7. **R12.** A tick formatter that throws only for values in unused coarser candidates makes AX160 appear though every drawn tick formatted. Publish formatter failures from the fitted candidate set only.
8. **R13**, if the lookup and data author tells you the fix is on your side (what `memory()` passes).

Your files: `packages/axylo/src/core` (not `focus.ts`), `src/kinds`, `src/theme/watch.ts`, `test/core`, your browser tests.
