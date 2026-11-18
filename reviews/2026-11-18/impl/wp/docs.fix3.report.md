<!-- Author: Claude Opus 5.5 (requested effort xhigh), Agent-tool subagent a04bfe28413f07034, resumed. Saved by the coordinator from the hand-back. -->

## Docs: React adapter removed from the site, framework section added (nothing committed)

The site now builds and tests without `@axylo/react`, and all four docs test runs pass. Library rebuilt with `npm run build` at 11:41 CET, on commit **618429e** (HEAD at the time). That commit already contains your adapter removal (bf93e1a); the deletion of `examples/first-chart/react.tsx` is in the working tree.

**Last lines of the four runs:**
| Configuration | Result | Started |
|---|---|---|
| Root config, unit (`npx vitest run apps/docs`) | Tests 218 passed (218) | 11:41:12 |
| Docs config, unit | Tests 218 passed (218) | 11:41:13 |
| Root config, browser (`AXYLO_BROWSER=1 npx vitest run apps/docs`) | Test Files 6 passed (6), Tests 160 passed (160), 94.25 s | 11:41:18 |
| Docs config, browser | Test Files 6 passed (6), Tests 160 passed (160), 93.80 s | 11:42:57 |

Counts went down from 223 unit and 167 browser because the React tests and the React examples' tests went with the adapter.

**Build:** 18 pages (16,242 words), 29 diagnostic pages, 46 runnable examples plus 2 Node examples.

### Removed
- The React page and its navigation entry.
- Five examples: `react-line.tsx`, `react-stream.tsx` and the three `recharts-*.tsx`.
- `.tsx` support from the docs build, `@axylo/react`, `react`, `react-dom` and their types from the packed consumer, and the React server-rendering test.
- From `options.test.ts`: the React prop groups, their probe imports and the "same extra props" test.
- From the pages:
  - Getting started: the React install line and the "In React" snippet.
  - Overview: the link to the React components.
  - Options: the "React components" section and its two tables.
  - Stability: `@axylo/react` from the promise. The "React 18 and 19" row became the spec's "Frameworks: None needed. No adapter ships in 1.0; the library is called from any framework's mount and unmount hooks." The "not in 1.0" row now names framework adapters (React, Vue, Svelte, Angular) and a custom element.

### Added
- **"Using Axylo in a framework", on Getting started:** I put it there because that is where a reader looks first. It says what you asked for and nothing more:
  - no adapter ships in 1.0; adapters for React, Vue, Svelte and others are planned after 1.0;
  - create the chart when its element exists, `update()` on change, `destroy()` when the element goes away;
  - creating, destroying and creating again on the same element is supported, as a framework's development mode does.
- **`examples/lifecycle.ts`:** plain TypeScript with `mount(element, data)`, `refresh(data)` and `unmount()`. It drives mount, unmount, mount on one element, then a refresh. Its test checks that the element ends with exactly one chart showing the refreshed week ("Mar 9, 2026 … sessions 3,400, Point 1 of 7").
- **Links to that section** from the Updating page's `destroy` section and from the overview.

### Migrating from Recharts
The page still earns its place: the quoted Recharts configurations and the concept table are what a Recharts user needs. I kept it minimal:
- One opening sentence: from a React component, create the chart in an effect, destroy it in the cleanup, and call `update()` on data changes, with a link to the lifecycle example.
- Its Axylo side now uses the same three plain-TypeScript examples as the Chart.js page (`migrate-trend`, `migrate-target`, `migrate-stream`), which are already tested.
- The concept table maps Recharts components to plain calls and options. One new row, "mount and unmount", is marked "not checked here: no React code runs on this site".

### Root `devDependencies`
Nothing in `apps/docs` needs `react`, `react-dom`, `@types/react` or `@types/react-dom` any more. No source, test or build step imports them, and the docs consumer installs only the packed `axylo` tarball, offline. The Recharts code the page quotes is only read as text from `research/harness`, which has its own `node_modules`. They can go from the root as far as the docs are concerned.

