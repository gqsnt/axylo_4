<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a6075efd5cba2d5e5, resumed. Saved by the coordinator from the hand-back. -->

## Report: short pass on the bench harness

All three items are done. Pure tests 97/97 and browser tests 17/17 pass. All edits are in `bench/**`; nothing is committed or staged. The two runs below are smoke runs under load (2 blocks each); their numbers are not evidence, and both sessions were correctly recorded as ineligible.

## 1. Library restructure (37ed261)

- **Two production builds in each artifact.** `bench/build.mjs` builds them with the source checkout's own `PRODUCTION`/`DEVELOPMENT` and `stylesheetPlugin`. The stylesheet is evaluated and minified from the same source snapshot as the bundles.
  - `axylo/axylo.iife.min.js` is the release copy (`__BENCH__` false, no hook). It is byte-identical to the recipe and to `packages/axylo/dist/axylo.iife.min.js`: 106,833 B gzip, the script-tag size in your report.
  - `axylo/axylo.bench.iife.min.js` is the instrumented build (`{ __DEV__: 'false', __BENCH__: 'true' }`). Every workload uses it by default (`build=prod`).
  - `axylo/axylo.iife.js` is the development build.
  - `manifest.source.recipe` records the defines of each.
- **Release runs are sanity runs only.** `build=release` waits two frames instead of a library signal, and admits the run only if the named renderer drew marks. Its limit is labelled "no timing for any endpoint", and endpoint results refuse runs that used any build other than the instrumented one.
- **Every run records the bundle it loaded** (`result.adapter.bundle`). Profiles read the matching source map.
- **Marginal Canvas size:** `tools/canvas-cost.mjs` now uses the shipped recipe and reports 2,276 B gzip at the current source.

## 2. GPU mode

- **Launch:** `run.mjs --gpu` runs headless with `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`; `--headed` uses the desktop (DISPLAY :0).
- **Raster record:** every session stores `environment.raster`: the WebGL unmasked renderer, Chrome's feature status for 2D canvas, rasterization and compositing (CDP `SystemInfo.getInfo`), the GPU devices, the GL strings and the flags.
- **Refusal:** the label is "gpu" only with a hardware WebGL renderer and accelerated 2D canvas and rasterization. A `--gpu` session that comes out as SwiftShader is refused, and any single run whose page reports SwiftShader is recorded as an error.
- **Separate environments:** the raster mode is part of the environment key, so GPU and software sessions never serve the same family. I took the pixel ratio out of the key and check it per endpoint instead, because the gpu family has DPR 1 and DPR 2 endpoints.
- **Second family "gpu"**, 8 endpoints at 99.375%, same rules:
  - gpu-resize-100k, plus a late-runs endpoint on the same job;
  - gpu-resize-24;
  - gpu-dpr2-P1 and gpu-dpr2-P2-100k (P1 and P2 thresholds);
  - gpu-dpr2-P5 (P5 thresholds);
  - the DPR 2 dashboard's renderer and GPU process memory.
  The resize and memory endpoints get pilot-frozen thresholds.
- **Interpretation for you to confirm:** I counted DPR 2 P1, DPR 2 P5 and the two resizes as the gpu family's everyday workloads. A resize is won only with its task-time win and no more late runs, the way P3 is.

A headed check during development briefly opened a Chrome window on the desktop.

**Software smoke run** (`--endpoint P1`):
```
raster: mode software, requested "default (software here)", flags "Playwright defaults"
webglRenderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
canvas2d unavailable_software, rasterization disabled_software, gpuCompositing disabled_software
browser: Chrome 157.0.8103.78 headless; host 13th Gen Intel Core i5-13600K, 20 cores; refresh 59.88 Hz
bundle: axylo/axylo.bench.iife.min.js; load at blocks 3.47, 3.43 → eligible: false
```

**GPU smoke run** (`--endpoint gpu-dpr2-P1 --gpu`):
```
raster: mode gpu, requested gpu, flags "headless, --enable-gpu --use-angle=gl --ignore-gpu-blocklist"
webglRenderer: ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 2060 SUPER/PCIe/SSE2, OpenGL ES 3.2)
canvas2d enabled, rasterization enabled, gpuCompositing enabled
devices: 4318:7942 driver 595.99.02, and 32902:42880; skiaBackendType GaneshGL; glImplementationParts (gl=egl-angle,angle=opengl)
page devicePixelRatio 2, refresh 59.88 Hz; all 8 runs ok; load at blocks 3.75, 4.09 → eligible: false
```

## 3. Library hooks

The adapter reads each hook when present and reports "not available" otherwise:

| Hook | Expected place in `Probe`/`attachHooks` | What the adapter does with it |
|---|---|---|
| Run starts | `series[i].breaks` | builds full index paths |
| Plot rectangle | `describe().plot` | P4 on the Canvas renderer |
| Owned bytes | `memory()` returning `{ bytes, buffers }` | P7-mem |
| Window-relative kept indexes | `series[i].keptBasis === 'window'` | uses the stream's kept list |

The last name is my choice; please pass it to the core's author or tell me theirs.

## The two printed plans (`node bench/decision.mjs plan`)

Durations are estimates from smoke runs under load. One artifact serves both families.

**renderer** (software, 9 endpoints at 99.44%, 8 jobs), about 3.2 h in total:

| Step | Duration |
|---|---|
| `controls`, three separate sessions | ~51 min each |
| `pilot` | ~14 min |
| `endpoints` | ~25 min (~31 min with a process per run) |
| `decide` | seconds |

**gpu** (8 endpoints at 99.38%, 5 jobs; every step takes `--family gpu`), about 2.2 h in total:

| Step | Duration |
|---|---|
| `controls`, three separate sessions | ~35 min each |
| `pilot` | ~9 min |
| `endpoints` | ~17 min (~21 min with a process per run) |
| `decide` | seconds |

For the gpu family, the pilot freezes the thresholds of gpu-resize-100k, gpu-resize-24 and the two memory endpoints.

## Test runs

Pure tests (`node --test bench/test/*.test.mjs`):
```
ℹ tests 97
ℹ pass 97
ℹ fail 0
```
Browser tests (`node --test --test-concurrency=1 bench/test/browser/*.test.mjs`):
```
ℹ tests 17
ℹ pass 17
ℹ fail 0
ℹ duration_ms 96314.658386
```
The new browser tests cover the GPU refusal and the hardware renderer (the hardware part skips itself on a machine without a usable GPU), and the release-build sanity path. One existing test's label regex was updated for the new build name.

Main files: `bench/build.mjs`, `bench/lib/driver.mjs` (`GPU_FLAGS`, `rasterInfo`, `rasterLabel`), `bench/run.mjs`, `bench/src/decision.js`, `bench/decision.mjs`, `bench/src/adapters/axylo-common.js`, `bench/README.md`.

