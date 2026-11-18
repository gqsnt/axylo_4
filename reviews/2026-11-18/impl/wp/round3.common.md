# Round 3: the narrow re-check's findings (common part, read first)

The cross-provider re-check of the blocking defects is `reviews/2026-11-18/impl/wp/blockers-recheck.review.md` (Codex gpt-6.2-sol, max, read-only, at e90d8db). It confirms most blockers closed, lists what is still partly fixed (table 1) and fourteen regressions from the last round (table 2, R1 to R14). Its blocking list: C2, I4, I5, R1, R2. Read the whole review, then your own section below.

The coordinator's own verification of e90d8db on the shared build: every core browser suite on SVG, 920 passed, 4 failed, 1 skipped (925); chart and a11y on canvas, 280 passed, 3 skipped. The four failures: three acceptance A2 toolbar tests that do not know the Select range button yet (the acceptance author updates them), and acceptance I1 donut "the tooltip can itself be hovered": after Escape from a hold, moving to the first datum and then to another one, the other one's tooltip does not open (the interaction author's, see the Escape clarification).

## Coordinator's decisions for this round

1. **The lookup is the only place that knows what a group is.** Five findings over three reviews (C8, I7, I8, R3, R5) come from code outside the lookup rebuilding a scatter group by another rule. The contract (`packages/axylo/src/core/contracts.ts`, already edited by me) now has `Lookup.members(target, from, count)`, `Lookup.has(target, ref)` and `Lookup.slot(ref)`, and the point target carries an optional `rule: 'exact' | 'lattice'`. The lookup's author implements them first; until that lands, `tsc` is red in `src/lookup` only. Then: paging, dismissal and row selection use `members` and `has` (the interaction author deletes `groupRefs` and its like), and the hover payload uses `slot` instead of searching the run or rereading the caller's row (the controller's author).
2. **Decision 0004, clarification on Escape rewritten** (`docs/decisions/0004-tooltip-and-focused-text.md`, "Clarifications after the verification"): after Escape from a hold, the held datum and the datum under the pointer are both dismissed; a dismissed datum stays closed until the pointer reaches a datum other than itself; Escape from a pin or a plain hover dismisses only the datum on show.
3. **Compact bar patterns (C13) are accepted as they are.** Spec A5 now says neighbouring compact bar series differ by pattern and series further apart may share one. Nothing to do.
4. **Mixed languages on the plot's proxy (part of I13)** are accepted as a limit: one element has one language; the reading's language wins. Nothing to do.
5. Pointer tolerance (R9): the one-pixel rule of the decision is in viewport pixels. The interaction layer applies it before converting to layout pixels (a pointer within 1 viewport px outside the plot's viewport rectangle is moved onto its edge), for picking and for range ends alike. The lookup's own 1 layout-px slack stays.

## Rules, as always

`AGENTS.md`. Stay in your files. For every item, write the test that fails on the current code first (the reviewer's sequence; expected values from the spec or the decision), then fix. If a sequence does not fail as described, say what you saw and change nothing. Keep it small: the library is 19 KiB over its size target, so prefer removing a special case to adding one, and say what your pass does to the gzipped size (a release-settings build of HEAD against your tree is enough).

Shared build: `packages/axylo/dist` is built from the current commit and only the coordinator rebuilds it. Use a private directory inside the project with `AXYLO_BUNDLE` for browser tests and remove it afterwards. Do not commit. Never kill by pattern. The machine restarted once today: keep nothing you need in the system /tmp.

Report: per item, the failing test written first and what changed, or what you observed instead; last lines of each run; size before and after; what is not done.
