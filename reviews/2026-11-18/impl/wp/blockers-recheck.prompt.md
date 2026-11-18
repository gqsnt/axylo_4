# Code review follow-up: are the blocking defects of the two verification reviews closed?

This is an ordinary software quality review of a charting library's TypeScript source (line, bar, scatter and donut charts in a web page). It has nothing to do with security. You are an independent reviewer from a different provider than the authors. Read-only: do not edit anything; your final message is the report. Repository: /home/canarit/projects/axylo. Review the committed state at HEAD (`git log -1`); `apps/docs/**` has uncommitted work by a documentation author that is not part of this review. Project rules: `AGENTS.md`.

## Scope: narrow on purpose

Two reviews by your provider found new defects in commit bbd7564:

- `reviews/2026-11-18/impl/wp/fixes-verify.controller.review.md` ("New defects" 1 to 14; 1, 2 and 3 blocking);
- `reviews/2026-11-18/impl/wp/fixes-verify.interaction.review.md` ("New defects" table; the five rows marked B are blocking).

The authors (Claude Opus 5.5) then made these commits: 315cd9e (data, lookup), d9dd81e (controller), 2bbef28 (layout), e90d8db (interaction), a96835e and 12492de (controller, smaller). Their reports: `data-verify.fix.report.md`, `controller-verify.fix.report.md`, `layout-x-coarser.report.md`, `interaction-verify.fix.report.md` in the same directory. `docs/decisions/0004-tooltip-and-focused-text.md` gained a section "Clarifications after the verification": it is part of the rules now; read it before judging the interaction items.

Do exactly this, and no wider survey:

1. **For each defect of the two "New defects" lists** (blocking first, then major): from the code at HEAD, not from the authors' reports, is it **fixed**, **partly fixed**, **not fixed**, or **fixed with a new defect**? Cite file and line. Name the test that fails if the fix is reverted, and say whether its expected values come from the specification or decision rather than from the implementation; "none" is a finding. You may run Node tests (`npx vitest run <path>`); no builds, no browsers.
2. **Regressions introduced by these commits only.** Read the diffs (`git diff bbd7564..HEAD -- packages/axylo/src`). For each changed area, work through ordinary sequences of public calls and pointer or key events and report any whose result is wrong, with the sequence, the wrong result and the smallest fix. Areas that deserve the closest reading: the per-call preparation state and liveness checks in `src/core/controller.ts`; the raw-window copy for paused re-encoding (`freeze()`); the axis-parts cache key in `src/core/axes.ts`; the row-index fill in `src/data/store-buffers.ts` (`setRow`); `pointerOnPlot` in `src/lookup/geometry.ts` and the lattice built with the lookup in `src/lookup/scatter-grid.ts`; the x coarser-domain path in `src/layout/index.ts`; in `src/dom/interaction.ts` the pin identity, gesture start ending a pin, the rest clock, the Select range toggle (two clicks; Escape order), row keys in `src/dom/tooltip.ts`, `visibleRegion` across shadow roots in `src/dom/mapping.ts`.
3. Do not re-report: the packed size being over its target (known, scheduled); the screen-reader rehearsal and the conformance table (owner's decisions and separate work); findings of the earlier reviews that those reviews already marked fixed.

## Report format

Table 1: defect, severity, status, evidence (file:line), reverting test and its basis. Table 2: regressions (severity, sequence, wrong result, smallest fix), most severe first; say "none found" if so, and what you examined. Then one paragraph: may the release acceptance run start, and if not, the exact list that blocks it. Short and concrete; no general advice.
