<!-- Reviewer: Claude Opus 5.5 (requested effort xhigh), Agent-tool subagent a2a18f27e1659b924, read-only. The code under review was written by Codex gpt-6.2-sol, so this is a cross-provider review of that code. Saved by the coordinator from the hand-back. -->

## Review of the Node acceptance suite and the acceptance matrix/checker

**What I read.** Node suite: `packages/axylo/test/acceptance/**` at 689102e. These files are unchanged through HEAD d49e8a8. The 18 failures listed in REPORT.md went away because the implementation changed; no test was edited. Matrix and checker: the merged commit **c37c04d** (07:22:51), with check.mjs `f99b2184…`, titles.mjs `fd691c97…` and matrix.json `c3ce4bbe…`. Before that I had read the in-flux working copy (07:14) and the pre-merge matrix `fa564a62` (6bd5f9c).

**What I ran.**
- `timeout 300 npx vitest run packages/axylo/test/acceptance`: `Test Files 16 passed (16) / Tests 494 passed (494)` at 07:10:58. It also gives 494/494 with `TZ=America/Los_Angeles` and with `TZ=Pacific/Kiritimati`.
- `node --test acceptance/test/check.test.mjs`: 12/12 pass.
- `node acceptance/check.mjs --results acceptance/results/*.json`: exit 0 at 07:23, with 117 pass / 11 fail / 128 weak / 18 no evidence / 21 not run / 15 cannot verify / 266 n/a. At about 07:30 the static check exits 1 because another agent renamed a test in `tests/dist/types.test.ts`. That failure is transient and outside this scope.

**Mutation method.** I put modified copies of library modules in a scratch directory. A scratch Vitest file `vi.mock`'d the real module path with the copy and then `await import`ed the real acceptance test files. An identity copy (control) passed all 196 tests. Every mutation below was run unless marked "reasoned".

**A file I changed by accident.** Running `check.mjs --results …` rewrote the tracked file `acceptance/report.md` (only the order of the runs changed). I restored it from HEAD, which is identical to c37c04d. The scratch directory has been deleted and nothing is left running.

---

### Findings (most severe first)

**1. B — The F5 property tests never engage the simplifier.**
- Where: `f-dense.test.ts:48-77`, `:184-198`, and the second configuration of `:138-156`.
- Why: `simplify/index.ts:190-192` simplifies only when there are more than 4 × device columns of values. The property draws 580 samples into a 205 px plot, so the limit is 820 at DPR 1 and 1,640 at DPR 2.
- Ran: a probe drew 579 of 579 vertices at both DPRs. The one-column-peaks test drew 699/699. The T-dense zoom 110–760 at DPR 2 drew 652/651.
- Ran: a mutation that throws whenever the dense path is reached failed only 3 of 416 tests: the 1M-outlier test, T-dense-line and T-dense-area (first configuration only).
- So the four F5 property tests ("for every generated dense … dataset", 4,000 cases) say nothing about F5. Never exercised under simplification: compact line and compact area, stacked areas "on their cumulative sums", "two peaks and a gap in one column", and several zoom levels.
- The matrix gap texts claim the opposite: T-dense-area says "Cumulative extrema … are checked", F5/compact says "Model extrema tests exercise compact line and stacked area at two DPRs".
- Fix: use at least 10× the device columns (for example 5k–50k samples at 245 px), and generate the positions of nulls, peaks and dips. Add a precondition that fewer vertices are drawn than values. Make T-dense-area stacked.

**2. B — The per-column minimum is never asserted.**
- Ran: a mutation where `keepColumn` ignores the minimum (`min = first`) passed 196/196 tests (f-dense, f-missing-values, f-stacks, compact, f-disclosure, f-order, dx-diagnostics).
- Why: the 1M fixture has one interior maximum, and the T-dense values are a constant 3 with the peaks at run ends.
- The same mutation for the maximum is caught by the 1M and T-dense tests.
- The matrix marks **F5/line and T-dense-line as pass**.
- Fix: add an interior dip (for example −999) to the dense fixtures, plus finding 1's fixed property.

