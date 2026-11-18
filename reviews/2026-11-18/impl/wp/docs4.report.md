<!-- Author: Claude Opus 5.5, agent a04bfe28413f07034; saved by the coordinator -->

## Docs pass after the closing fixes: report

The AX160 page now shows both cases, the five write-ups are in, and the conformance page picks up the new citations. The default build's revision guard refuses again: other authors have uncommitted edits in `packages/axylo/src/dom/**`, `core/focus.ts` and `theme/css.ts`. So I checked everything with `--unchecked-library`, and the docs browser suite waits for your next rebuild. Nothing is committed and the library was not rebuilt. My scratch probe is removed.

### What changed (10 files under `apps/docs/`)

**AX160** (`data/diagnostics.mjs`)
- The minimal input is now a value `format` that throws: the reader sees the note "Values shown differently from the data: 1. See table."
- A new case, "A tick format that throws", shows the diagnostic, default tick labels and no note (`reader: 'nothing'`).
- `drawn` and `see` follow the spec's AX160 row.
- The browser test runs both inputs, normal and strict, as it does every other case. It checks the field, the note and that the printed line equals the page's line.

**1. Known limits** (`stability.md`, new section "Known limits")
- Nine plain sentences: closed shadow roots, a dense ring of scatter points, a formatter that fails only sometimes, CSS aimed at the plot's own column, a hold that starts early, one language for the focused point, patterns in compact bar charts, very small numbers, and the end labels of a scatter chart's x axis.
- For "very small numbers" I wrote only what you see (ticks can be missing or not match their labels), not a cause, since I could not confirm one.

**2. Tooltip text** (`accessibility.md`, new "Long text" paragraph under "Reading values with a pointer")
- A value that fits stays on one line; a longer one wraps within the visible plot.
- The heading and at least one row are always shown, cut if they must be. The only exception, from the code (`tooltip.ts`), is when every place would cover a control or the focus ring.
- In the strip, entries wrap within its two lines; if even one does not fit, the x and one row are cut to one line with an ellipsis. "+N more" is shown whole or the strip is not shown.

**3. Zoom** (`updating.md`, `scatter.md`)
- On a scatter chart the full range is the x axis as drawn. In a narrow plot it can be wider than the data, and Zoom out and Reset zoom return to it.

**4. Conformance**
- `lib/conformance.mjs` now takes citations only from a row's last column, as A9 now says. My earlier version read every cell. The generator now finds 26 criteria: the 10 from before plus sixteen new ones by my count (1.1.1, 1.3.1, 1.3.4, 1.4.3, 1.4.13, 2.1.1, 2.1.2, 2.1.4, 2.4.3, 2.4.6, 2.4.7, 2.4.11, 2.5.3, 3.3.2, 4.1.2, 4.1.3), not fifteen.
- `data/wcag.mjs` gives each of the 29 uncited criteria a kind and a short why:
  - **Not applicable to a chart component (13):** audio and video, input purpose, links, motion, time limits, no submissions, multi-step processes or sign-in.
  - **The page's responsibility (7):** 2.4.1, 2.4.2, 2.4.5, 3.1.1, 3.2.3, 3.2.4, 3.2.6.
  - **Not assessed (9):** 1.3.2, 1.3.3, 1.4.5, 2.3.1, 2.5.2, 3.2.1, 3.2.2, 3.3.1, 3.3.3. These can apply to a chart and no test is cited, so the reasons claim no behaviour.
- The page shows them as a table. The build fails, and a new unit test fails, if an uncited criterion has no reason.
- `conformance.md`'s intro names the new part. The checker still refuses its matrix, so every result still reads "not recorded".

**5. Sizes**
- Your text on `stability.md` reads well.
- The generated table now prints two decimals. It shows everything at 116.00 KiB against 116 (Met) and line only at 97.02 KiB against 98 (Met). That measurement's integrity matches the tarball this build installed.

**Also**
- Spec A9 now names two reasons for an uncited criterion; I added "not assessed" as a third, where I could not judge. Say if you want only the two A9 kinds.

### What I ran and saw (19:45 CET, HEAD e86e54f, shared build from d33df71)

- **`node apps/docs/build.mjs`** refuses:
  ```
  the installed axylo.css differs from the minified packages/axylo/src/theme/css.ts
  the installed axylo.dev.js differs from what packages/axylo/src builds to now
  ```
  `apps/docs/dist` was not replaced.
- **`node apps/docs/build.mjs --unchecked-library`**:
  ```
  built 18 pages (18614 words), 29 diagnostic pages and 46 examples in 519 ms, into …/apps/docs/.cache/unchecked-site
  NOT FOR PUBLISHING: built against a packed library that is not the build of its source (2 differences).
  ```
  The link and anchor check passed.
- **`npx vitest run --config apps/docs/vitest.config.ts`**: `Test Files 5 passed (5)`, `Tests 241 passed (241)`.
- **Probe (removed afterwards):** I ran AX160's two inputs in Chrome against the unchecked site, which runs your shared d33df71 build:
  - Value format: note "Values shown differently from the data: 1. See table.", AX160 on `sessions`, printed line equals the page's.
  - Tick format: no note, AX160 on `sessions`, printed line equals the page's.

  This was not the test suite.

### What waits on your rebuild

The whole docs browser suite: `AXYLO_BROWSER=1 npx vitest run --config apps/docs/vitest.config.ts`, 171 tests now with the new AX160 case. Every file calls the default `buildSite()`, which refuses until `dist` is the build of the source. That includes the AX160 test you saw fail, and axe and overflow checks of the changed pages (`stability`, `accessibility`, `conformance` with its new table). After the suite passes, run `node apps/docs/build.mjs` to replace `apps/docs/dist`.

