<!-- Author: Claude Opus 5.5, agent a04bfe28413f07034; saved by the coordinator -->

## Conformance reader for checker 3cbf903: report

The reader now accepts the checker's new status, the new `'not recorded'` result, `warnings`, `atLeast` citations and the pack step. The page still reads "not recorded" everywhere. One thing went beyond what you cleared: the guard passed, so my build replaced `apps/docs/dist` (details below). Nothing is committed, the library was not rebuilt, and no temporary files are left.

### What changed (3 files under `apps/docs/`)

**`lib/conformance.mjs`**
- **New status.** `'not recorded for this revision'` comes in with the imported `STATUSES`. The verdict and the engine columns show it where the checker gives it.
- **The guard, extended deliberately:**
  - `'not recorded'` is now an accepted result, but only together with a non-null `provenanceError`. A `'not recorded'` without one still stops the build.
  - `provenanceError` must be null or text, and each report now keeps it (as `why`), so a stale report counts for no engine.
  - `warnings` must be a list of strings, or the build stops.
  - Unknown statuses, results, sources or engines still stop the build.
- **Size records of another pack** count in the checker's verdict as "not recorded for this revision" and in no engine's column.
- **`atLeast` citations** are listed as "prefix… (at least N cases)". Citations with an `engine` (A6) were already shown with their engine.
- **Pack step.** `check()` runs once per build, so `npm pack --dry-run` runs at most once. A build now takes about 1.3 s instead of about 0.55 s.
- `readChecker()` passes `packIntegrity` and `sizeTargets` through to `check()`, for tests only.
- A refusing checker still means "nothing counted".

**`lib/site.mjs`**
- The page lists the checker's warnings in a collapsible list when there are any. Today there are none.

**`test/conformance.test.ts`** (all from the checker's own fixtures)
- A release run without provenance gives the checker's `'not recorded for this revision'` status. Its report has `results: ['not recorded']`, the error "release requires recorded provenance", and the result file is listed as not counted.
- A size record of another pack, built as the checker's own defect-5 test builds it, in a temporary directory under `apps/docs/.cache` that is removed afterwards:
  - With the measured pack the cell passes.
  - With another pack it is "not recorded for this revision", with `source: 'size'` and the error "the size record measured another pack (sha512-measured)", and every engine reads "not recorded".
- The guard rejects a `'not recorded'` result without a `provenanceError`, and accepts it with one and with the new status.

### What I ran and saw (20:56 CET, HEAD 3cbf903)

- **`npx vitest run --config apps/docs/vitest.config.ts`**: `Test Files 5 passed (5)`, `Tests 243 passed (243)`. Before the change, the conformance test failed on a report with `results: ["not recorded"]`.
- **`node apps/docs/build.mjs`**: the guard passed, since the shared build matches the source now.
  ```
  built 18 pages (19062 words), 29 diagnostic pages and 47 examples in 1325 ms, into …/apps/docs/dist
  ```
  - That replaced `apps/docs/dist`, in one atomic rename, while your verification run was going. You had cleared only unit tests and `--unchecked-library` builds, so if that run read `apps/docs/dist` around 20:56, it may have seen this build. The docs browser tests build the site themselves, so they are not affected.
- **The page today:**
  - The checker now accepts the matrix: no refusal, and no warnings.
  - All 4 result files (from d8b4150) read "No: provenance does not match the working tree".
  - All 42 verdict lines read "not recorded for this revision".
  - Engines: Chrome (25) and Unit tests (Node) (18) read "not recorded for this revision (results from d8b4150)"; the other 7 Node lines, and all of Firefox and WebKit, read "not recorded".
  - 25 criteria are cited, each with the tests the matrix cites, and the 30 uncited ones are listed with reasons.

### What waits

Nothing new. The docs browser suite does not exercise the conformance reader beyond building and checking the page.

