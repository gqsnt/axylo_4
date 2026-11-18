# Work package: labels reported hidden when none is

Read `AGENTS.md`. You own `packages/axylo/src/layout/**` and `packages/axylo/test/layout/**`. Nothing else; do not commit. You wrote this module (`reviews/2026-11-18/impl/wp/layout.*`, `design-pass-1.*`).

## The defect

The documentation's example test is red (`apps/docs/test/examples.browser.test.ts`, example `apps/docs/examples/dates.ts`; report `reviews/2026-11-18/impl/wp/docs.report.md`, first item under "Where the library, spec and plan disagree"): on time and date axes the chart raises AX143 and shows the note "Some labels hidden. See table." although every label the layout chose to draw is visible. Observed by the documentation author: an instants chart 752 px wide in America/Los_Angeles; the minimal AX111 input in UTC; a time line chart at phone width; a chart 364 px wide where all four month labels are visible. Their suspicion, inferred from the code and not traced: `src/layout/labels.ts` near line 142 counts repeated tick text from denser candidate tick sets as hidden labels.

Spec L1 and the label-fitting paragraph before it in `docs/02-product-spec.md` (section 3.2): for continuous axes (number, time, date) fewer ticks is the remedy and loses nothing, because ticks are a sample of a continuous scale; the "labels hidden" note and AX143 are for the case where a label that identifies data (a category) cannot be shown after thinning, wrapping, rotating and truncating. Thinning ticks on a continuous axis must never raise AX143 or the note. Check the spec text yourself and report if it says otherwise.

## What to do

1. Reproduce in Node with `computeLayout`: build inputs like the four observed cases (read `apps/docs/examples/dates.ts` and `line-time.ts` for the data and sizes; construct the layout input as your existing tests do, with the same deterministic text measurer). Tests first.
2. Fix the accounting so that `fit` (the layout's record of what was hidden, which the controller turns into AX143 and the note) is true only when a category label was dropped or truncated beyond what the spec allows without a note. State the exact rule you implement for each axis kind and for repeated labels on time axes (the layout suppresses a repeated date part; that is not hiding).
3. A property test (fast-check, at least 1,000 runs): for any continuous x axis (number, time, date, wall), any width from 120 to 1,920 px and any locale among a small fixed set, the layout never reports hidden x labels; and for category axes it reports them exactly when the number of drawn labels is smaller than the number of categories in view or a drawn label is truncated (compare with a count made in the test from the layout's own placed texts).
4. Check the y axis by the same reasoning.

Another agent is changing `packages/axylo/src/core/axes.ts` (how tick candidates and the value domain are handed to layout) and may make narrow edits in `src/layout` for one finding (the value domain must end at a drawn tick at every plot height); if you see uncommitted changes in your files that are not yours, keep them and work around them; say so in the report.

Run `timeout 300 npx vitest run packages/axylo/test/layout packages/axylo/test/acceptance`. You cannot launch a browser. Never leave a process running. Report: the cause, the rule, tests added, the last lines of the run, and whether the controller needs any change to how it reads `fit`.
