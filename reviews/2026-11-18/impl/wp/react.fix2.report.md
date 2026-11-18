<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a5529f23e59e816c4, resumed. Saved by the coordinator from the hand-back. -->

## @axylo/react second fix pass (review part C): report

I fixed findings 1–5 of part C. Each new test failed first against the committed a63bbee adapter. Finding 6 is not pending: its new test already passes, because the core now names diagnostics after the element id. Everything in packages/react passes. The shipped production file is now **1940 B gzipped** (level 9; 4857 B before gzip). That leaves 108 B under the 2048 B budget, down from 1427 B. Nothing is committed.

### Last lines of the runs
- `npm run typecheck` (now `… && tsc -p packages/react && tsc -p tests/dist`): exit 0, no errors printed. `npx tsc -p packages/react`: clean.
- `npx vitest run packages/react`: `Test Files 3 passed (3)`, `Tests 41 passed (41)`, Duration 810ms.
- `AXYLO_BROWSER=1 npx vitest run packages/react`, run twice: `Test Files 1 passed (1)`, `Tests 39 passed (39)`, Duration 18.61s.
- **New browser tests against the committed a63bbee adapter** (src swapped back temporarily, then restored and checked with diff): `Tests 7 failed | 32 passed (39)`:
  - the three C2 tests;
  - the two C3 tests (`expected 'destroy failed' to be 'listener registration failed'`, and `expected 1 to be +0` for the boundary count);
  - C5 (`Error: unplotted column read`);
  - the hint wording.
- **New unit tests against the old patch.ts:** 5 failed. The cycle and own-index tests both got `expected true to be false`; `__proto__` was lost; `Error: getter` was thrown; `fieldsOf is not a function`.
- **Clean checkout:** I copied the committed packages/axylo (no dist) and the current packages/react, without dist, into a scratch workspace.
  - The committed dist.test.ts failed its setup there: `Command failed: npx tsc -p …/tsconfig.build.json`, `Tests 12 skipped (12)`.
  - With the fix: `Test Files 3 passed (3)`, `Tests 41 passed (41)`, and packages/axylo still has no dist afterwards.

### Per finding
**1. Distribution test needs the core build (B): fixed.**
- In `test/dist.test.ts`, setup uses `packages/axylo/dist/index.d.ts` when it exists.
- Otherwise it builds the core's declarations from source into a temporary directory with `tsc -p packages/axylo/tsconfig.build.json --outDir <tmp>`, leaving packages/axylo untouched. It then passes that directory to `build.mjs` and the consumer typecheck through `AXYLO_CORE_TYPES`.
- If that also fails, setup throws an error naming the missing file and saying to run `npm run build`. Nothing is skipped silently.
- `build.mjs` itself, run without the variable and without core dist, throws the same kind of message.
- At run time the SSR tests are given the core from source (`vi.mock('axylo', …)`), so they need no core JS build either.
- `AXYLO_REACT_PRIVATE_CORE_TYPES=1` forces the source path; I ran it: `12 passed`.

**Lockfile.** Exact edit: in `packages/react` → `peerDependencies`, delete the line `"react-dom": "^18.0.0 || ^19.0.0"` and the comma ending the `react` line before it. Offline command: `npm install --package-lock-only --offline --ignore-scripts`. I ran that command in a scratch copy of the manifests; your package-lock.json is untouched. Its diff was exactly:
- that removal;
- `"dev": true` added to `node_modules/react-dom` and `node_modules/scheduler`, since nothing outside dev uses them now.

**2. Saved ref exposes the chart while detached (M): fixed.**
- The ref's `chart` is now a stable facade, non-null only while attached. A layout effect sets attachment, so it drops when Suspense hides the chart and when deletion detaches it, before passive teardown.
- **Calls made through a kept handle while the chart is hidden, or during a commit before its props are applied, are queued.** A `useInsertionEffect` marks the second case. Queued calls are applied in call order right after the props. I chose queueing because rejecting a call while hidden would lose streamed rows, and applying it at once would apply it against old props.
- If the component unmounts with calls still queued, they are reported with `console.error` and not applied. Any call after unmount throws "… is unmounted".
- A queued strict call that throws goes to the error boundary, not to its caller.
- The chart survives a Suspense hide.
- The layout-or-passive choice is now made per instance at first render.
- Tests:
  - "while Suspense hides the chart a saved handle reads null; a call made then waits and applies after the revealing props"
  - "appended rows and the zoom survive a Suspense hide"
  - "in the commit that unmounts the chart, a saved handle reads null before passive teardown; calls are then reported, and rejected after"
  - "a call from an earlier sibling's layout effect in the same commit applies after this commit's props"
  - in `test/hooks.test.ts`: "is the layout effect when a document exists at first render, though it did not at import"

**3. Disposal error replaces the original (M): fixed.**
- `destroy()` failures are caught and reported with `console.error("[axylo/react] <Line>: destroy() threw.", error)`.
- **Production does the same as development: console.error, no rethrow.**
- On setup, the original error is rethrown. On passive teardown, nothing reaches a boundary.
- Tests: "when on() throws A and destroy() then throws B, the boundary receives A and B is reported" and "a destroy() that throws during unmount is reported and does not reach the boundary".

**4. Comparator and option copying (m): fixed.**
- A cycle is compared by identity once found, so two distinct cyclic graphs count as a change.
- Arrays compare own indices only.
- Options and patch records are built with `defineProperty`, so an own `__proto__` key reaches the core.
- Tests: "treats a cycle as opaque: a one-object cycle and a two-object cycle differ"; "counts only own array indices"; "keeps an own __proto__ key as an option and in the patch, so the core can report it".

**5. Hint sampler (m): fixed.**
- It samples only the fields the options name (new `fieldsOf`: x, y, series, label, value in every form).
- It is best effort: a sample that cannot be read means no hint, and the update still goes through.
- The hint now says "first and last values in the plotted fields". I updated my own wording assertion to match.
- Tests: "samples only the named fields, and an unreadable sample is "not the same", never a throw"; "names the fields the options plot…"; browser "a data replacement with an unreadable column the chart does not plot still reaches the core".
- **Observed:** React 19.3's development build deeply reads props in its own passive-phase logging (`logComponentRender`), so data with a throwing getter throws inside React itself. The browser test therefore arms the getter only during the charts' layout effects.

**6. Diagnostic name from the element id: test added, and it passes now.**
- Test: "a chart without a title, in a div with id="sessions", names its diagnostics "sessions"". It asserts that AX140 is present and that every diagnostic's `chart` is "sessions".

**Payload forms.** The adapter's tests use `'YYYY-MM-DD'` zoom domains on date axes and pass payloads through unchanged. The README has no hover or zoom example.

### Other changes and things not verified
- **Test helpers:** the spy now counts appends and can force a `destroy` failure. The app gained a watcher before the charts and a trailer after them, `raw(i)` for the core's own handle (the public facade carries no `__bench`), and `setColumns`.
- **README:** added two sentences on when `ref.current.chart` is null and what queued or rejected calls do.
- **Not verified:** React 18 (only 19.3.1 is installed) and Fast Refresh.
- **Memory:** queued calls are not bounded while Suspense keeps a streaming chart hidden.

Files (all in /home/canarit/projects/axylo/packages/react/):
- changed: `src/index.ts`, `src/patch.ts`, `build.mjs`, `README.md`, `test/dist.test.ts`, `test/patch.test.ts`, `test/browser/app.tsx`, `test/browser/spy-axylo.ts`, `test/browser/react.browser.test.ts`
- new: `test/hooks.test.ts`
