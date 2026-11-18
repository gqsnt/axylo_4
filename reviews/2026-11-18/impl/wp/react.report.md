<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a5529f23e59e816c4. Saved by the coordinator from the hand-back. -->

## @axylo/react: what was built and how it was checked

`@axylo/react` is built. It has five components, `Line`, `Area`, `Bar`, `Scatter` and `Donut`, each generic in the row type. All my tests pass, and `npx tsc -p packages/react` is clean. The root `npm run typecheck` fails, but only in `packages/axylo/src/core/controller.ts`, which another agent is editing (details below). Nothing was committed.

**Line to add to the root `typecheck` script:**
```
"typecheck": "tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p packages/react"
```

**Measured size** (esbuild minify, `react`, `react-dom`, `react/jsx-runtime` and `axylo` external, gzip level 9):
- Production (`__DEV__` false): 1931 B minified, **984 B gzipped**, against the 2048 B limit.
- Development: 1228 B gzipped.

### Files (all under `/home/canarit/projects/axylo/packages/react/`)
- **`src/index.ts`**: starts with `'use client'`. Each component uses `forwardRef` (works on React 18 and 19), renders one `<div>`, creates the chart in an effect and destroys it in the cleanup. A second effect computes the patch on every render and calls `chart.update(patch)` once, or not at all.
  - Event props and `onDiagnostic` go through a "latest props" ref with a stable forwarder, so a new handler never recreates the chart.
  - A strict failure is caught in the effect, kept in state and rethrown during render, so an error boundary sees it.
  - The `ref` exposes `{ chart }` through a getter: null before mount and after unmount.
  - In development it warns once when the same data arrives as a new object three renders in a row.
- **`src/patch.ts`**: the pure functions `optionsOf`, `diff`, `equal` and `looksSame`.
- **`test/patch.test.ts`**: present, changed, removed, structurally equal, data by identity and handler-only changes, plus a fast-check property.
- **`test/server.test.ts`**: renders each component with `react-dom/server` in Node with no DOM. Each gives `<div class="axylo"></div>` and no chart function is called (checked with a spy).
- **`test/size.test.ts`**: the gzip size check above.
- **`test/types.check.tsx`**: the four required `@ts-expect-error` cases, plus `onZoom` on `Donut`, a misspelling on `Bar` and a category x on `Scatter`. The same mistakes are also written as core calls, to show they fail in the same places. With the markers removed, each line fails for the intended reason.
- **`test/browser/`**:
  - `react.browser.test.ts`: the 16 browser tests.
  - `app.tsx`: the test app, driven through `window.app`.
  - `spy-axylo.ts`: wraps the core from source and counts creates, `update` calls and destroys.
  - `probe.ts`: counts ResizeObserver callbacks, observers still observing, listeners still registered, and pending animation frames.
  - `tree.ts`: the hydration tree, shared by Node and the browser.
  - `open.ts`: my wrapper. It pre-bundles the app with `process.env.NODE_ENV`, JSX and the `axylo` → spy redirect, then hands the result to the harness's `openEntry`. The harness itself is unchanged.
- **`tsconfig.json`**: now also includes `../axylo/src/core/globals.d.ts`, which declares `__DEV__` for the core source pulled in through `paths`.
- **`package.json`**: removed `react-dom` from `peerDependencies`, since the adapter only imports `react` and `axylo`.

### What I ran and saw
- `npx tsc -p packages/react`: no output (clean).
- `npx vitest run packages/react`: `Test Files 3 passed (3)`, `Tests 25 passed (25)`.
- `npm test` (full run): `Test Files 41 passed (41)`, `Tests 566 passed (566)`.
- `AXYLO_BROWSER=1 npx vitest run packages/react`: `Test Files 1 passed (1)`, `Tests 16 passed (16)`, `Duration 9.78s`. The 16 tests cover:
  - mount, update and unmount for each of the five components: the figure appears with its accessible name;
  - StrictMode: two creates and one destroy leave one figure; after unmount the container is empty and resizing fires no ResizeObserver callback, with no leaked observers, listeners or pending frames;
  - ten re-renders with inline field objects make zero `update` calls, and a real change sends exactly `['y']`;
  - a removed `title` sends `{title: undefined}` and gives the same name as a chart that never had a title;
  - a removed `tooltip={false}` brings the tooltip back;
  - the data warning fires once;
  - the latest `onHover` is called, with the same figure element and no update;
  - `append` takes the line from 10 to 11 points, and a new `data` prop brings it back to the original 10;
  - a strict chart rejected at creation and at update is caught by the boundary and recovers;
  - two charts in one tree stay independent;
  - hydration produces no console errors and no recoverable errors, plus a control showing that altered markup is reported.
- `npm run typecheck`: fails at `packages/axylo/src/core/controller.ts(862,99): error TS2322: Type 'string | boolean' is not assignable to type 'boolean'`. That file is not mine.
- **Mutation check**: I broke the adapter seven ways, one at a time, and restored it each time (confirmed with diff; a clean re-run followed). Six of the seven were caught by the browser tests:
  - identity comparison instead of structural;
  - no destroy in cleanup;
  - handlers bound at creation;
  - no rethrow;
  - removed keys dropped;
  - the data warning firing too early.
  The seventh, a forced hydration mismatch, was caught only by the Node-side markup assertion in the hydration test. The browser-side hydration check is backed by the control test instead.

### Not done or not verified
- **React 18 is not tested**: only React 19.3.1 is installed. Support is expected from the design (`forwardRef`, no React 19-only APIs), not observed.
- **No `dist` build exists for the adapter**, because `scripts/build.mjs` is not mine. A real build must define `__DEV__`, as the core's build does, and must keep the `'use client'` banner, since esbuild drops directives when bundling.
- `packages/react/test/browser/.out/axylo-react-app.js` (about 1.7 MB, generated by the tests) is not covered by `.gitignore`. Suggested line: `packages/react/test/browser/.out/`.
- No contract change is needed.

### Assumptions where the spec was ambiguous
- Every option except `data` is compared structurally, not only the listed ones. Functions inside options, such as `format: v => …`, are compared by identity, so an inline formatter does cause an update.
- `{a: undefined}` and `{}` count as different inside an object. At the top level, an absent prop and one explicitly set to `undefined` count as the same.
- `onDiagnostic` is sent only when it appears or disappears; replacing one function with another sends nothing.
- `Donut` has no `onZoom` prop, because `DonutOptions` has no `zoom`.
- The container always carries the class `axylo`, even on the server, so that React does not strip it when `className` changes.
- Recovering after an error means the boundary remounts the component: a throw during render discards the failed instance. The test boundary resets when its `data` prop changes.
- The data warning is a `console.warn`, printed once per page.
