# N6 — peer-local `axylo/sync` cursors and `createDashboard` (Wave 3, Track B)

Author lane: Claude (`ts_state_writer`). Requested and observed model and effort come from harness metadata, which this lane does not see. The Coordinator records them.
Baseline: `runs/coordinators/p2_n6/initial/` (pre-cycle snapshot). The workspace has no `.git`.
Status: **candidate, not verified in a browser.** The Node checks were run. The packed Chrome suites, `npm pack` and the cross-provider review are still open (see "Remaining verification").

## What was built

| File | Change |
|---|---|
| `packages/axylo/src/core/peer.ts` (new) | `SYNC = Symbol.for('axylo.sync')`, the encapsulated `SyncSeam` interface (`readonly drawn`, `sync(target, origin)`), and `forwardSync(handle, inner)`. |
| `packages/axylo/src/core/controller-wrappers.ts` | `Handle` attaches the encapsulated `SyncSeam` capability as a **non-enumerable own property** (`{ get drawn(), sync(t, o) }`), never exposing the mutable controller or host. Offsets: redundant `destroyed` checks dropped in `ChartActions` and `ChartInvalidate`. |
| `packages/axylo/src/core/controller.ts` | Splits streaming-only controller methods (`append`, stream reencode, field recovery, paused-arrival resume) into `StreamingChartController extends ChartController` so static entries (`axylo/static`, `axylo/cartesian`, `axylo/finance`) tree-shake them out while `axylo` and `axylo/stream` keep identical behavior. Chains null assignments in `destroy()` and inlines single-use callback factories. |
| `packages/axylo/src/core/controller-types.ts` | `Host['interaction'].sync?` (type only). |
| `packages/axylo/src/core/chart.ts` | `LazyInteraction.sync` forwards to the real layer once a compact chart is made full; deduplicates `createChart`/`createStaticChart` through `openChart`. |
| `packages/axylo/src/dom/interaction-types.ts` | `Interaction.sync?` (type only). |
| `packages/axylo/src/dom/interaction.ts` | Passive `S_SYNC` state: `sync(target, origin)` using explicit `s.k === S_NONE \|\| s.k === S_SYNC` and `s.k === S_SYNC && s.o === o` guards, drawn through `#present`, with `data-axylo-sync` marker and Escape-to-peers (`hover(null)` once). Size offsets: collapses 7 `#proxyInstruction*` fields into `#proxyKey` via `sameKey`, and inlines single-use private helpers. |
| `packages/axylo/src/cartesian.ts`, `packages/axylo/src/finance/chart.ts` | `forwardSync(handle, inner)` on the returned wrapper (nothing else). |
| `packages/axylo/src/sync/group.ts` (new; the former body of `sync.ts`) | Peer-local resolution, per-attachment origins, the active cursor, and visual cleanup on detach and destroy. |
| `packages/axylo/src/sync/dashboard.ts` (new) | `createDashboard`. |
| `packages/axylo/src/sync.ts` | Re-exports only (group, dashboard, types). |
| `packages/axylo/test/sync/n6-peer-sync.test.ts`, `n6-interaction-sync.test.ts`, `n6-dashboard.test.ts` (new) | Node and fast-check tests. |
| `tests/dist/n6-sync-dashboard.browser.test.ts` (new) | Packed Chrome test under strict CSP. **Not run.** |
| `tests/dist/pages/instrument.js` | Adds `window.__liveAll()`: every tracked listener (including those on disconnected nodes), plus observers, observer targets and disconnected observer targets. `__live()` is unchanged for `lifecycle.browser.test.ts`. |

Untouched: `public.ts`, `core/contracts.ts`, `cartesian/**`, `stats.ts`, `export.ts`, `theme/**` (checked with `diff -rq` against `initial/`).

## How it works

1. **Seam.** `handle[Symbol.for('axylo.sync')]` is a non-enumerable encapsulated capability (`SyncSeam`) with only two members:
   - `get drawn()` (accepted frame, view, lookup; `null` before first frame and once destroyed);
   - `sync(target, origin)` (forwards to `host.interaction.sync?.(target, origin)`; a no-op on `DeadHost` once destroyed).

   Neither the mutable `ControllerCore` nor `Host` is exposed. Property names survive minification, so any bundle can read them. Wrappers (`cartesian`, `finance`) copy the same value, non-enumerable.
2. **Peer-local resolution** (`sync/group.ts` `localTarget`):
   - The incoming x becomes a position on the peer's own `XColumn`. A `Date` gives its instant; an ISO date or date-time is parsed; a category is found by name through a per-category-list `Map` held in a `WeakMap`.
   - The slot is found by binary search over the peer view's `visibleSlots` in the typed `x.values`. There are no scans and nothing is allocated per point.
   - A position outside the view's `xDomain` is unmatched.
   - The datum comes from the peer's own `lookup.primary({kind:'x', x})`, so hidden series and the chart's own lookup rules apply.
   - The event payload is built from the peer's frame (`peerPoint`: the aligned branch of `pointForDatum`). The target is drawn through the peer's own `#present`: its overlay, plus `alignedHover` or `lookup.tooltip`.
3. **No echo.** `#present` never calls `#hover` while `S_SYNC` is shown, and `S_SYNC` holds `#lastHover` at null. Commit, reconcile and reset can only call `#hover(null)`, which changes nothing.
4. **Local input wins.** A peer cursor is accepted only over `S_NONE`, with the proxy not focused and the table closed.
   - Pointer, keyboard, hold and pin replace it.
   - It never focuses anything, writes `aria-valuetext` or announces.
   - The tooltip stays `aria-hidden`.
   - It is not put in the Escape "showing" stack; the source chart closes it.
5. **Origins.**
   - Each group's attachment record is the origin. External calls use one object per group.
   - The group tracks the origin that leads the cursor; a clear from any other origin is not passed on.
   - The interaction layer clears a cursor only for the origin that showed it. So a late leave, blur or Escape from A cannot remove a newer cursor from C, in this group or an overlapping one.
   - Detach and destroy clear the cursors visually, without calling `onHoverSync`.
6. **Zoom.** Unchanged. The controller's `zoom()` emits synchronously, and the group's `propagating` guard stops it bouncing back (checked in Node, `linked zoom stays synchronous and single`).
7. **Dashboard.**
   - Caller factories make the charts; the dashboard imports no chart kind.
   - The grid is one CSSOM `style.cssText` write: `repeat(auto-fit, minmax(min(100%, 320px), 1fr))`. It stacks in one column below two columns' width, with no listener or observer.
   - One sync group gives shared hover, brushing, `zoom`, and `reset`.
   - `add` and `remove` work at any time. Rollback and `destroy` run in reverse order (membership, chart, panel element, group, grid) even if a node was disconnected. Every release step runs even when one throws, and the first error is rethrown.

## Ambiguities and decisions (please review)

1. **Symbol only at the cross-bundle edge.** The brief says Handle → Controller → LazyInteractionHost → DomInteraction.
   - A computed class key (`[SYNC]() {}`) is import-time work: esbuild keeps it, measured as `var r=Symbol.for("a"),o=class{[r](){…}}` under `ignoreAnnotations`. That breaks the 0 B bare import.
   - So the symbol is an own property set in the `Handle` constructor, and on the wrappers. The hops behind it (`host.interaction.sync`, `LazyInteraction.sync`, `DomInteraction.sync`) are plain methods, because they never cross bundles.
