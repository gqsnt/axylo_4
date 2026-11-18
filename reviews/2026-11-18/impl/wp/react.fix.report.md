<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a5529f23e59e816c4, resumed for the fix pass. Saved by the coordinator from the hand-back. -->

## @axylo/react fix pass: report

I fixed all 14 findings. For findings 1–8 and 10–14 I wrote a test first, saw it fail against the be123ee adapter for the reviewer's reason, then fixed the code. Finding 9 has a test but no one-line fix. All tests in packages/react now pass. The adapter now ships from a build: the production `dist/index.js` is **1427 B gzipped** (gzip level 9; 3377 B before gzip). Nothing is committed.

**Command for the root build script**, after the core build because declarations need `packages/axylo/dist/index.d.ts`:
```
node packages/react/build.mjs
```
The root `typecheck` script already ends with `&& tsc -p packages/react`, and it passes. `tsc -p packages/react` works without dist.

### Runs I made

**Before the fix:**
- New `patch.test.ts` cases against the old patch.ts: `Tests 8 failed | 14 passed (22)`.
  - Errors seen: `{ title: undefined }` expected but got null; `RangeError: Maximum call stack size exceeded`; `Array(1)` to `['v']` gave a null patch; inherited props copied (`[ 'data', 'inherited' ]`); host props reached options.
- New browser tests against the be123ee adapter: `Tests 13 failed | 18 passed (31)`.
  - Errors seen: `expected 10 to be 11` (append erased); `Set{ 'diagnostic:A' }` instead of `'diagnostic:B'`; `[ 'zoom:A' ]` instead of `'zoom:B'`; `expected 5 to be 2` (repeated traversal); container attributes missing; `[0,0,0,1,1,1]` instead of `[0,0,0,2,2,2]` (hint per instance); `caught.length 0` instead of 1; `destroys [0]` instead of `[1]`.

**After the fix:**
- `npx tsc -p packages/react`: clean. It is also clean with dist removed.
- `npm run typecheck`: passes.
- `npx vitest run packages/react`: `Test Files 2 passed (2)`, `Tests 34 passed (34)`, Duration 1.15s.
- `AXYLO_BROWSER=1 npx vitest run packages/react`, run twice: `Test Files 1 passed (1)`, `Tests 31 passed (31)`, Duration 16.76s.
- Full `npm test`: `Tests 7 failed | 620 passed (627)`. All 7 are outside my package: six in `packages/axylo/test/theme/palette.test.ts` and one timing test in `packages/axylo/test/data/normalize.test.ts`.
- **Finding 8 mutation:** with the production file built using `minify: true`, "keeps only the line chart (conditions: default)" fails. Restored afterwards, and the file passes again.

### Per finding

1. **No dist (B): fixed.**
   - New `packages/react/build.mjs` and `tsconfig.build.json` produce:
     - `dist/index.js`: production, `__DEV__` false, so the hint is removed.
     - `dist/index.dev.js`: development, with the hint.
     - `dist/index.d.ts`.
   - This follows the core's convention: the files are chosen through a `development` export condition, not `NODE_ENV`. package.json exports are now `types`, `development` and `default`.
   - Both files start with exactly one `'use client';` and contain no `__DEV__`.
   - Tests in `test/dist.test.ts`, which builds first: "starts with the 'use client' directive and has no bare __DEV__" (both files); "the production file drops the development hint…"; "the production file is at most 2 KiB gzipped"; "the declarations are what a consumer type-checks against" (runs tsc on `test/consumer/consumer.tsx`, which imports `@axylo/react`; it fails when dist is absent); and SSR through `@axylo/react` and `dist/index.js`.
   - I deleted the old `server.test.ts` and `size.test.ts`, which tested src.
2. **Ref before create / call order (M): fixed.**
   - Create, patch and handler publication now run in `useLayoutEffect` on the client. They are declared before `useImperativeHandle`, so they run before it.
   - On the server `useEffect` is used, so React 18 gives no SSR warning (not verified: React 18 is not installed).
   - Destroy runs in a passive cleanup, so a Suspense hide keeps the chart.
   - Tests: "on mount, a callback ref and the parent layout effect see a created chart"; "a parent layout effect that appends after a data change appends to the new data"; "diagnostics read in a parent layout effect describe the props of that commit"; "after a Suspense fallback, the revealed chart is the same one and matches the revealing commit".
3. **Stale handler during commit (M): fixed.** `latest` is written in the layout effect.
   - Tests: "onDiagnostic replaced, removed and reinstated takes effect within the commit" and "onZoom replaced, removed and reinstated…". Both fire through the ref from the parent's layout effect.
   - Also "an abandoned transition applies nothing…", a guard against writes during render.
4. **Explicit undefined (M): fixed.** Presence now counts, and the patch carries an own `title: undefined`.
   - I corrected the wrong-requirement test into "sends the transition between an absent prop and an explicit undefined, as an own key".
   - Browser test: "title={undefined} after a title set through the ref restores the generated name".
