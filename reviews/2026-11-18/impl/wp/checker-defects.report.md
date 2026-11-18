<!-- Author: Claude Opus 5.5 (high), agent a61d95e46b3f0f3aa; saved by the coordinator -->

## Checker defects in `acceptance/`: report (nothing committed)

All six items are done, and the checker's tests pass: `ℹ tests 38`, `ℹ pass 38`, `ℹ fail 0`. Each defect has a new test. Run against HEAD's checker, 7 of them fail, plus one existing test whose expected counts now carry the new status.

One thing needs the matrix author now: **the checker refuses the current `acceptance/matrix.json`**. DX10 cites `apps/docs/test/node.browser.test.ts` as `unit` 18 times, which the new kind check rejects. Those citations must become `browser`.

I did not touch `matrix.json`, `report.md`, `packages/**`, `tests/dist/**` or `apps/docs/**`. Scratch was `.scratch-checker/` and is removed.

### Per defect: the test that fails before the fix, and the change

**Defect 5, size provenance.** Test: "defect 5: a size record counts only for the pack this tree makes, against the targets of scripts/size.mjs".
- A size record now counts only when its `packed.axylo` integrity equals the tarball this tree packs. That integrity comes from a new `packIntegrity()` in `provenance.mjs`: `npm pack --dry-run --json --ignore-scripts` over `scripts/pack.mjs`'s `PACKAGES`, the same flags `pack()` uses.
- I checked the dry run against a real pack: its integrity equals `tests/dist/.packed/manifest.json` and the current `bench/size-latest.json`.
- A record for another pack makes the cell `not recorded for this revision` (report `size.json not recorded`), never pass. The report's size section says which pack the record measured.
- **One source for targets:** `scripts/size.mjs` now exports `SIZE_TARGETS` (98 and 116 KiB), uses it itself, and the checker reads only that. The record's own `targetKiB` is ignored. A second test checks that these values match the DX7 row.
- `scripts/size.mjs` now also writes `packed.commit` and `packed.dirty` into the record.
- `check()` takes `packIntegrity` and `sizeTargets` options so tests can supply them. By default it runs `npm pack` (about 1 s), and only when the matrix cites size evidence.

**Defect 8, results with a provenance error.** Test: "defect 8: a run whose provenance is another tree answers nothing, in every mode…".
- Provenance is now judged in every mode. In a release, a run with no sidecar is also refused.
- Such a run sets no pass and no fail. Its cells read `not recorded for this revision`, with the report entry `<file> not recorded` and a reason naming the error.
- The list of runs still shows the run with its error, and the report has a new "Not recorded for this revision" section.
- The new status sits between `not run` and `cannot be verified here`. It cannot be waived.

**Defect 1, unexpandable `it.each`.** Two tests: "defect 1: atLeast cites a suite…" and "defect 1: it.each over a const list declared in the file expands to its titles".
- New citation form, `atLeast` (below).
- `it.each(name)` over a `const` list declared in the file, or imported by name, now expands as `for…of` loops do. F9's `scene.test.ts` cases now scan as six titles: line, area and bar, each with `compact: false` and `true`. F9 can therefore cite them by ordinary prefix or title.

**Defect 4, titles that never run.** Test: "defect 4: a title registered under a condition, or matched only by a template, needs a run that shows it".
- The scanner now marks a registration as `conditional` when it sits inside `if`/`else`, or after `&&`, `||`, `?` or `:`.
- A title citation needs a run that shows it when it is reached only through a `registration` template, or when every registration found for it is conditional. A supplied result of the file, or the `EVIDENCE.json` beside the test file, can show it.
- If a result or `EVIDENCE.json` covers the file but lacks the title, that is a structural error: "title never ran in <file> (<why>)".
- If neither covers the file, the report gets a "Warnings" section with "title not confirmed by any run".

**Defect 6, kind against the file.** Test: "defect 6: a browser citation must name a browser test file, and a Node citation must not".
- `browser` requires a `*.browser.test.*` file; `unit` and `property` must not name one. Both are structural errors.