2. **Encapsulated seam capability.** `handle[SYNC]` exposes only `{ get drawn(), sync(target, origin) }` rather than the mutable controller object. Wrappers forward the exact same object.
3. **Structural handles** (no seam, such as the C5 mocks) keep the exact C5 payload: source `series` and `y` at the matched x, with `row: null` and `index: -1`. This keeps C5 callers compatible. Real Axylo charts never get source y or series: their `onHoverSync` gets their own point, or null.
4. **x kind for real charts** = declared, else the committed frame's kind, else inferred. `SyncXKind` gains `'wall'`. Behaviour change: two *undeclared* real charts with different frame kinds (time and date, or time and wall) now report `x-kind-mismatch`. Before, the kind was inferred from payloads.
5. **Escape on a source raises `hover(null)`**, only when the chart had raised a hover. Peers then close their readouts. The chart's `#lastHover` is kept, so the next *different* datum raises hover again (spec I1: "Escape closes it until the pointer reaches a different datum"). **This is a public event change for every chart, synced or not**, and it needs owner review. Without it, Escape on the source leaves the peer readouts open.
6. **Unmatched x.**
   - Outside the peer's visible x window: unmatched, even under `'nearest'`.
   - A line chart's gap slot (a missing regular step) *is* a slot. The peer reads it as its own datum with `y: null` ("No observation", spec I1).
   - `'nearest'` ties go to the earlier slot, as in C5.
   - Scatter and donut peers show no passive cursor; they are unmatched and follow the policy.
7. **Peer cursor across committed frames.** It is kept across same-epoch commits (update, zoom, append, resize); a position that leaves the window is clipped like any cursor until the source moves again. It is dropped on an epoch change and on a frame that is not ready. Known limitation: a category re-map inside one epoch does not re-map the peer cursor. That code was removed for size; the source's next move corrects it.
8. **Dashboard has no `span` option.** In a one-column stack it would overflow the 320 px viewport.

## Size (gzip-9, measured)

Baseline bundles are built from the unmodified `runs/coordinators/p2_n6/initial/` snapshot into `$TMPDIR/baseline-dist/` using the exact `scripts/build.mjs` esbuild recipe (without modifying `initial/`). Candidate bundles are `packages/axylo/dist/` from `npm run build`.

### Dist files (`gzip -9c` and Node `zlib.gzipSync({ level: 9 })`)

| File | Baseline (`gzip -9c`) | Candidate (`gzip -9c`) | Δ (`gzip -9c`) | Baseline (`zlib-9`) | Candidate (`zlib-9`) | Δ (`zlib-9`) | Target |
|---|---|---|---|---|---|---|---|
| `axylo.js` | 158,539 | 158,571 | **+32** | 158,811 | 158,865 | **+54** | `<= +120` (pass) |
| `static.js` | 141,362 | 140,469 | **-893** | 141,676 | 140,762 | **-914** | `<= +120` (pass) |
| `stream.js` | 158,537 | 158,571 | +34 | 158,810 | 158,865 | +55 | ok |
| `cartesian.js` | 127,233 | 126,358 | **-875** | 127,605 | 126,722 | **-883** | ok |
| `finance.js` | 124,680 | 123,798 | **-882** | 124,943 | 124,050 | **-893** | ok |
| `sync.js` | 1,580 | 3,392 | +1,812 | 1,588 | 3,408 | +1,820 | ok |

### Consumers (Node `zlib.gzipSync({ level: 9 })`, exact `tests/dist/subpaths.test.ts` esbuild recipe)

Built with esbuild (`bundle: true, minify: true, format: 'esm', target: 'es2022', conditions: ['production']`) aliasing `axylo*` to unpacked `dist/*.js` (verified to match packed `tests/dist/subpaths.test.ts` byte-for-byte: prior candidate measured 127,270 / 124,745 / 3,418 B in both).