**3. B — F4 never varies the viewer's time zone.**
- Why: `host.ts:91` hard-codes `timeZone: 'UTC'`. Every F4 and F6 test varies the `timeZone` option instead.
- Ran: changing the default zone for instants to `'UTC'` (`data/x.ts:157`) passed 333/333 tests in f-time, f-format, dx-diagnostics, reader-model, type-matrix and f-missing-values.
- Not established: "(default: the viewer's)", and calendar dates being identical in every *viewer* zone (the spec's verification uses three viewer zones).
- AX152's "The viewer's zone is used" is asserted as 'UTC', which cannot be told apart from a hard-coded UTC (`dx-diagnostics.test.ts:129`).
- The matrix marks F4 line/area/bar/scatter/compact as pass. The only viewer-zone test, `browser/chart/data.browser.test.ts:150`, is not cited and covers only line tick text for calendar dates.
- This can be tested on this machine: make the host zone a `record()` setting, and use Playwright `timezoneId` (the harness already supports it).

**4. M — The scatter table drops the very rows the F12 note points to, and two tests assume incompatible readings.**
- Ran: on scatter, the dirty fixture gives the note "Values not shown: 3. See table." but the table has 5 rows. The NaN row (x=4) and the `'40'` row (x=5) are absent; the null and undefined rows read "No data".
- The F12 test skips the table for scatter (`f-disclosure.test.ts:27`).
- DX2 pins the drop: expected `['6','8']` for scatter (`dx-controller.test.ts:35`).
- F2 scatter (`f-missing-values.test.ts:126`) reads that the table keeps omitted observations.
- The aligned charts show "No data" for invalid values. The matrix marks F12/scatter as pass.
- Fix: decide on one reading. A reader sent to the table should find every omitted row. Then assert the scatter table in F12, DX2 and the AX102/103/106 tests.

**5. M — The F10 generator fixes each series' sign.**
- Where: `f-stacks.test.ts:10-12`. Series a and c are always positive, b and d always negative, magnitudes 2–20, the same values at both x, and never 0 or missing.
- Ran: a mutation that picks the stacking side from the series' first value passed 196/196.
- The matrix gap text "The controller verifies mixed-sign geometry" overclaims.
- Fix: generate a sign per cell, including 0 and null.

**6. M — F7 "a small maximum uses the first tick" asserts only `upper < full`.**
- Where: `f-domains.test.ts:79-93`.
- Ran: a mutation where a percent or ratio maximum below half scale ends at half scale (50 / 0.5) passed 195/195. The spec's "a 4% maximum ends at the first tick at or above 4%" is not established.
- The low end is checked only as "is a drawn tick" (`:105`), not "the first at or beyond −5". A mutation adding one extra step at the low end was caught, but only incidentally (counterexample 46 after 20 runs).
- The F7 matrix gap text does not mention the percent case.
- Fix: assert `domain[1]` equals the first drawn tick ≥ the maximum, and `domain[0]` equals the last drawn tick ≤ the minimum.

**7. M — `--release` passes with "not run" and "cannot be verified here" cells.**
- Where: `check.mjs:417` (the exit code counts only fail, weak and no evidence). Plan line 7 says "every row … passes".
- Ran, with a fixture and real Vitest JSON: a cited test file that throws at import produces "not run", and `--release` exits 0.
- Leaving out `browser.json` turns every browser-cited cell into "not run" instead of a failure. The README even says "Omit reports that are absent."
- Today 21 not-run and 15 cannot-verify cells would not block a release.
- Fix: in release mode accept only pass and not applicable, unless an owner waiver is recorded. Treat a suite-level failure of a cited file as fail.

**8. M — Results carry no provenance.**
- `acceptance/results/` is gitignored. Results have no commit, tree or source hash. Archived absolute paths are accepted by suffix (`check.mjs:222-224`).
- Ran: an old JSON keeps "stale title" at pass while the current run of that test fails.
- The merged matrix's own numbers come from runs "at 77213c0 and bf8fabf". HEAD is d49e8a8 with uncommitted `src/core` edits.
- Fix: write each results file with git SHA, dirty flag and hashes of the cited files, and reject mismatches under `--release`.

**9. M — `it.fails` counts as a pass.**
- Ran: an `it.fails` test whose assertion fails is reported `passed`, and the cell is pass. The scanner skips modifiers other than each, skipIf and runIf (`titles.mjs:127-129`).
- Fix: record the modifiers and refuse citations of `.fails`, `.todo` and `.skip`.

**10. M — Describe-prefix evidence ignores tests registered through a helper.**
- Where: `check.mjs:270-277`. The expected set comes from the source scanner, and report entries outside that set are dropped.
- Ran: a failing test registered by a helper inside the cited describe left the cell at pass.
- Fix: for prefix citations, require every reported assertion under the prefix to pass.

**11. M — The host stand-in is generous where the tests depend on it.**
- What it fixes in place (`host.ts`):
  - text width = `length × 7` (`:125`), with no fonts, wrapping or letter spacing;
  - caption and controls at a fixed 20 px per line, ignoring title wrap and legend rows (`:65-81`);
  - plot width equals container width;
  - theme always light, `backdropKnown: false` (`:140-147`);
  - zone always UTC;
  - locale always `'en-US'` (`:134`), and `chart()` always injects `locale: 'en-US'` (`model.ts:17`), so the page-locale path of F6 never runs.
- Tests that depend on it:
  - L1 ×4: the label boxes are measured with the same measurer that laid them out;
  - AX143, AX142/L8 (95×150) and C3;
  - L3: `plot(r).width === width` is true by construction of the host;
  - F4 and F6.
- Tests that reach internals and would still pass if the DOM wiring broke: T-keyboard (`stepAcross`), the "announcements" (calls `valueText` directly), the effect (`vi.spyOn(stages,'toPublic')`), the F8 legend (`sliceText`).
- Fix: vary measurer width, zone, locale and caption height per test. Keep the browser citations required for these cells (most already are).

**12. M — F2 area: "an isolated value between two gaps is a visible point" holds only through L5 markers.**
- Ran: a mutation removing the forced markers for isolated values failed only "F5 line: alternating null and valid slots…".
- Why: at 720 px with 8 points every point gets a marker anyway (spacing ≥ 12 px). That satisfies the F2 point checks (`f-missing-values:38`) and the F12 "Sun as a point" check `some(mark => mark.xy.length >= 2)` (`f-disclosure:21`).
- Matrix F2/area is pass.
- Fix: test an isolated point at spacing below 12 px for area and line, and assert the isolated point's coordinates.

**13. m — Duplicate title with a skipped twin passes.**
- Ran: two tests share a title, one passes and one is `it.skip`; the cell is pass (`check.mjs:277`). Several real citations are duplicate titles, for example the F12 browser "dirty fixture" registrations.
- Fix: require every reported instance of a title to pass.

**14. m — The spec ID reader misses IDs.**
- Where: `check.mjs:43-45`.
- Ran: a spec with `**F6**`, `` `F7` ``, a row ending in "| " (trailing space) and a "### 3.9" table with F13 produced no "missing criterion ID" error. Currently latent: all 96 IDs are present.
- Also, F3's "one test per code" is not checked structurally.
- Fix: trim each line, strip emphasis and code marks, and fail on an ID-like first cell in any unlisted 3.x/4/5 section.

**15. m — Diagnostics coverage gaps.**
- AX141 uses a host stand-in for the resolved backdrop, and its title ("reports a low-contrast resolved theme") does not say so.
- AX199 uses `__dev.fail`. Its title is honest, but the "delivered once" second frame is skipped for it (`dx-diagnostics:27`).
- The one-bad-value fixtures never assert the exact code set (the spec says "exactly"). Only the dirty fixture does.
- AX105 is untested on number and wall-clock axes, and at the boundary of ≤1,000 absent steps.
- AX106 is untested for an all-string column of non-decimals (`'1,234'`, `'n/a'`).
- The AX109-seconds and AX104-signed tests skip the once and effect checks.
- AX140 "in every build" is not checked in production.

**16. m — The generators are narrow.**
- None reach empty data, a single row, unsorted or duplicate input, values like 1e±300, floats, DST or year boundaries, or more than 8 series.
- F2 generates only `null` (no undefined, NaN or absent rows), with at least 3 rows.
- F7 keeps the data fixed at [−5, ≤40] with the reference always the maximum (30 distinct values over 1,000 runs).
- F1, F7 and first-tick use a fixed `seed: 4026`, so the same 1,000 cases run every time.
- Every property does request 1,000 runs.

**17. m — The compact column is mostly compact line.**
- `chart('compact', …)` defaults to line, so compact area and bar are not exercised by: F4, F6, F7, F9, F11-shuffled, DX2–DX8, A1, A10, L4, L7, I5.
- The matrix still marks F4/compact and F11/compact as pass. EVIDENCE.json does not record which compact kind a test ran.

**18. m — Specification readings that lower or bend the bar.**
- The mixed-sign tooltip total is the algebraic sum (4 for +9/−5), while F10 speaks of "both totals".
- The "clear majority" fixture is 2 of 4, and kinds that do parse are reported as AX107 "cannot be parsed".
- The donut eight-slice limit counts only drawn arcs, although F8 itself calls zero and null entries "slices". The matrix rates this weak.
- The AX143 filter in the F4 instants test (`f-time:67`) is now dead tolerance. I ran a probe and no AX143 appears; remove the filter.

**19. m — Weak assertions under strong titles.**
- L5: `markers.length < 300` passes with a marker on every other point. The implementation switches between 9.7 and 13.6 px spacing (probe ran); the test never straddles 12 px.
- I could not confirm the minimum's derivation for some readings, and many exact strings are implementation wording, not spec text: "Values shown differently from the data", "minimum 0, maximum 8, last 7", "Bad could not be drawn", "The chart could not be drawn."
- The F6 date oracle uses the same `Intl` options as `format/time.ts` (`f-format:88`), so it shares any choice the implementation makes.

**20. m — Questionable applicability calls in the matrix.**
- A3's "cannot be verified here" bundles a Chrome-testable focused accessibility-tree snapshot with the screen-reader rehearsal.
- I2/donut is not applicable, although F8 gives donut a legend and I2 is unconditional.
- A7/compact is not applicable, although "data arriving does not speak" applies to an appended sparkline and is trivially checkable.

**21. m — Running the checker modifies the repository.**
- `check.mjs:439` always rewrites the tracked `acceptance/report.md`, and the order of the `--results` arguments changes its content. A review run mutates the checkout.
- Fix: write the report only with `--write`, and sort the runs.

**22. m — REPORT.md is stale.**
- It still reports "18 failed | 476 passed" and the failure analyses. All 494 pass now, after implementation changes alone.
- EVIDENCE.json is no longer the matrix's source of truth.

---

### Areas examined closely and found sound
- **Test integrity:** no acceptance test was edited since 689102e. The earlier failures were fixed in `src`, not by weakening tests.
- **F2 gap and join rule:** joining across nulls everywhere was caught by 31 tests (ran). Null versus absent field versus absent date versus zero is asserted in geometry and in reader text for line, area and bar, full and compact.
- **F11:** exact vertex order, row provenance, and AX108 disabling only the affected series (reasoned from the assertions).
- **F10 opposite sides:** stacking negatives on the positive side was caught by 8 tests (ran).
- **F12 production build:** the esbuild bundle with `__DEV__=false` asserts the note and the summary; hints stay off the console.
- **Diagnostic delivery helper:** delivery exactly once across an extra frame, level, chart name, fix regex, printed once, and effect via `toPublic`. All 29 codes are reached through public options, except AX141 (stand-in) and AX199 (dev hook).
- **Process zone independence:** the suite passes unchanged under the LA and Kiritimati process zones.
- **Checker handling of renamed, skipped and stale-ID citations:** a renamed title is a structural error (seen live with `tests/dist`), and a skipped test stays "not run". A failure wins across reports, and a stale or missing criterion ID is an error.
- **Matrix judgement on the sampled cells I agree with:** F1 area/bar/compact, F2 line/bar/donut/scatter (apart from finding 4), F8 donut, F11 line/area/scatter, T-pointer-scatter, T-tooltip-scatter, T-zoom-bar, T-zoom-donut, T-limit-donut, T-reference-donut, C5, F7/*, L5/* and L3/* rated weak, A6 and I4 "cannot be verified here" (other engines and real phones). The cited titles exist, since the checker joined them against the results.

### Cells I judge not established by this suite despite passing tests
- F5/line and T-dense-line (both marked pass): findings 1 and 2.
- F5/area, F5/compact and T-dense-area (weak, but their gap texts misstate what is covered): finding 1.
- F4/line, F4/area, F4/bar, F4/scatter, F4/compact (pass): finding 3.
- F12/scatter (pass): finding 4.
- F2/area (pass): finding 12.
- F10/area, F10/bar, F10/compact (weak): finding 5.
- F7/line, area, bar, scatter, compact (weak): finding 6.
- F11/compact (pass): compact area order is untested (finding 17).
- F3/line through AX152 (weak): the viewer-zone fallback is untested (finding 3).
- L3 and L1 in the Node model: the Node tests are true by construction of the host (finding 11).