5. **Comparator overflow (M): fixed.**
   - Comparison now tracks the pairs it has already visited.
   - React elements (`$$typeof`), class instances and anything not plain are compared by identity.
   - `equal` catches internally, so a throwing getter means "unequal".
   - Test: "never throws, and treats values it does not understand by identity". It covers cyclic field specs, mutually recursive objects, a throwing getter and cyclic React elements.
6. **Sparse arrays (M): fixed.** Index presence is compared, and the comparison is symmetric. Test: "sees a hole filled or opened in an option array, in both directions".
   - The property test now uses an oracle independent of `equal`, which tells holes, undefined and absence apart and checks symmetry.
7. **Host attributes (M): fixed as you decided.**
   - `id`, `className`, `style` and `data-*` go to the div on server and client and never reach the options.
   - `aria-*` reaches core validation; the reason is in a comment in `patch.ts`.
   - Types: `ContainerProps` with `id` and `` `data-${string}` ``.
   - Tests: the optionsOf unit test; dist SSR "id, className, style and data-* render on the container…"; browser "id, className, style and data-* reach the container, never the chart; aria-* is reported as an unknown option" (a strict chart with `data-testid` is not rejected, and `aria-label` produces AX150).
8. **Tree-shaking (M): fixed.** The five definitions carry `/* @__PURE__ */`.
   - esbuild's whitespace minification drops those marks. So the production file minifies identifiers and syntax only, which is why it is 1427 B rather than 1203 B.
   - Test: "keeps only the line chart", for the default and `development` conditions. It bundles a consumer that imports only `Line`, with marker stand-ins for the core.
9. **Repeated traversal (m): fixed.** `applied` now advances on a no-op too. Test: "an equal replacement object is compared once, not on every later render", using a proxy that counts key reads.
   - I did not limit how deep structural comparison goes for any option. Options are assumed immutable, and a comment in `diff` says so.
10. **Enumeration (m): fixed.** Comparison uses own keys including non-enumerable ones (`Reflect.ownKeys`), `optionsOf` copies own props only, and patch lookups check own keys. Tests: "compares own properties, enumerable or not, and never reads inherited ones" and "copies own props only".
11. **Hint (m): fixed.** It is now per chart instance and worded as a sample ("same length and the same first and last rows (only those are compared)").
    - Endpoint dates are compared by time, and typed columns by length and endpoints.
    - Tests: the looksSame unit test, and browser "the memoization hint: once per chart, on the third endpoint-equal replacement, worded as a sample". That test asserts after each replacement, with a middle row changing.
12. **Error path (m): fixed.**
    - **Observed on React 19.3.1:** a throw from the layout effect reaches the boundary as the original object (`caught === spy.errors` holds, by identity), on create and on update. So I removed the state-and-rethrow path.
    - Test: "a strict rejection reaches the boundary even when the parent removes the chart right after the commit". The old code lost the error there.
13. **Setup failure (m): fixed.** The chart is destroyed before the error from `on` propagates. Test: "a setup failure after the chart exists destroys it before the error propagates".
14. **Teardown test strength (m): fixed.**
    - The spy now counts destroys, holds charts and elements through `WeakRef`, and calls `update` and `destroy` with the handle as `this`.
    - The probe now tracks `once` listeners too.
    - New tests: "unmounting before the first frame cancels it: nothing is drawn after destroy, destroy runs once"; "a key change destroys the old chart once and creates a new one"; a saved handle reads `null` after unmount; hydration checks that the server-rendered div is reused.
    - Also added "the latest onSelect is called on click".

### For you to decide or relay
- **Core (not mine):** after destroy, the core leaves listeners on its own removed elements (keyboard proxy `input`, toolbar, legend and control buttons). They cannot fire. The StrictMode test lists them and asserts that every such element is one of the core's `axylo-*` elements, none of them React's container. Strict cleanliness would need a change in `src/dom`.
- **Core behaviour (not mine):** a click right after hovering lands on the floating tooltip, so no `select` fires. The select test uses `tooltip: false` for that reason.
- **Trade-off:** the Suspense decision means the chart survives being hidden. An Activity or Offscreen hide, which disconnects passive effects, destroys it, and the reveal creates a new chart from the latest props.
- **Not verified:** React 18 (only 19.3.1 is installed) and Fast Refresh.
- `package-lock.json` still lists the `react-dom` peer. That file is not mine.
- `packages/react/test/browser/.out/` (the generated test bundle) is still not covered by `.gitignore`; dist is covered by the existing `dist/` rule.

All files are in /home/canarit/projects/axylo/packages/react/:
- new: `build.mjs`, `tsconfig.build.json`, `test/dist.test.ts`, `test/consumer/consumer.tsx`, `test/consumer/tsconfig.json`
- changed: `src/index.ts`, `src/patch.ts`, `package.json`, `tsconfig.json` (excludes `test/consumer`), `test/patch.test.ts`, `test/types.check.tsx` (each negative case now has a valid twin; wide `y` uses `as const`), `test/browser/app.tsx`, `test/browser/probe.ts`, `test/browser/spy-axylo.ts`, `test/browser/react.browser.test.ts`
- deleted: `test/server.test.ts`, `test/size.test.ts`

The core under `packages/axylo/src` was being edited during my runs. None of my browser failures came from the core.
