# Code review follow-up: last check of five blocking items and of one round of changes

This is an ordinary software quality review of a charting library's TypeScript source (line, bar, scatter and donut charts in a web page). It has nothing to do with security. You are an independent reviewer from a different provider than the authors. Read-only: do not edit anything; your final message is the report. Repository: /home/canarit/projects/axylo. Project rules: `AGENTS.md`.

Review commit 9f9eeef. Another author is making uncommitted edits in the working tree right now (a size pass in `packages/axylo/src` and `scripts/`): read every file with `git show 9f9eeef:<path>` and diffs with `git diff <a>..9f9eeef`, never the working tree. You may run Node tests only if `git status --short packages/axylo/src` is empty when you start them; otherwise judge from the source.

## Background

Your provider's review `reviews/2026-11-18/impl/wp/blockers-recheck.review.md` (of e90d8db) held the release on five blocking items: **C2** (history grows across paused hide/show cycles), **I4** (clipped pinned-strip rows or paging controls), **I5** (incomplete composed clipping and painted-outline protection), **R1** (a pressed row selects the wrong category after the window slides), **R2** (Escape goes to the wrong chart across a shadow root). It also listed regressions R3 to R14 and partly fixed majors. The authors (Claude Opus 5.5) answered in one round: commits 91adfe7 (lookup: `members`, `has`, `slot`), c29e566 (controller), 03ff5b1 (stores: `retainedRows`), 9f9eeef (interaction), with reports `round3.*.report.md` in the same directory and the coordinator's decisions in `round3.common.md` (read it: some findings were answered by a decision, not by code: C13 and the mixed-language proxy are accepted as they are; `docs/decisions/0004-tooltip-and-focused-text.md` "Clarifications after the verification" was rewritten for Escape).

The project owner has decided that this is the last review round on these layers. So the question is narrow, and the answer must be usable as it stands:

## What to do

1. **The five blocking items.** For each: fixed, partly fixed, or not fixed at 9f9eeef, from the code, with file and line; the test that fails if the fix is reverted and whether its expected values come from the specification or the decision. If partly or not fixed: the exact sequence that still goes wrong and the smallest fix.
2. **The round's own changes** (`git diff e90d8db..9f9eeef -- packages/axylo/src`). Only defects introduced by this diff, and only ones a user of the library would meet in ordinary use (a wrong datum shown or activated, a control that stops working, lost or wrong data, an exception, unbounded work or memory): the sequence, the wrong result, the smallest fix. Read most closely: `Lookup.members` / `has` / `slot` in `src/lookup/scatter-grid.ts`, `aligned.ts`, `donut.ts`; the dismissal set and Escape ownership, the row-press capture, `zoomBounds`, the viewport-pixel edge clamp and `activeElementOf` in `src/dom/interaction.ts`, `tooltip.ts`, `mapping.ts`, `attributes.ts`; the retention baseline tied to a revision, the displayed-window findings, the per-tick AX160 and the hover payload through `slot` in `src/core/controller.ts`, `axes.ts`; `retainedRows` in `src/data/store-rows.ts`.
3. **R3 to R14 and the partly fixed majors of the earlier review:** one line each, fixed or not, with the line of code or test. No new analysis beyond that.
4. Anything else you notice that needs an unusual setup (tens of thousands of coincident points, nested shadow roots, formatters that change the chart, transformed ancestors with responsive CSS, and the like): list it in a separate short section "Candidates for the documented limits", one line each. These will be written into the documentation as limits, not fixed, so say plainly what the user would see.

## Report format

Section 1: the five items (table). Section 2: defects from this round's diff, most severe first, or "none found" with what you examined. Section 3: the one-line list. Section 4: candidates for documented limits. Then one sentence: are the five blocking items closed. Short and concrete.