**Defects 2 and 3, `describe.each`.** Test: "defects 2 and 3: describe.each suites get the ancestors a run gives them". Both fixes were small, so I made them.
- Computed rows: the suite has an unknown title, `null`, which matches exactly one runtime suite name. A title-only citation now passes. The runtime-ancestors workaround is no longer needed, but still works.
- Literal rows: each test now belongs to one row's suite at a time, not to all rows' suites at once.

**Defects 7 and 9: not done; what I would do.**
- **7:** for each AX code in F3, require the cited test's own callback body to contain that code as a string literal, found by the source scanner. A title alone would no longer satisfy the rule.
- **9:** add a `compactKind` field (line, area or bar) to the compact entries in the browser suite's `EVIDENCE.json`. The checker would then refuse a compact citation that relies on a compact kind those entries do not cover.

### The citation form for item 3 (for the matrix's author)
```json
{ "kind": "unit" | "browser", "file": "<test file>", "prefix": "<describe title, or its beginning>", "atLeast": <N> }
```
- It passes when all of these hold:
  - every reported test under the prefix passed (for `browser`, on the citation's engine) and none was skipped;
  - the titles the scan does know under the prefix are among the passes;
  - at least N distinct tests under the prefix passed. The count includes the known titles.
- Any failure under the prefix makes it fail.
- It is refused when combined with `casePrefix` or `cases`, and when every case under the prefix is already known to the scan.
- **DX10:** `{ "kind": "browser", "file": "apps/docs/test/examples.browser.test.ts", "prefix": "examples render in Chrome from the packed packages", "atLeast": 46 }`. The 46 is the number of examples in the last docs build; the matrix's author should confirm it.
- **F9:** no `atLeast` is needed now. Cite `scene.test.ts` normally.

### What changes for the docs consumer (`apps/docs/lib/conformance.mjs`)
- `STATUSES` has a new entry, `'not recorded for this revision'`, after `'not run'`. A cell can now have that status in any mode.
- A report's `results` can contain `'not recorded'`. Such a report always has a non-null `provenanceError`: either the run's error, or, for `source: 'size'`, "the size record measured another pack (<integrity>)".
- `cells[type].reasons` now also carries "<file>: not recorded for this revision (<error>)" and "<file>: the size record measured another pack …".
- `check()` returns a new `warnings: string[]`.
- `check()` now spawns `npm pack --dry-run` when the matrix has size citations.
- New structural errors (the checker throws): kind does not fit the file, "title never ran", `atLeast` misused, "missing size row", "no size target".

### Cells that change status in the current matrix (read-only snapshot, 20:45)
To get results at all, I corrected the 18 DX10 `unit` citations to `browser` in my snapshot only.
- **Static (no results):** no cell changes. 6 warnings appear: L2/compact twice (`palette.test.ts`, template-only), DX1/line twice (`first-chart`) and DX4/line twice (`flavours`).
- **With `acceptance/results/{unit,browser,dist,dist-browser}.json` and their sidecars:** 73 cells change, all because of defect 8. These results were recorded at 08:34–08:44 on an older tree, so their provenance does not match. As a result:
  - every pass and fail from them becomes `not recorded for this revision`, or `weak` where the cell is weak;
  - counts went from 39 pass / 23 fail to 0 / 0, with 51 `not recorded for this revision` and 44 `not run`;
  - P7/line goes from fail to not run, because its `pending` now takes precedence once the stale failure no longer counts.
- **Same results without their sidecars, outside release mode:** no cell changes. So the other fixes change no status in this matrix.
- **Size cells (DX7, P6):** still `pending`. Their record does match the current pack, so they could pass once `pending` is removed.

### Last lines of the checker's tests
`node --test acceptance/test/*.test.mjs`: `ℹ tests 38`, `ℹ suites 0`, `ℹ pass 38`, `ℹ fail 0`, `ℹ duration_ms 455`.

**Files changed:**
- `acceptance/check.mjs`, `acceptance/titles.mjs`, `acceptance/provenance.mjs`, `acceptance/README.md` (new status row, new citation rules), `acceptance/test/check.test.mjs`
- new fixture `acceptance/test/fixtures/chart.browser.test.ts`
- `scripts/size.mjs`

`acceptance/run.mjs` needed no change.
