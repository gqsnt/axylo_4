# Review of an acceptance matrix: does each citation establish what its cell claims?

This is an ordinary software quality review of test evidence for a charting library (line, bar, scatter and donut charts in a web page). It has nothing to do with security. You are an independent reviewer from a different provider than the authors. Read-only: do not edit anything; your final message is the report. Repository: /home/canarit/projects/axylo. Review commit d9fa4b0 (`git show d9fa4b0:<path>`; another author is editing test files under `packages/axylo/test/browser/{chart,a11y,render}` in the working tree to add engine guards, without renaming tests).

## What you are reviewing

`acceptance/matrix.json` records, for each criterion of the product specification (`docs/02-product-spec.md`) and each chart type, the named tests that establish it, or a reason why it is not established. `acceptance/README.md` explains the format, the statuses and the checker (`acceptance/check.mjs`). The matrix was just re-merged by a Claude Opus 5.5 agent with seven workers: its report is `reviews/2026-11-18/impl/wp/matrix-merge.report.md`, the per-family notes are in `reviews/2026-11-18/impl/wp/matrix-merge-notes/`. The rule it had to follow: nothing in the matrix may claim more than a cited test actually asserts; a weaker claim honestly stated is better than a citation that does not establish the claim.

No results are recorded at this commit, so statuses are "not run" or "weak" by design; you are judging the citations, not results.

## What to do

1. **Cells that would pass when run.** The report says 117 cells reach "pass" once their cited tests pass (no `gaps`, `pending` or `cannotVerify`). These are the claims that matter. Take every such cell of these rows in full: F1, F4, F11, I2, I6, A1, A4, A7, L5, C3, DX8, DX11; and a sample of at least 25 further cells spread over the other families. For each: open every cited test, read its assertions and the helpers they call, and decide whether together they establish every part of the criterion's current statement for that chart type (compact means compact line, area and bar unless the cell says otherwise). Verdict per cell: established; established except for a part (name it: the cell should be weak with that gap); not established. Give file and line for what is missing.
2. **Downgrades.** For ten of the 57 downgraded cells (your choice, across families), check that the recorded gap is real and specific, and whether the cell overstates what remains.
3. **Reasons.** Check the `notApplicable`, `cannotVerify` and `pending` texts of A3, A6, A9, DX9, DX12, P1 to P8 and any "not applicable" that looks wrong to you: is each true and specific? In particular A3: the owner decided no screen-reader rehearsal is part of 1.0; the cell must say that plainly and must not read as failed or as verified.
4. **The WCAG citations.** The last column of the spec's criterion rows cites WCAG 2.2 criteria (seventeen were added in commit 71f2a02 by the coordinator, from judgment). For each cited criterion and row: does the row's statement, with the tests the matrix cites for it, really address that success criterion? List citations that should be removed or moved, and applicable A/AA criteria that a row clearly covers but does not cite. `apps/docs/data/wcag.mjs` classes the uncited ones as not applicable, the page's responsibility, or not assessed: flag any classed wrongly.
5. **The report's own findings.** Its "Titles that promise more than their assertions" and "Checker and helper defects": confirm or refute five of each (your choice, the ones with most consequence).

## Report format

Section 1: a table of the cells you checked (row, type, verdict, what is missing with file:line). Section 2: the ten downgrades. Section 3: reasons. Section 4: WCAG citations. Section 5: the report's findings. Then the three things that most need fixing before this matrix is used as release evidence. Short and concrete; no general advice.
