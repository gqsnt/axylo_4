# Work package: the acceptance matrix and its checker

Read `AGENTS.md` first; its rules apply. You own the directory `acceptance/` and nothing else. Do not edit tests, source, docs or configuration. Do not commit.

## Why this exists

`docs/03-plan-typescript-release.md` (line 7 and the table near line 382) says the 1.0 release is done when every row of the acceptance matrix passes, and that the matrix lives in the repository as data with a checker. `docs/02-product-spec.md` line 88 defines a row: criterion → test → chart types it applies to → result. Criterion A9 also needs "a CI check that every listed test exists". Today the criteria and the tests exist but nothing connects them, so nobody can say which criteria are covered, which are covered for some chart types only, and which have no evidence at all. That list of gaps is the main thing the owner needs from this package; it decides what gets built next.

## What to build

1. **`acceptance/matrix.json`** (or several JSON files if one is unwieldy): one entry per criterion in spec sections 3.1–3.4, 3.7, 4 and 5 (F1–F12, L1–L8, I1–I6, A1–A10, C1–C5, DX1–DX12, P1–P8; take the list from the spec, not from this sentence), and one per cell of the type matrix in 3.6. For each: the criterion ID, a short statement in the spec's own words, the chart types it applies to (line, area, bar, scatter, donut, compact) with a reason for each "not applicable", and for each applicable type the evidence: test file plus the exact test title (or a title prefix when one `describe` block is the evidence), and what kind of evidence it is (unit, property, browser, benchmark, document, manual rehearsal).
2. **`acceptance/check.mjs`**: a Node script with no dependencies. It
   - reads the criterion IDs out of `docs/02-product-spec.md` and fails when the matrix has an ID the spec lacks or the spec has one the matrix lacks;
   - fails when a listed test file or title does not exist (parse titles from the test sources; say in a comment what the parser does not handle);
   - optionally takes Vitest JSON reports (`--results <file>…`, produced with `--reporter=json --outputFile=…`) and joins them to the rows, so each row gets a current result;
   - prints a table and writes `acceptance/report.md`: per criterion and chart type one of `pass`, `fail`, `no evidence`, `not run`, `cannot be verified here`, `not applicable`;
   - exits non-zero on structural errors (stale IDs, missing tests) always, and on `fail` / `no evidence` only with `--release`.
3. **Tests for the checker** in `acceptance/test/` using `node --test`: a stale ID, a missing test title, a failing result, a criterion with evidence for some types only. Use small fixture files in `acceptance/test/fixtures/`, not the real matrix.
4. **`acceptance/README.md`**: how to run it, what each status means, how to add a row. Short.

## Rules for filling the matrix

- A row is evidence only if the named test really checks the criterion. Read the test body. A test whose title sounds right but asserts something weaker is not evidence: list it under `weak` with one sentence saying what it does not check. Do not stretch.
- Applicability is per chart type. A criterion tested on line charts only is `no evidence` for bar, area, scatter, donut and compact unless a test covers them.
- Some evidence cannot exist on this machine: screen-reader rehearsal (A3), Firefox and Safari, a real phone, GPU rasterisation. Mark those `cannot be verified here` with the reason. Never mark them pass.
- Performance rows P1–P8 point at `bench/` workloads where one exists (`bench/README.md`, `bench/src/`); the provisional limits are not frozen yet, so their status is `not run` unless a history file in `bench/history/` holds a measurement, in which case cite it without judging pass or fail.
- Tests live in `packages/axylo/test/**` (unit: `*.test.ts`; browser: `*.browser.test.ts`) and `packages/react/test/**`. The chart core (`packages/axylo/src/core`, `src/dom`, and their tests under `test/core`, `test/browser/chart`, `test/browser/a11y`) is being changed by another agent while you work: titles there may move. Record what you see; the checker exists to catch the drift.
- You cannot launch a browser in this sandbox and must not try. You can run `timeout 120 npx vitest run --reporter=json --outputFile=<file under acceptance/results/>` for the unit suite to try the checker on a real report. If a run hangs or fails for reasons outside `acceptance/`, say so and move on. Never leave a process running.

## Done means

- `node --test acceptance/test/*.test.mjs` passes.
- `node acceptance/check.mjs` runs on the real matrix and exits zero (structure is consistent), and `acceptance/report.md` exists.
- Your report gives the counts per status and, most important, the list of criteria (and chart types) with no evidence or weak evidence, ordered by how much they matter to a reader of a chart. Keep "ran and saw" apart from "expect".
