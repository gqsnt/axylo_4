# Work package: merge the acceptance evidence into the matrix

Read `AGENTS.md`. You own `acceptance/**` and nothing else; do not commit. You wrote the matrix and its checker (`reviews/2026-11-18/impl/wp/acceptance.report.md`).

Since then two acceptance suites were written, each with an index of its tests:

- `packages/axylo/test/acceptance/EVIDENCE.json`: 494 Node tests through the DOM-free controller (yours).
- `packages/axylo/test/browser/acceptance/EVIDENCE.json`: 457 browser tests (another author; rendered output, Chrome's accessibility tree, real input). Its report is `reviews/2026-11-18/impl/wp/acceptance-browser.report.md`.
- Also new: distribution tests in `tests/dist/` (DX1, DX7, DX8, DX11; report `reviews/2026-11-18/impl/wp/dist.report.md`), run through their own Vitest config (`tests/dist/vitest.config.ts`), and React tests in `packages/react/test/`.

Do this:

1. Extend the matrix so each cell can cite evidence from these suites. Keep the judgement you applied the first time: an entry in an `EVIDENCE.json` is a claim, not evidence. For each cell, read the cited tests and decide whether together they establish the criterion for that chart type (a criterion often needs both the model-level test and the rendered one), which remain `weak` and why, and which cells still have nothing. Do not mark a cell covered because a test's title names the criterion.
2. Make the checker accept several result files and several roots, and print for each cell which reports its result came from. Results are in `acceptance/results/` if present: `unit.json` (root config, Node), `browser.json` (root config, `AXYLO_BROWSER=1`), `dist.json` and `dist-browser.json` (the distribution config). Some may be absent: the coordinator produces them; you cannot launch a browser. You can produce `unit.json` yourself with `env -u AXYLO_BROWSER timeout 400 npx vitest run --reporter=json --outputFile=acceptance/results/unit.json`.
3. Regenerate `acceptance/report.md`: counts per status, the table, and the gap list in reader priority order, now much shorter. Add a section "What cannot be verified here" (screen readers for A3, Firefox and Safari, phones, GPU) and a section "Evidence that exists but was not run for this report".
4. Update the checker's tests for anything you changed in it.

Known state to reflect honestly: the browser acceptance suite has 5 failing tests at commit 77213c0 (C4 compact bar; L1 at 200% text for line, area, scatter, donut); the performance rows P1–P8 have no valid measurements yet (the earlier ones were partly voided; see `docs/decisions/0002-mark-renderer.md`); DX7 is measured and over target (`bench/size-latest.json`); A9 (the conformance table) and DX12 (the agent rehearsal) do not exist yet.

Run `node --test acceptance/test/*.test.mjs` and `node acceptance/check.mjs --results acceptance/results/unit.json` (plus any other result files present). Report: counts per status before and after; the cells still without evidence, in reader priority order; cells where the two suites disagree or where you judged cited tests weak; the last lines of the runs.