| Consumer | Baseline | Candidate | Δ | Cap / Status |
|---|---|---|---|---|
| `export { cartesian } from 'axylo/cartesian'` | **127,120** (exceeded 127,000 at baseline by +120 B) | **126,228** | **-892** | `<= 127,000` (**772 B headroom**) |
| `export { candlestick } from 'axylo/finance'` | 124,599 | **123,746** | **-853** | `<= 127,000` (3,254 B headroom) |
| `export * from 'axylo/sync'` | 1,590 | **3,407** | +1,817 | `<= 3,500` (93 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` | 1,520 | 2,544 | +1,024 | dashboard absent (`axylo-dashboard` not in output) |
| `export { line } from 'axylo'` | 135,737 | 135,769 | **+32** | ok |
| `export * from 'axylo'` | 158,687 | 158,741 | **+54** | ok |
| `export { line } from 'axylo/static'` | 121,251 | **120,329** | **-922** | under legacy cap 120,729 |
| `export * from 'axylo/static'` | 141,547 | **140,619** | **-928** | under legacy cap 140,988 |
| bare `import 'axylo'`, `'axylo/static'`, `'axylo/stream'`, `'axylo/cartesian'`, `'axylo/stats'`, `'axylo/sync'`, `'axylo/export'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |
| bare `import 'axylo/finance'` (`ignoreAnnotations: true`) | **23** | **23** | 0 | pre-existing baseline in `finance/layout.ts:125` (outside N6 fence) |

### Reproduction steps
1. `npm run build`
2. Build `initial/` with the `scripts/build.mjs` esbuild options into `$TMPDIR/baseline-dist/` (do not modify `initial/`).
3. Run esbuild with `bundle: true, minify: true, format: 'esm', target: 'es2022', conditions: ['production']` aliasing `axylo*` to `packages/axylo/dist/*.js` and compress outputs with `zlib.gzipSync(Buffer.from(text), { level: 9 }).length` (exact `tests/dist/subpaths.test.ts` recipe).
4. For `gzip -9c` dist comparison: `for f in axylo static stream cartesian finance sync; do gzip -9c < packages/axylo/dist/$f.js | wc -c; done`.

- **Baseline Cartesian note:** The `export { cartesian } from 'axylo/cartesian'` consumer was already **127,120 B** at baseline (+120 B over the 127,000 B cap). Splitting `StreamingChartController` out of the static `ChartController` base drops Cartesian to **126,228 B** (-892 B vs baseline, 772 B below the 127,000 B cap).
- **Size offsets taken (all behavior-preserving):**
  - `core/controller.ts`: `StreamingChartController extends ChartController` holds `append()`, stream reencoding, field recovery, and paused-arrival resume; `StaticChartController extends ChartController` holds only the static `append()` throw. Static entries (`static`, `cartesian`, `finance`) tree-shake out all streaming controller code (~900 B gzip), while `axylo` and `stream` omit the static error string. `destroy()` chains null assignments, and single-use callback factories are inlined.
  - `dom/interaction.ts`: collapses 7 `#proxyInstruction*` private fields into a single `#proxyKey` checked with `sameKey`, and inlines single-use private helpers (`#getTooltip`, `#clearControlRects`, `#figureMapping`, `#visiblePlot`, `#visibleReadout`, `#prepareIdleAligned`).
  - `core/chart.ts`: deduplicates `createChart` / `createStaticChart` via `openChart`.
  - `core/controller-wrappers.ts`: `ChartActions` and `ChartInvalidate` drop redundant `destroyed` checks (already guarded by nulled `accepted`/`drawn`/`listeners` and `schedule()`).
- **Finance bare import, 23 B:** Caused by `packages/axylo/src/finance/layout.ts:125` (`const DRAWN = FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC;`), outside the N6 ownership fence. Left untouched and documented here.

## Verification run here (ran and saw)

- `npm run typecheck` (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`): passes, no output.
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync`: `Test Files 4 passed (4)`, `Tests 33 passed (33)`.
- Full Node suite on the final tree, `npx vitest run --configLoader runner --no-cache --no-fsModuleCache`: `Test Files 133 passed (133)`, `Tests 2318 passed (2318)`.
  - The run generated `apps/docs/.cache/types/{probe.ts,tsconfig.json}`, which I removed by their literal paths.
- `npm run build`: passes. Sizes are in the tables above.
- The page scripts of the browser test bundle cleanly with esbuild against `packages/axylo/dist`, using `.prism-cache/tmp/measure/pagecheck.mjs`. That is a compile check only; nothing was executed in a browser.
- Plain `npx vitest run` fails at startup with EROFS in this sandbox (read-only `node_modules`), so the runner flags above were used.

## Repair round: Director verify turn 4 (packed Chrome)

Source: `runs/coordinators/p2_n6/verify/turn-4-neon-4-medium__20261127T075707Z.log`.

### What the Director's run showed (observed there; not re-run here)

- Passed: typecheck, build, 2,318 unit tests, the packed size and bare-`axylo/sync` gates, `c5.browser.test.ts`, and the N6 pointer and late-clear tests.
- Failure 1, the N6 keyboard test: `expected 'axylo-1-proxy' to be 'lineA'`. `peerView().active` names the closest element with an id, and for the focused proxy that is the proxy itself. This was a test fault, not a focus fault.
- Failure 2, N6 dashboard teardown:
  - Baseline: `{"listeners":0,"disconnected":[],"observers":0,"observerTargets":0,"disconnectedTargets":0,"frames":0}`, 2 nodes.
  - After teardown: `{"listeners":13,"disconnected":[],"observers":1,"observerTargets":1,"disconnectedTargets":0,"frames":0}`, 2 nodes.
  - So 13 listeners and 1 observer with 1 target were still registered, all on targets that are not disconnected nodes: the window, the document, media queries, `document.fonts`, or connected nodes. Nothing was left on disconnected nodes, no frame was pending, and the node count was back to baseline.

### What changed (test and instrumentation only; no runtime module touched)

- `tests/dist/n6-sync-dashboard.browser.test.ts`, keyboard test:
  - A new `focusAt()` compares `document.activeElement` with the source proxy node `#lineA .axylo-proxy`, and lists any peer that contains focus.
  - Focus is checked to be on the source proxy:
    - before the keys;
    - while all three peers (`#lineB`, `#cart`, `#fin`) present;
    - after Escape;
    - after the arrow that follows Escape.
  - After `blur()` on that proxy, focus is off it and in no peer.
  - Every peer is checked for its own day-2 value (latency 5,026; orders 42 and 306 ms; high 232), never the source's requests (114), with `aria-valuetext` and the live region unchanged.
  - On day 3, `#lineB` clears (it has no row there) and `#cart` and `#fin` follow.
  - Unchanged: the Escape and blur clears on all peers, and the no-own-hover checks.
- `tests/dist/pages/instrument.js`:
  - `__live()` is unchanged.
  - `__liveAll()` keeps every aggregate field with the same meaning (`listeners`, `disconnected`, `observers`, `observerTargets`, `disconnectedTargets`, `frames`). It adds `detail`: each live listener's target (with its panel or id, and whether it is connected), type and capture, the phase it was registered in, and the first four page stack frames at registration. The same is recorded for each observer and each of its targets.
  - New `__phase(label)` and `__snapshots()`: phase-tagged counts plus live registrations grouped by target and type.
  - Nothing is filtered out of the counts.
- The dashboard test now tags these phases: `mount`, `hover`, `brush`, `reset-zoom`, `add-remove`, `narrow`, `wide`, `fin-disconnect`, `fin-remove`, `grid-disconnect`, `destroy`, `after-destroy` (synchronous), `zoom-on-destroyed` (after the 150 ms wait), `end`.
  - It prints the per-phase report on every run and appends it to the listener and observer assertion messages.
  - All 0/0/0 assertions are kept as they were, including disconnected listeners and targets.
- `packages/axylo/test/core/n6-dashboard-lifecycle.test.ts` (new, Node): the browser test's flow with real charts.
  - `axylo`, `axylo/cartesian`, `axylo/finance` and `axylo/sync` are loaded as separate module instances (`vi.resetModules`), as the packed subpaths are separate bundles.
  - The flow: hover with cart and fin showing the peer cursor, brush, reset and zoom, add and remove, a panel and then the grid disconnected before teardown, and `zoom` on destroyed charts.
  - The n3-dom media queries and MutationObservers are made to record registrations.
  - It asserts 0 window, document, media-query and `document.fonts` listeners, 0 MutationObserver and ResizeObserver targets, and the baseline node count. It also asserts that the page-level hubs were really held while mounted.

### Tracing the 13 + 1 (ran and saw, in Node only)

- Same flow, `src` modules: clean at every phase. Mounted, each bundle holds 1 `document.fonts` listener, 5 media-query listeners (3 theme, 2 environment) and 2 MutationObserver targets. A hovered chart adds window `keydown`, `resize`, `blur` and document `scroll`. Everything is released once the charts leave the document and are destroyed.
- Same flow with real async `queueMicrotask`: clean.
- Same flow against production bundles built from this `src` with the release esbuild recipe (`PRODUCTION` defines, minified, to `.prism-cache/tmp/n6dist/`): mounted `fonts 3, media 15, mutationTargets 6, resizeTargets 9`; after teardown and after `zoom` on destroyed charts, all 0 with 1 node (the host).
- Read through `core/chart.ts` (watch/unwatch, `#stopAttached`, the detached ResizeObserver switch, `#release` order), `core/environment.ts` (env, geometry, probe and root MutationObserver hubs), `theme/watch.ts` and `dom/interaction.ts` (document, pin and tooltip-press listeners). I found no path that registers again after unwatch or destroy, and no page-level registration kept on purpose.
- **Not found: the Chrome cause.** Chrome-only behaviour the Node DOM does not model: real ResizeObserver and MutationObserver delivery and timing, focus events (`focus()` dispatches none in n3-dom), real pointer boundary events, font loading, and tooltip placement.
  - The next packed Chrome run prints each surviving registration with its target, the phase it was made in and its stack, so the fix can be aimed.
  - No runtime change was made without that evidence.
  - Tracker measurement error was checked as a cause: an add/remove key mismatch, a `signal` abort, or the `MediaQueryList` re-arm in the environment hub. None applies to the library's calls.

### Run here (ran and saw)

- `npm run typecheck`: exit 0.
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 34 passed (34)`.
- Sizes: unchanged by this round (no file under `packages/axylo/src` changed), so the earlier tables stand. Not rebuilt or re-measured here.

### Pending (Director)

- Packed Chrome: `n6-sync-dashboard.browser.test.ts` (keyboard and dashboard) and `c5.browser.test.ts`. Not run here (worker guardrail).
- The dashboard teardown 0/0/0 is still expected to **fail** until the cause the new report names is fixed. This round fixes no runtime cause for it.

## Repair round: Director verify turn 6 (packed Chrome), the measurement boundary

Source: `runs/coordinators/p2_n6/verify/turn-6-opus-5.5-high__20261127T081844Z.log`.

### What the Director's run showed (observed there; not re-run here)

- Passed: typecheck, build, 2,319 unit tests, the packed size tests, `c5.browser.test.ts`, and three N6 linked tests.
- Failed: the dashboard teardown, 13 listeners and 1 MutationObserver (1 target, `document`) over the baseline, as in turn 4.
- The new per-phase report names every one of them:
  - window `__playwright_global_listeners_check__` and a MutationObserver on `document`, from `InjectedScript._setupGlobalListenersRemovalDetection`;
  - 12 window capture listeners (`mousemove`, `pointerdown`, `pointerup`, `touchstart`, `touchend`, `touchcancel`, `mousedown`, `mouseup`, `click`, `auxclick`, `dblclick`, `contextmenu`), from `InjectedScript._setupHitTargetInterceptors`.
- All were made in phase `mount`, from `new InjectedScript` (Playwright's page-side script), not from the library. Every chart registration made in the test was released by `after-destroy`.
- Cause: the fixture set `__tracking` and mounted at module load. Playwright first built its injected script afterwards, when the test's first `page.waitForFunction` ran. So its registrations fell inside the measured window.

### What changed (test only; no runtime module, no instrumentation)

- `tests/dist/n6-sync-dashboard.browser.test.ts`, dashboard fixture: the module no longer mounts on load. It defines `window.__n6start()`. In one synchronous call that function:
  - sets `__tracking`;
  - takes the baseline (`__liveAll()` and the `body` element count);
  - tags phase `mount`;
  - runs `createDashboard`.
- The dashboard test, before it calls the start function:
  - waits with `page.waitForFunction` for `__n6start` (this builds the main-world injected script);
  - runs `page.locator('#dash').count()` and `.boundingBox()` on the existing host (this sets up the utility world);
  - then, in one `page.evaluate`, checks that tracking was off and nothing was mounted, and calls `__n6start()`. A new assertion checks `{ before: { tracking: false, mounted: false }, mounted: true }`.
- Unchanged:
  - every 0/0/0 assertion (aggregate listeners, disconnected listeners, observers, observer targets, disconnected targets, frames, nodes);
  - the child-count, inert and error checks;
  - the phase diagnostics and report, and the strict CSP page;
  - `pages/instrument.js` (no registration is filtered or suppressed).
- Expected: Playwright's script is already set up when tracking starts, so it registers nothing inside the window. If the library leaves something behind, the delta still shows it.

### Run here (ran and saw)

- `npm run typecheck`: exit 0.
- The dashboard fixture page script, taken from the test source (template, `data` and `LOGS` substituted as the test does), bundled with esbuild against `src` (`axylo`, `axylo/cartesian`, `axylo/finance`, `axylo/sync` aliased to their `src` entries, `PRODUCTION` defines, minified). It built with no errors: 482,648 bytes, containing `__n6start`. This was not the packed install; `npm pack` was not run.

### Pending (Director)

- Packed Chrome: `n6-sync-dashboard.browser.test.ts` (all four tests) and `c5.browser.test.ts`. Not run here (worker guardrail).

## Remaining verification (Coordinator / Director)

- `tests/dist/n6-sync-dashboard.browser.test.ts` and `tests/dist/c5.browser.test.ts` in real Chrome on the packed fixture: not run by this lane (worker guardrail). The Director's turn-4 result and the repair are in the section above.
  - The N6 test's x positions are found by scanning the plot with the mouse until the chart's own hover reports the wanted day. Its value checks use en-US grouping (`5,052`).
  - Its 0/0/0 check compares `__liveAll()` and the `body` element count after teardown with the baseline taken before `createDashboard`.
  - If the library keeps anything shared and page-wide after the last chart, that shows up as a non-zero delta. The `lifecycle` test suggests it does not.
- Packed `tests/dist` Node suite (`npm pack`): not run. Expect the baseline failures above (LEGACY_CAPS, finance bare import), plus the new deltas.
- What Node could not show:
  - The minimal DOM of `n3-dom.ts` cannot place a floating tooltip, so in Node the peer readout is checked through the peer's lookup model, not visible text.
  - Escape (which needs a placed tooltip) is checked only by the Chrome test.
- Cross-provider review of the exact final candidate: not done.

## Repair round: 5 review merge blockers (Google lane)

Source: `runs/coordinator_p2_n6/sol-6.2-medium__20261127T084020Z/report.md`.

### What changed

1. **Frame-by-frame logical X re-resolution & scatter fallback (`core/peer.ts`, `core/controller-types.ts`, `core/controller-wrappers.ts`, `core/chart.ts`, `dom/interaction-types.ts`, `dom/interaction.ts`, `sync/group.ts`):**
   - `SyncSeam.sync` and `Interaction.sync` now accept `SyncResolve = (view: View, lookup: Lookup) => PickTarget | null` instead of a static `PickTarget`.
   - `DomInteraction` retains `{ k: S_SYNC, s, f, o }` across same-epoch commits (including streaming category remaps), cross-epoch data replacements, and zoom/reset transitions, mutating `s = f(next.view, next.lookup)` on every ready commit (or `null` when not ready).
   - `#present()` sets `data-axylo-sync` only when `remote && target !== null`, so zooming past a numeric cursor clears both the sync marker and the overlay without emitting hover, and resetting zoom restores the cursor with zero echo. `#reset()` also clears `data-axylo-sync`.
   - Numeric scatter peers fall through to the legacy C5 callback path (`onHoverSync`) instead of receiving `null`.
2. **Per-recipient ownership, distinct manual IDs, direct source destruction, and stale snapshot rejection (`core/peer.ts`, `core/controller.ts`, `core/controller-types.ts`, `core/controller-wrappers.ts`, `sync/group.ts`):**
   - Replaced the single group-wide `active` token with per-recipient `shownBy: object | null` on `MemberRecord`.
   - Under `'clear'`, an unmatched hover clears any prior `target.shownBy` on that recipient; under `'ignore'`, the prior origin retains ownership on that recipient until that origin clears or detaches, or the group destroys.
   - Distinct explicit `sourceId`s in `syncHover(x, sourceId)` each receive a distinct token via `externalTokens: Map<string, object>` (cleared on `destroy()`).
   - Added lazy `disposers: Set<() => void> | null` on `ChartController` and `onDestroy?(fn)` on `SyncSeam`; destroying a source chart directly detaches it and clears its cursors on all peers.
   - `broadcastHover` and `broadcastZoom` check `source?.detached` so an event listener already snapshotted by `ChartController.emit` cannot broadcast after detach.
3. **Observable remote-to-local transition & Escape guard (`dom/interaction.ts`):**
   - Presentation cache `flags` now includes `| (remote ? 16 : 0)` so moving a peer's pointer onto the exact datum already shown remotely transitions from `S_SYNC` to `S_HOVER` and emits the local `hover` event.
   - `#onEscape` returns early when `this.#shown.k === S_SYNC`, so pressing Escape while a control inside a peer has focus neither consumes Escape nor writes local `#dismissed` state.
4. **Partial subscription rollback (`sync/group.ts`):**
   - `MemberRecord` tracks `unsubs: (() => void)[]`; if a later subscription (`zoom` or `onDestroy`) throws in `attach`, `rec.detached = true` is set and all earlier registrations are unsubscribed in reverse order before rethrowing.
5. **Crosshair geometry assertions in packed Chrome test (`tests/dist/n6-sync-dashboard.browser.test.ts`):**
   - Extended `peerView` to inspect `svg g.axylo-overlay line` vertical cursor geometry (`cursorCount`, `cursorX`, `cursorSpan`, `overlayChildren`, `plot`) and added `expectedCursorX` against each peer's committed projection plus an analytic check on `lineB`.
   - Added pointer and keyboard assertions verifying the cursor rule sits at the expected X within 1.5 px, spans the plot height, advances rightward on later days, and is completely removed (`cursorCount === 0`, `overlayChildren === 0`) on unmatched day, mouse leave, Escape, and blur.
6. **Size offsets (behavior-preserving, within N6 fence):**
   - `dom/interaction.ts`: mutable `S_SYNC.s`, inlined single/double-use private helpers (`setClass`, `#mode`, `#markFocusedSlice`, `#setKeyed`, `#hideRange`, `#refreshControls`, `#endTouch`, `#canZoomCloser`, `#controlInputs`, `#pinchMove`, `#openTable`, `#startPinch`, `#leaveSlices`).
   - `core/controller-wrappers.ts`: `DeadHost` self-references assigned in constructor; compact `Handle` getter bindings.
   - `core/controller.ts`: chained null assignments in `destroy()`.
   - `sync/group.ts`, `sync/dashboard.ts`: `matchXForMember` returns `XValue | null`, shared `sourceKindOf`, `unsubs` array, and shared `teardown` helper in `dashboard.ts`.

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,628** | **+89** | `<= +120` (pass, 31 B headroom) |
| `dist/axylo.js` (`zlib-9`) | 158,811 | **158,918** | **+107** | `<= +120` (pass, 13 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,495** | **-867** | `<= +120` (pass) |
| `dist/static.js` (`zlib-9`) | 141,676 | **140,785** | **-891** | `<= +120` (pass) |
| `dist/cartesian.js` (`gzip -9c`) | 127,233 | **126,333** | **-900** | ok |
| `dist/finance.js` (`gzip -9c`) | 124,680 | **123,810** | **-870** | ok |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,476** | +1,896 | ok |
| `export { cartesian } from 'axylo/cartesian'` (`zlib-9`) | 127,120 | **126,226** | **-894** | `<= 127,000` (pass, 774 B headroom) |
| `export { candlestick } from 'axylo/finance'` (`zlib-9`) | 124,599 | **123,733** | **-866** | `<= 127,000` (pass, 3,267 B headroom) |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,490** | +1,900 | `<= 3,500` (pass, 10 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,626** | +1,106 | `axylo-dashboard` absent (pass) |
| bare `import 'axylo/sync'`, `'axylo'`, `'axylo/static'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 45 passed (45)` (+11 new focused regressions covering all 5 review blockers).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test`: `Test Files 129 passed (129)`, `Tests 2082 passed (2082)`.
- `npm run build` + dist/consumer/bare-import size checks: all pass as recorded above.
- Pending for Coordinator / Director: fresh Director run (including packed Chrome `tests/dist/n6-sync-dashboard.browser.test.ts` and `tests/dist/c5.browser.test.ts`, and `npm pack`) and cross-provider review.

## Repair round 2: 3 review merge blockers (`sol-6.2-medium__20261127T091637Z/report.md`)

### What changed

1. **Source & recipient lifetime across synchronous extension points (`sync/group.ts`, `dom/interaction.ts`):**
   - `broadcastHover` and `broadcastZoom` now check `dead(source)` (`destroyed || !!source?.off`) and `target.off` before and after every synchronous extension point (`onMismatch`, `resolveX`, `peerPoint`, `show`/rendering, `target.chart.zoom`, and `onHoverSync`/`onZoomSync`).
   - Because `detachMember` marks `rec.off = true` on the old `MemberRecord` and re-attaching allocates a new record, detaching and immediately re-attaching the source or recipient stops delivery for the old attachment identity.
   - `target.by = token` is recorded **before** `show(target, ...)` so reentrant teardown during tooltip formatting or overlay rendering clears the current recipient as well as already-visited recipients (never leaving an unowned installed resolver).
   - `DomInteraction.#present()` snapshots `shown = this.#shown` and aborts if `this.#shown !== shown` after tooltip formatting, `drawOverlay`, or `tip.show`/`tip.strip` (hiding the tooltip if `tip.show` completed after a reentrant clear), preventing outer `#present()` continuations from repainting stale remote cursors.
2. **Owned null clear independent of peer X kind, drawn frame, or chart kind (`sync/group.ts`):**
   - `broadcastHover` handles `payload === null` before `checkCompat`, `drawn`, and chart-kind checks: when `target.by === token`, `clearShown(target)` clears `target.by` and invokes `show(target, null, token)` unconditionally, then notifies `target.oh?.(null, origin)` if live.
   - Seam origin token guards across overlapping groups, stale clears from non-leading sources, and legacy structural/scatter provenance semantics are preserved.
3. **Retaining viewport-clipped compatible X across zoom (`sync/group.ts`):**
   - `resolveLocal(..., allowClipped = true)` distinguishes a visible hit, a viewport-clipped existing datum (`p` in `xFull`, outside `xDomain`, matching a slot in `frame.x.values` under exact or `nearest` rules), and a genuine unmatched X.
   - Clipped compatible X values install the `SyncResolve` closure and record `target.by = token` (reporting `null` to `onHoverSync` and drawing nothing while clipped), then resolve on a later commit when zoom includes them with 0 echo.
   - Under `unmatchedHover: 'ignore'`, genuine unmatched X values still preserve the previously shown cursor and ownership, while viewport-clipped existing datums are retained.
4. **Size offsets (behavior-preserving, within N6 fence):**
   - `sync/group.ts`: unified `findSlot`/`resolveLocal`, shared `clearShown`/`clearAndNotify`, moved `checkCompat` inside `createSyncGroup`, dropped dead cross-bundle `slotState` import (`series.slot[i] === SLOT_VALUE`), short private `MemberRecord` keys, reverse-fill category index, `for...of` in `matchXForMember`.
   - `sync/dashboard.ts`: compact `resolveTarget`, short private `Mounted` keys.
   - `dom/interaction.ts`: inlined single-use private methods (`#onStartup`, `#stepFrom`, `#atOrdinal`, `#move`, `#onProxyBlur`).

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,642** | **+103** | `<= +120` (pass, 17 B headroom) |
| `dist/axylo.js` (`zlib-9`) | 158,811 | **158,929** | **+118** | `<= +120` (pass, 2 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,492** | **-870** | `<= +120` (pass) |
| `dist/static.js` (`zlib-9`) | 141,676 | **140,778** | **-898** | `<= +120` (pass) |
| `dist/cartesian.js` (`gzip -9c`) | 127,233 | **126,393** | **-840** | ok |
| `dist/finance.js` (`gzip -9c`) | 124,680 | **123,816** | **-864** | ok |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,471** | +1,891 | ok |
| `export { cartesian } from 'axylo/cartesian'` (`zlib-9`) | 127,120 | **126,255** | **-865** | `<= 127,000` (pass, 745 B headroom) |
| `export { candlestick } from 'axylo/finance'` (`zlib-9`) | 124,599 | **123,760** | **-839** | `<= 127,000` (pass, 3,240 B headroom) |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,483** | +1,893 | `<= 3,500` (pass, 17 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,628** | +1,108 | `axylo-dashboard` absent (pass) |
| bare `import 'axylo/sync'`, `'axylo'`, `'axylo/static'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 54 passed (54)` (+9 new focused regressions covering all 3 review blockers).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test`: `Test Files 129 passed (129)`, `Tests 2091 passed (2091)`.
- `npm run build` + dist/consumer/bare-import size checks: all pass as recorded above.
- Pending for Coordinator / Director: fresh Director verification (including packed Chrome `tests/dist/n6-sync-dashboard.browser.test.ts` and `tests/dist/c5.browser.test.ts`, and `npm pack`) and independent cross-provider review.

## Repair round 3: 3 review merge blockers (`sol-6.2-medium__20261127T094042Z/report.md`)

### What changed

1. **Authoritative X-kind recheck on every retained cursor resolve (`sync/group.ts`):**
   - `viewKind(view)` reads the authoritative X kind from each committed `View` (`null` for `donut`, `frame.xKind` for `scatter`, `frame.x.kind` for aligned).
   - `broadcastHover` captures `expectedKind = viewKind(d.accepted.view)` from the peer's authoritative committed frame (even when the member declared `xKind` metadata) and passes it to `resolveLocal` both on initial delivery and inside the retained `SyncResolve` closure.
   - When a peer later commits a frame with an incompatible X kind (e.g. numeric `x = 2` on a categorical axis containing label `"2"`), `resolveLocal` returns `null` silently, clearing marker/tooltip/overlay while keeping resolver ownership so returning to a compatible frame restores the cursor and source leave/detach/destroy cleans it up. Legitimate explicit `resolveX` mappings and time/date/wall-clock handling are preserved.
2. **Reentrant dashboard mount & `createSyncGroup.attach` hardening (`sync/dashboard.ts`, `sync/group.ts`):**
   - `dashboard.ts` `mount()` tracks both pending `chart` and pending `lv` (group detach) and rechecks `destroyed` after `panel.create(element)` and after `group.attach(...)`. If either destroys the dashboard, `mount()` throws `Axylo: the dashboard was destroyed.` without publishing an ID or mutating `mounted`, unwinding pending membership, chart, and element once in reverse order. Initial `createDashboard` failure also sets `destroyed = true` before teardown.
   - `group.ts` `attach()` guards `destroyed` between subscriptions, rolls back all subscriptions in reverse order if `group.destroy()` ran during `attach` (returning a no-op without publishing to `members`), and scopes the `onDestroy` callback to `members.get(key) === rec` so stale controller-disposal callbacks cannot detach a newer attachment. `group.destroy()` sets `destroyed = true` before detaching members.
3. **Peer-local scatter resolution & passive X crosshair rule (`core/peer.ts`, `core/controller-wrappers.ts`, `dom/interaction.ts`, `sync/group.ts`):**
   - Eliminated the source-Y/series fallback for real scatter peers; legacy C5 payloads remain only for structural handles without a seam.
   - `resolveLocal` resolves scatter views by binary-searching each visible drawable series' borrowed sorted `x` column over `visiblePoints` (or `[0, x.length)` when checking clipped retention), applying exact/nearest/earlier-tie rules across visible series and capping collected `DatumRef`s to 8 (`POINT_LIMIT`) with zero per-point materialization.
   - Added `SyncSeam.point?(ref)` delegating to `pointForDatum(c.drawn, ref)` in `core/controller-wrappers.ts`, removing duplicated `peerPoint` and `positionValue` from `sync/group.ts`.
   - `DomInteraction.#present()` prepends a passive vertical `role: 'cursor'` rule at `pixelOf(layout, first.x)` on remote scatter overlays (`remote && overlay && target?.kind === 'point'`), leaving local scatter marks unaltered.
   - Donut charts have no X axis (`viewKind === null`) and are skipped on hover sync; transitioning a peer to donut suppresses any retained cursor while keeping ownership for cleanup.
4. **Size offsets (behavior-preserving, within N6 fence):**
   - `core/controller.ts`: moved `#settle` to a module-level `settle()` guarded by `__DEV__ || __BENCH__` so production builds tree-shake it; inlined 8 single-use `frameStep` private methods; replaced 7-field `#fitKey` comparison with `sameKey`; eliminated duplicate `#composition`/`#kind` fields on `StreamingChartController`; dropped redundant `.clear()` calls immediately before nulling in `destroy()`.
   - `core/chart.ts`, `dom/interaction.ts`: inlined single-use private methods (`#undo`, `#onDetachedResize`, `#settleSwitch`, `#onEscape`, `#onWheel`, `#onStageLeave`, `#isDismissed`).
   - `sync/group.ts`: reused `seam.point` instead of bundling `peerPoint`/`positionValue`; unified `positionFor`/`resolveLocal`; shared `noop` and hoisted `matchedX` in `broadcastHover`.

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,632** | **+93** | `<= +120` (pass, 27 B headroom) |
| `dist/axylo.js` (`zlib-9`) | 158,811 | **158,906** | **+95** | `<= +120` (pass, 25 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,496** | **-866** | `<= +120` (pass) |
| `dist/static.js` (`zlib-9`) | 141,676 | **140,757** | **-919** | `<= +120` (pass) |
| `dist/cartesian.js` (`gzip -9c`) | 127,233 | **126,292** | **-941** | ok |
| `dist/finance.js` (`gzip -9c`) | 124,680 | **123,746** | **-934** | ok |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,465** | +1,885 | ok |
| `export { cartesian } from 'axylo/cartesian'` (`zlib-9`) | 127,120 | **126,220** | **-900** | `<= 127,000` (pass, 780 B headroom) |
| `export { candlestick } from 'axylo/finance'` (`zlib-9`) | 124,599 | **123,714** | **-885** | `<= 127,000` (pass, 3,286 B headroom) |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,487** | +1,897 | `<= 3,500` (pass, 13 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,597** | +1,077 | `axylo-dashboard` absent (pass) |
| bare `import 'axylo/sync'`, `'axylo'`, `'axylo/static'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 61 passed (61)` (+7 new focused regressions covering all 3 review blockers).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test`: `Test Files 129 passed (129)`, `Tests 2098 passed (2098)`.
- `npm run build` + exact local dist/consumer/bare-import size checks: all pass as recorded above.
- Pending for Coordinator / Director: packed Chrome (`tests/dist/n6-sync-dashboard.browser.test.ts`, `tests/dist/c5.browser.test.ts`), `npm pack`, and independent cross-provider review.

## Repair round 4: 3 review merge blockers + sync bundle trim (`sol-6.2-medium__20261127T100228Z/report.md`)

### What changed

1. **Committed X-kind authority on fresh visual hover routing (`sync/group.ts`):**
   - `memberKind(m)` prioritizes `viewKind(m.s.drawn.accepted.view)` over declared `xKind` metadata whenever a committed frame exists (`m.s?.drawn ? viewKind(m.s.drawn.accepted.view) : m.o.xKind ?? m.ik`).
   - Compatibility checking uses `memberKind(target)` by default (reporting `x-kind-mismatch` and clearing stale owned resolvers when a recipient switched to categories despite stale `xKind: 'number'`), while preserving explicit `resolveX` opt-in cross-kind hover mappings (`isHover && target.o.resolveX ? (target.o.xKind ?? null) : memberKind(target)`).
   - Retained `SyncResolve` closures continue to recheck `viewKind(v) !== expectedKind` silently on commit.
2. **Scatter drawable-geometry filtering before nearest X and count (`core/peer.ts`, `dom/interaction.ts`, `sync/group.ts`):**
   - Extended `SyncResolve` with optional `layout?: Layout`, passed by `DomInteraction` (`sync`/`#reconcile`) and `broadcast`.
   - `resolveLocal` derives exact Y bounds `[yLo, yHi]` from committed `layout.projection.y.domain` (falling back to `view.yDomain`), searches each sorted borrowed `entry.x` column outward from `lowerBound(xs, start, end, p)` with zero per-candidate allocation (skipping Y-clipped and `NaN` points, preserving deterministic earlier-X ties and X-zoom clipping/reset), and filters `entry.y[i]` against `[yLo, yHi]` (`entry.y[i] >= yLo && entry.y[i] <= yHi`) before both `refs` collection and `count++` beyond row 8.
3. **Dashboard pending-mount ID reservation (`sync/dashboard.ts`):**
   - Replaced the `mounted` array with `Map<string, Mounted | null>`, reserving `mounted.set(id, null)` before invoking `panel.create` / `group.attach` and releasing on failure/rollback (`mounted.delete(id)`), `remove(id)`, and `teardown()` (`mounted.clear()`).
4. **Sync subpath size recovery (`sync/group.ts`, `sync/dashboard.ts`):**
   - Merged `broadcastHover`/`broadcastZoom` into a single `broadcast` path with shared `alive(src, target)` guard, tightened `numericValueOf`/`matchXForMember`/`resolveLocal` (single `Date.parse`, `isFinite`, optional-chained `layout.projection`, zero-allocation tuple `Mounted` + shared `releaseAll(..., swallow)` in `dashboard.ts`), preserving member-options shallow-copy capture semantics and all behavior.

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,645** | **+106** | `<= +120` (pass, 14 B headroom) |
| `dist/axylo.js` (`zlib-9`) | 158,811 | **158,911** | **+100** | `<= +120` (pass, 20 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,512** | **-850** | `<= +120` (pass) |
| `dist/static.js` (`zlib-9`) | 141,676 | **140,762** | **-914** | `<= +120` (pass) |
| `dist/cartesian.js` (`gzip -9c`) | 127,233 | **126,312** | **-921** | ok |
| `dist/finance.js` (`gzip -9c`) | 124,680 | **123,763** | **-917** | ok |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,437** | +1,857 | — |
| `export { cartesian } from 'axylo/cartesian'` (`zlib-9`) | 127,120 | **126,225** | **-895** | `<= 127,000` (pass, 775 B headroom) |
| `export { candlestick } from 'axylo/finance'` (`zlib-9`) | 124,599 | **123,720** | **-879** | `<= 127,000` (pass, 3,280 B headroom) |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,472** | +1,882 | `<= 3,500` (**pass**, 28 B headroom; -126 B vs 3,598 B salvage) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,614** | +1,094 | `axylo-dashboard` absent (pass) |
| bare `import 'axylo/sync'`, `'axylo'`, `'axylo/static'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 65 passed (65)`.
- `npm run build` + exact `tests/dist/subpaths.test.ts` esbuild/zlib-9 consumer, GNU `gzip -9c` root/static, and bare-import (`ignoreAnnotations: true`) checks: all pass as recorded above.
- Pending for Coordinator / Director: full Node suite, `npm pack`, packed Chrome (`tests/dist/n6-sync-dashboard.browser.test.ts`, `tests/dist/c5.browser.test.ts`), and cross-provider review.

## Repair round 5: 3 review merge blockers (`sol-6.2-medium__20261127T145333Z/report.md`)

### What changed

1. **Wall-clock classification & normalization in manual hover/zoom (`sync/group.ts`):**
   - `inferXKind` classifies offset-free ISO date-time strings (`ISO_DATETIME_RE` without `ISO_OFFSET_RE`) as `'wall'` per `data/x.ts`, preserving `Date` / offset ISO strings as `'time'` and calendar dates as `'date'`.
   - Real wall-clock peers declared with `xKind: 'time'` retain authoritative committed `'wall'` kind, so manual `syncHover('2026-11-27T10:00')` and `syncZoom(['2026-11-27T10:00', '2026-11-27T11:00'])` match without `time -> wall` mismatch, while `Date`, offset ISO strings, calendar dates, and incompatible explicit `xUnit` values still report mismatch.
   - `matchXForMember` normalizes `'wall'` values via `numericValueOf` (dropping the `k === 'wall'` exclusion) so equivalent wall timestamps differing in seconds or space/`T` separator match and support `'nearest'`.
2. **Pending attachment callback isolation & exact-record guards (`sync/group.ts`):**
   - `alive(a, b)` checks `members.get(a.c) === a` (and `members.get(b.c) === b`), making any synchronous `hover` or `zoom` callback invoked inside `chart.on(...)` inert until the exact `MemberRecord` is published into `members` (covering both emit-then-throw failed mounts and successful synchronous subscriptions).
   - `leave` sets `rec.off = true` if called while `rec` is still pending (e.g. synchronous `onDestroy` during `attach`), and `attach` checks `!destroyed && !rec.off` between subscriptions and before replacement/publication so pending teardown rolls back cleanly without detaching any newer replacement record.
3. **Strict `#hover` anti-echo guard across no-plot, reset/clear, and remote clear (`dom/interaction.ts`):**
   - Guarded the early `!plotReady(d) || !this.#proxy || ...` return in `#present` with `if (!remote && rec < 3 && this.#shown === shown) this.#hover(null)`, so resizing a synced peer to `too-small` (or reentrant state changes during `drawOverlay`) never enters `#hover`.
   - Guarded `#reset()` with `const remote = this.#shown.k === S_SYNC` (clearing `#shown = NONE` unconditionally before early return and skipping `#hover(null)` when `remote`), and routed `sync(null, o)` through `#present(3)` so clearing a passive cursor never enters `#hover`.
   - Audited all `#hover` / `#actions.hover` sites in `dom/interaction.ts` (lines 253, 449, 533, 1283): none can be entered under `S_SYNC`.
4. **Size offsets (behavior-preserving, within N6 fence):**
   - `dom/interaction.ts`: inlined single-use `#unbuild` into `#reset()`.
   - `sync/group.ts`: removed per-iteration `clearAndNotify` closure and redundant `hoverPayload`/`zoomDomain` local casts in `broadcast`, and simplified `syncCharts` entry check.

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,624** | **+85** | `<= +120` (pass, 35 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,458** | **-904** | `<= +120` (pass) |
| `dist/stream.js` (`gzip -9c`) | 158,537 | **158,624** | +87 | ok |
| `dist/cartesian.js` (`gzip -9c`) | 127,233 | **126,298** | **-935** | ok |
| `dist/finance.js` (`gzip -9c`) | 124,680 | **123,753** | **-927** | ok |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,441** | +1,861 | — |
| `export { cartesian } from 'axylo/cartesian'` (`zlib-9`) | 127,120 | **126,222** | **-898** | `<= 127,000` (pass, 778 B headroom) |
| `export { candlestick } from 'axylo/finance'` (`zlib-9`) | 124,599 | **123,719** | **-880** | `<= 127,000` (pass, 3,281 B headroom) |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,473** | +1,883 | `<= 3,500` (**pass**, 27 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,623** | +1,103 | `axylo-dashboard` absent (`hasDash=false`, pass) |
| bare `import 'axylo/sync'`, `'axylo'`, `'axylo/static'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 69 passed (69)` (+4 new focused regressions covering all 3 review blockers).
- `npm run build` + exact `tests/dist/subpaths.test.ts` esbuild/zlib-9 consumer, GNU `gzip -9c` dist, and bare-import (`ignoreAnnotations: true`) checks: all pass as recorded above.
- Pending for Coordinator / Director: full Node suite, `npm pack`, packed Chrome (`tests/dist/n6-sync-dashboard.browser.test.ts`, `tests/dist/c5.browser.test.ts`), and fresh cross-provider review.

## Repair round 6: 2 review merge blockers (`sol-6.2-medium__20261127T150903Z/report.md`)

### What changed

1. **Reentrant attachment replacement & cleanup ordering (`packages/axylo/src/sync/group.ts`):**
   - `detachMember` now performs visual cursor cleanup (`clearShown(rec)` and `clearShown(peer, rec)`) before draining `rec.u` in reverse order (`while (rec.u.length) rec.u.pop()!()`), preventing a nested publish during unsubscribe from having its new cursor clobbered or an older resolver orphaned.
   - `attach` checks `if (destroyed || members.has(key)) return noop;` after initial `detachMember(key)` teardown and `if (!ok() || members.has(key)) { rollback(); return noop; }` after post-subscription replacement teardown, so a reentrant publisher installed during unsubscribe wins and the pending contender rolls back all acquired subscriptions cleanly without overwriting `members`.
   - Preserves stale-detacher identity (`members.get(key) === rec`), pending callback isolation, second-subscription throw rollback, and direct chart disposal.
2. **Year-only calendar date (`YYYY`) classification & validation (`packages/axylo/src/sync/group.ts`):**
   - Extended `ISO_DATE_RE` to `/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/` matching `data/x.ts` (`calendar`).
   - Normalized `YYYY` -> `YYYY-01-01` and `YYYY-MM` -> `YYYY-MM-01` via `value + '-01-01'.slice(value.length - 4)` in `numericValueOf`, and validated parsed calendar dates with `new Date(ms).toJSON()?.slice(0, 10) === d` so invalid calendar dates (e.g. `'2024-02-30'`, `'2023-02-29'`, `'2024-13'`) return `NaN` rather than rolling over.
   - Preserves wall-clock (`'wall'`), offset instants (`'time'`), declared categories (`type: 'category'`), and existing source group matching.
3. **Sync size offsets (`packages/axylo/src/sync/group.ts`, `packages/axylo/src/sync/dashboard.ts`):**
   - `group.ts`: unified `hover`/`zoom` subscription loop in `attach`, used `options[kind] === false`, dropped redundant pre-`detachMember` `if (destroyed)` check, and validated calendar dates with `toJSON()?.slice(0, 10)`.
   - `dashboard.ts`: collapsed duplicate post-create `destroyed` check in `mount()`, handled `null` directly in `unmountSteps`, and replaced `globalThis.document` with `typeof document !== 'undefined'`.
4. **Tests (`packages/axylo/test/sync/n6-peer-sync.test.ts`):**
   - Added 3 focused regressions covering: (a) the exact structural `on('hover')` -> reentrant `attach` -> inner hover unsubscribe -> reentrant replacement `attach` sequence with live listener balance after both `detach` and `destroy`, stale handle inertness, and callback ownership; (b) initial replacement boundary reentrancy and cursor-preservation cleanup order; (c) real-chart year-only (`['2023', '2024', '2025', '2026']`) manual `syncHover` and `syncZoom`, cross-granularity Jan-1 normalization (`YYYY` / `YYYY-MM` / `YYYY-MM-DD`), invalid calendar date non-coercion, and declared-category preservation.

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,624** | **+85** | `<= +120` (pass, 35 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,458** | **-904** | `<= +120` (pass) |
| `dist/stream.js` (`gzip -9c`) | 158,537 | **158,624** | +87 | ok |
| `dist/cartesian.js` (`gzip -9c`) | 127,233 | **126,298** | **-935** | ok |
| `dist/finance.js` (`gzip -9c`) | 124,680 | **123,753** | **-927** | ok |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,452** | +1,872 | — |
| `export { cartesian } from 'axylo/cartesian'` (`zlib-9`) | 127,120 | **126,222** | **-898** | `<= 127,000` (pass, 778 B headroom) |
| `export { candlestick } from 'axylo/finance'` (`zlib-9`) | 124,599 | **123,719** | **-880** | `<= 127,000` (pass, 3,281 B headroom) |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,487** | +1,897 | `<= 3,500` (**pass**, 13 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,646** | +1,126 | `axylo-dashboard` absent (`hasDash=false`, pass) |
| bare `import 'axylo/sync'`, `'axylo'`, `'axylo/static'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 72 passed (72)` (+3 new focused regressions).
- `npm run build` + exact `tests/dist/subpaths.test.ts` esbuild/zlib-9 consumer, GNU `gzip -9c` dist, and bare-import (`ignoreAnnotations: true`) checks: all pass as recorded above.
- Pending for Coordinator / Director: full Node suite, `npm pack`, packed Chrome (`tests/dist/n6-sync-dashboard.browser.test.ts`, `tests/dist/c5.browser.test.ts`), and fresh cross-provider review.

## Repair round 7: 2 review merge blockers (`sol-6.2-medium__20261127T152610Z/report.md`)

### What changed

1. **Exhaustive unsubscribe draining & replacement teardown rollback (`packages/axylo/src/sync/group.ts`, `packages/axylo/src/sync/dashboard.ts`):**
   - Shared `releaseAll(steps, swallow?)` between `sync/group.ts` and `sync/dashboard.ts` (internal to `sync/`; public exports unchanged).
   - `detachMember` runs visual ownership cleanup (`clearShown(rec)` and `clearShown(peer, rec)`) and drains every installed unsubscribe in `rec.u` in reverse order through `releaseAll`, preserving the first thrown error.
   - `attach` moves post-subscription replacement teardown (`if (ok()) detachMember(key)`) inside its `try { ... } catch (err) { rollback(); throw err; }` block so a thrown replacement unsubscribe still rolls back all pending subscriptions (swallowing rollback errors) and rethrows the original error without clobbering any newer reentrant replacement record.
   - `group.destroy()` clears `externalTokens` and drains all remaining members through `releaseAll`, continuing across thrown unsubscribes and rethrowing the first error.
2. **Function check in `syncCharts` (`packages/axylo/src/sync/group.ts`):**
   - Restored `typeof e.chart?.on === 'function'` so valid structural chart adapters with a top-level `on()` method and a nested non-function `chart.on` property attach directly instead of throwing.
3. **Tests (`packages/axylo/test/sync/n6-peer-sync.test.ts`):**
   - Added 3 focused regressions covering: (a) the exact reentrant throwing replacement (`inner:zoom` removes itself and throws) with full subscription draining, visual ownership cleanup, exact-record replacement variant, and subsequent detach/destroy; (b) `group.destroy()` continuing to drain remaining members and visual cursors after a thrown unsubscribe while preserving the first error; (c) `syncCharts` attaching a structural adapter with a nested non-function `chart.on` property.

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,624** | **+85** | `<= +120` (pass, 35 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,458** | **-904** | `<= +120` (pass) |
| `dist/stream.js` (`gzip -9c`) | 158,537 | **158,624** | +87 | ok |
| `dist/cartesian.js` (`gzip -9c`) | 127,233 | **126,298** | **-935** | ok |
| `dist/finance.js` (`gzip -9c`) | 124,680 | **123,753** | **-927** | ok |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,452** | +1,872 | — |
| `export { cartesian } from 'axylo/cartesian'` (`zlib-9`) | 127,120 | **126,222** | **-898** | `<= 127,000` (pass, 778 B headroom) |
| `export { candlestick } from 'axylo/finance'` (`zlib-9`) | 124,599 | **123,719** | **-880** | `<= 127,000` (pass, 3,281 B headroom) |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,494** | +1,904 | `<= 3,500` (**pass**, 6 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,684** | +1,164 | `axylo-dashboard` absent (`hasDash=false`, pass) |
| bare `import 'axylo/sync'`, `'axylo'`, `'axylo/static'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 75 passed (75)` (+3 new focused regressions).
- `npm run build` + exact `tests/dist/subpaths.test.ts` esbuild/zlib-9 consumer, GNU `gzip -9c` dist, and bare-import (`ignoreAnnotations: true`) checks: all pass as recorded above.
- Pending for Coordinator / Director: full Node suite, `npm pack`, packed Chrome (`tests/dist/n6-sync-dashboard.browser.test.ts`, `tests/dist/c5.browser.test.ts`), and fresh cross-provider review.

## Repair round 8: 1 review merge blocker (`sol-6.2-medium__20261127T153702Z/report.md`)

### What changed

1. **Restore method receiver on `SyncMemberOptions.resolveX` (`packages/axylo/src/sync/group.ts`):**
   - `matchXForMember` calls `member.o.resolveX(x)` directly rather than destructuring `resolveX` into a standalone function call, keeping `const { xValues } = member.o;` separate below it so method-form resolvers reading `this.xValues` (or other option fields) preserve their receiver.
2. **Test (`packages/axylo/test/sync/n6-peer-sync.test.ts`):**
   - Added a focused regression verifying a method-form `resolveX` reading `this.xValues` resolves matched `syncHover(2)` to the peer's own datum/cursor and clears on unmatched `syncHover(1)`.

### Updated sizes (gzip-9, measured)

| Artifact / Consumer | Baseline | Candidate | Δ | Target / Status |
|---|---:|---:|---:|---|
| `dist/axylo.js` (`gzip -9c`) | 158,539 | **158,624** | **+85** | `<= +120` (pass, 35 B headroom) |
| `dist/static.js` (`gzip -9c`) | 141,362 | **140,458** | **-904** | `<= +120` (pass) |
| `dist/sync.js` (`gzip -9c`) | 1,580 | **3,454** | +1,874 | — |
| `export * from 'axylo/sync'` (`zlib-9`) | 1,590 | **3,494** | +1,904 | `<= 3,500` (**pass**, 6 B headroom) |
| `export { createSyncGroup } from 'axylo/sync'` (`zlib-9`) | 1,520 | **2,688** | +1,168 | `axylo-dashboard` absent (`hasDash=false`, pass) |
| bare `import 'axylo/sync'` (`ignoreAnnotations: true`) | 0 | **0** | 0 | `0` raw bytes (pass) |

### Verification run here (ran and saw)

- `npm run typecheck`: exit 0 (`tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist`).
- `npx vitest run --configLoader runner --no-cache --no-fsModuleCache packages/axylo/test/sync packages/axylo/test/core/n6-dashboard-lifecycle.test.ts`: `Test Files 5 passed (5)`, `Tests 76 passed (76)` (+1 new regression).
- `npm run build` + exact `tests/dist/subpaths.test.ts` esbuild/zlib-9 full-sync/group-only/bare-sync and GNU `gzip -9c` dist checks: all pass as recorded above.
- Pending for Coordinator / Director: full Node suite, `npm pack`, packed Chrome (`tests/dist/n6-sync-dashboard.browser.test.ts`, `tests/dist/c5.browser.test.ts`), and fresh cross-provider review.
