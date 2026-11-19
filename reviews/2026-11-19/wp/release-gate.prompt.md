# The owner's release gate: 1.0 ships with documented gaps

You are working in /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library). Read `AGENTS.md`, `acceptance/README.md`, `acceptance/check.mjs` and its tests. You may edit `acceptance/check.mjs`, `acceptance/README.md`, `acceptance/test/**`, `acceptance/matrix.json`, `acceptance/report.md` (by its documented command only), `docs/03-plan-typescript-release.md` (the release milestone's gate text only) and `apps/docs/lib/conformance.mjs` with its test if the page must show the new verdict. You cannot commit; the coordinator commits. No network. Do not run `npm run build`. Benchmarks may be running on this machine: keep your test runs short (the checker's Node tests only).

## The decision (the owner, 2026-11-19, verbatim "Documented gaps")

Release mode (`node acceptance/check.mjs --release --results …`) passes when, for every cell of the matrix:
- the cell passes; or
- it is not applicable; or
- it is **weak with a documented gap**: every cited result for it passes (none fails, none is missing or not run for this revision), and the cell carries a non-empty `gaps` text that names what is not established; such cells are listed in the report under "Released with documented gaps" with their gap text, and the docs conformance page shows them the same way; or
- it is `not run` or `cannot be verified here` with an owner's waiver (as now).

Everything else blocks: a failure, a missing or stale result, a `pending` measurement (the performance rows until the benchmarks are recorded), a weak cell whose gap text is empty or whose cited results did not all pass.

## What to do

1. Implement that rule in `check.mjs` (release mode only; the ordinary mode is unchanged), with tests: a weak cell with a gap and passing results passes release mode; with an empty gap it blocks; with a failing cited result it blocks; a pending cell blocks; waivers work as before.
2. `acceptance/README.md`: state the gate as the owner's decision with the date, in the status section.
3. `docs/03-plan-typescript-release.md`: in the release milestone (M8), the gate text says the same, citing the README.
4. The docs conformance page (`apps/docs/lib/conformance.mjs`): if the checker's structured `rows` need a field to tell "weak, released with a documented gap" from plain weak, add it and make the page show it; keep the page's guard as strict as it is; update its test.
5. **The matrix** (`acceptance/matrix.json`):
   - DX12 is no longer pending: the agent rehearsal was run and accepted for release candidate 1e93128 (records on disk in `rehearsal/records/release-1e93128/`, not in git; the accepted analysis is `reviews/2026-11-19/wp/rehearsal-analysis.md`; the record is stated on `apps/docs/pages/stability.md`). Cite what the checker can verify (the rehearsal's own tests in `rehearsal/test/**` are Node and browser tests of the harness, not of DX12; the record is a document): use the checker's existing document or weak citation form for the analysis and the stability page, with a gap that says the rehearsal is recorded for 1e93128 by a run outside the checker and must be repeated for the release commit, and the limits from the analysis.
   - List, after your change, every cell that still blocks release mode against the six result files recorded at 1e38333 (`acceptance/results/{unit,browser,browser-firefox,browser-webkit,dist,dist-browser}.json`; their provenance is for an older commit, so expect "not recorded for this revision" everywhere: also run the check with provenance ignored if the checker has such a mode for diagnosis, or reason it from the static output) grouped by reason: pending measurement, cannot be verified without a waiver, weak without a gap, other. Do not add waivers: only the owner grants them; list the cells that would need one and why.
6. Regenerate `acceptance/report.md` by its command; run `node --test acceptance/test/*.test.mjs` and `npx vitest run --config apps/docs/vitest.config.ts` (Node only).

Report (final message): the change, the tests, the blocking cells grouped by reason, the cells that would need an owner's waiver, the last lines of the runs.
