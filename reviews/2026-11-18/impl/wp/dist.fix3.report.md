<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a6f0d7846bf125638, resumed. Saved by the coordinator from the hand-back. -->

## React adapter removed from the distribution suite

The distribution suite no longer packs, installs, type-checks, bundles, renders or measures `@axylo/react`, and it has a new framework-free lifecycle test for the DX8 create–destroy–create sentence. Both distribution configurations and `npx tsc -p tests/dist` pass. A case-insensitive search for "react" across `tests/dist` (generated `node_modules`, `.out` and `.packed` excluded), `examples`, `scripts/pack.mjs`, `scripts/size.mjs`, `THIRD-PARTY-NOTICES.md` and the `packages/axylo` metadata finds nothing. Nothing is committed.

**Final runs:** HEAD `618429e`, where `packages/react` is already gone. I rebuilt and repacked with `node scripts/pack.mjs` at about 11:44 CET, then ran:
- **Node:** `Test Files 10 passed (10)` / `Tests 83 passed (83)`
- **Browser:** `Test Files 5 passed (5)` / `Tests 26 passed (26)` / `Duration 38.99s`
- **`npx tsc -p tests/dist`:** exit 0

### What I removed
- **Deleted files:** `tests/dist/fixtures/react/**` (consumer, StrictMode, hydrate, memo and server-rendering entries, tsconfigs, package.json), `examples/first-chart/react.tsx` and `tests/dist/pages/spy-axylo.ts`.
- **`scripts/pack.mjs`:**
  - `PACKAGES` and `FIXTURES` now hold only `axylo` and the npm and script fixtures, so the manifest has one package.
  - The fixtures now depend on nothing but the tarball, so I removed the `--prefer-offline` fallback; the install is plain `--offline` and never asks a registry.
- **`scripts/size.mjs`:** the React row, its manifest fields and the 2 KiB target are gone.
- **Tests narrowed to the core package:** `conditions`, `flavours` (the memoize-hint rows), `types` (React fixture rows), `isolation`, `licence` (no peers allowed now), `package-contents`, `side-effects` and `snippets`.
- **Tests dropped outright:** server rendering in `node.test.ts`; the StrictMode, hydration and React untitled tests in `first-chart.browser.test.ts`.
- **Undeclared-import probe:** `isolation.test.ts` now uses `fast-check` for both fixtures instead of `@axylo/react`, so it no longer relies on a package that is going away.
- **`browser.ts`:** bundles no longer set JSX or `process.env.NODE_ENV`, and the server no longer serves the React fixture.
- **`THIRD-PARTY-NOTICES.md`:** one package and a 10-file inventory; the adapter's rows and wording are gone.
- **`tests/dist/README.md`:** updated, including DX1 "by npm and by script tag" and a row for the new test.
- **`packages/axylo/README.md`:** I removed one line, "For React, see `@axylo/react`", because it pointed at a package that no longer exists. You had said the READMEs stay as written, so revert that line if the owner wants it kept.

### New DX8 test: `lifecycle.browser.test.ts`
It runs the same steps in two routes: a bundled module with the production condition, and the `axylo.iife.min.js` script tag. No framework is involved.
- **Instrumentation:** `pages/instrument.js` loads before the library. It wraps the browser's calls for adding listeners, the three observer types, and animation frames, so the test can see what is still live.
- **Steps:**
  1. On one element: create, wait two frames, destroy, then create again.
  2. Between the destroy and the second create, the element is exactly the markup the page wrote.
  3. One figure exists afterwards.
  4. On the destroyed handle, `update`, `append` and `zoom` change nothing (still one figure, title unchanged).
  5. Pointer events reach the live chart's listener and none reach the destroyed one's.
  6. The instruments do see the live chart's registrations: 28 listeners and 4 observers.
  7. After the final destroy, the element is exactly as written, with no listeners left on the window, the document, media queries or connected nodes. No observer is still observing and no frame is pending.
  8. After a viewport resize, a `resize` event and pointer moves, no frame has been requested and no event has been delivered.
- **Limit:** listeners registered with `once` are not tracked, because the page cannot tell when they remove themselves.

### Size table (packed file, esbuild minify, production condition, gzip level 9)
| entry | min B | js gzip B | css file gzip B | total KiB | target KiB | status |
|---|---|---|---|---|---|---|
| line only (`npm.ts`) | 255,120 | 89,605 | — | 87.50 | 80 | over |
| everything | 303,856 | 106,738 | — | 104.24 | 96 | over |
| area only | 260,476 | 91,514 | — | 89.37 | — | no target |
| bar only | 256,092 | 89,997 | — | 87.89 | — | no target |
| scatter only | 238,968 | 83,830 | — | 81.87 | — | no target |
| donut only | 221,734 | 77,125 | — | 75.32 | — | no target |
| validate only | 58,215 | 20,887 | — | 20.40 | — | no target |
| script tag (IIFE min + css) | 304,394 | 106,833 | 2,886 | 107.15 | — | no target |

The per-module breakdown's source rebuild is identical in size to the packed `axylo.js` (303,903 B). `--check` would still fail on the two targets; it stays off in CI.

### Root devDependencies
Nothing of mine needs `react`, `react-dom`, `@types/react` or `@types/react-dom` any more:
- no fixture declares them;
- `tests/dist/tsconfig.json` uses only `@types/node`;
- the undeclared-import probe uses `fast-check`.

You can remove them as far as the distribution suite is concerned.

### Not verified
Browsers other than Chrome, bundlers other than esbuild, Windows and macOS, and the fixture installs on a CI runner.

