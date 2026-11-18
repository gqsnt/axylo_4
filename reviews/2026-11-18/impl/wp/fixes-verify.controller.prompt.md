# Code review follow-up: were the controller and data findings of the final review fixed?

This is an ordinary software quality review of a charting library's TypeScript source (rendering line, bar and donut charts in a web page). It has nothing to do with security.

You are an independent reviewer from a different provider than the authors. Read-only: do not edit anything; your final message is the report. The repository is /home/canarit/projects/axylo (Axylo, a browser charting library). Read `AGENTS.md` for the project's rules and `docs/02-product-spec.md` where a finding cites it.

Review the committed state at commit bbd7564 only. Two authors are making small uncommitted edits right now (`packages/axylo/src/core/chart.ts`, `packages/axylo/src/dom/**`, `packages/axylo/src/core/controller.ts`, a few test files): read file contents with `git show bbd7564:<path>` (or check `git status` and avoid files it lists as modified) so you judge what is committed.

## What to verify

`reviews/2026-11-18/impl/wp/core-final.controller.review.md` is the final review you (another run of your provider) wrote of the controller, data stores, lookup, scene and reader. Since then the authors (Claude Opus 5.5) made these passes; their own reports are in the same directory: `core8.fix.report.md`, `core8.fix2.report.md`, `core8.fix3.report.md`, `data-final.fix.report.md`, `data-final.fix2.report.md`. Commits: 059e269, e55d984, 6ebdb6f, 3853361.

For every finding in that review (blockers first, then majors, then the rest):

1. State whether it is **fixed**, **partly fixed**, **not fixed**, or **fixed with a new defect**, from the code at bbd7564, not from the authors' reports. Cite file and line.
2. Say whether a test now exists that would fail if the fix were reverted, and whether that test's expected values come from the specification (the project forbids pasting the implementation's output). Name the test. A fix with no such test is a finding.
3. Where the authors' reports claim something you cannot confirm from the code or tests, say so.

Then look for regressions the fixes introduced: the displayed-snapshot ownership in `packages/axylo/src/core/controller.ts` (what is on screen, drawn, accepted, held while paused, and in flight each own their rows; callbacks run after publication), zero-copy appends and `ownedBytes()` in `packages/axylo/src/data/**`, the lattice-bounded scatter pick in `packages/axylo/src/lookup/scatter-grid.ts`, `PointSeries.missingX` / `missingRow`. Work through concrete sequences of ordinary public calls (`update`, `append`, `pause`, `resume`, `zoom`, `destroy`, callbacks that call back into the chart) and check, by tracing the code, that each leaves the chart showing correct data; report any sequence whose result is wrong. You may run Node tests read-only (`npx vitest run <path>`), but not builds.

One known, deliberate failing test: `packages/axylo/test/data/streaming-storage.test.ts` "bounds the retained typed-array backing…" (the owner is deciding the memory budget). Do not count it.

## Report format

A table: finding id, severity, status, evidence (file:line), reverting test (name or "none"). Then "New defects" (each with a concrete call sequence, the wrong result, and the smallest fix), ordered by severity. Then "Claims not confirmed". Then one paragraph: is this part ready for the release acceptance run, and if not, the exact list that blocks it. Be concrete and short; no general advice.
