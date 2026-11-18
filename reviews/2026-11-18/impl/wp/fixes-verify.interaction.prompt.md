# Verification: were the interaction findings of the final review fixed?

You are an independent reviewer from a different provider than the authors. Read-only: do not edit anything; your final message is the report. The repository is /home/canarit/projects/axylo (Axylo, a browser charting library). Read `AGENTS.md` for the project's rules, `docs/decisions/0004-tooltip-and-focused-text.md` (revision 3: the rules the interaction layer must implement) and spec sections I1–I4, A1–A10 in `docs/02-product-spec.md`.

Review the committed state at commit bbd7564 only. Two authors are making small uncommitted edits right now (`packages/axylo/src/dom/**`, `packages/axylo/src/core/chart.ts`, `packages/axylo/src/core/controller.ts`, a few test files): read file contents with `git show bbd7564:<path>` so you judge what is committed.

## What to verify

`reviews/2026-11-18/impl/wp/core-final.interaction.review.md` is the final review your provider wrote of the interaction layer. Since then the author (Claude Opus 5.5) rebuilt it as one state machine: commit 28174df, report `reviews/2026-11-18/impl/wp/interaction-final.fix.report.md`. Files: `packages/axylo/src/dom/interaction.ts`, `tooltip.ts`, `placement.ts`, `mapping.ts`, `pointer.ts`, `toolbar.ts`, `packages/axylo/src/core/focus.ts`; tests `packages/axylo/test/core/focus-*.test.ts`, `packages/axylo/test/browser/chart/final-*.browser.test.ts`, `review*.browser.test.ts`.

Two items are known and in progress, do not report them as new: (a) the non-dragging two-click range selection (finding C2-8; the `selectRange` message key exists, its toolbar toggle is being built); (b) `measure()` in `packages/axylo/src/core/chart.ts` treats a plot scale within 2% of 1 as 1.

For every finding in the review:

1. Status from the code at bbd7564, not from the author's report: **fixed**, **partly fixed**, **not fixed**, or **fixed with a new defect**. Cite file and line.
2. Whether a test exists that would fail if the fix were reverted, with expected values that come from decision 0004 or the specification rather than from the implementation. Name it. A fix with no such test is a finding.
3. Claims in the author's report that you cannot confirm.

Then check the state machine itself against decision 0004 revision 3, rule by rule: the states `none`, `keyboard`, `hover`, `held`, `pinned` and every transition between them. For each rule of the decision, name the code that implements it or say it is missing. Try to construct concrete event sequences (pointer moves with timestamps, clicks, key presses, redraws, data updates, resize, pause/resume, focus changes, touch then mouse) that reach a state the decision forbids: a hold that changes what a click activates; a tooltip covering a control or the focus ring; a tooltip larger than the visible plot; Escape doing two things; a pin that survives its datum's removal or points at a different datum after an update; pinned row buttons that move or lose focus across a redraw; focused range text rewritten for a reason outside the four allowed. Trace each through the code and say what happens. You may run Node tests read-only (`npx vitest run <path>`), but not builds or browsers.

## Report format

A table: finding id, severity, status, evidence (file:line), reverting test (name or "none"). Then "Decision 0004 rule by rule" (rule, implementing code, verdict). Then "New defects" (each with the event sequence, the wrong result, the smallest fix), ordered by severity. Then "Claims not confirmed". Then one paragraph: is the interaction layer ready for the release acceptance run, and if not, the exact list that blocks it. Concrete and short; no general advice.
