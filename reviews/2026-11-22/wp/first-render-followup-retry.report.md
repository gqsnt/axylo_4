# Completed first-render follow-up review

Separate read-only same-provider Codex review. Requested model `gpt-6.1-sol`, effort `xhigh`. Observed model `gpt-6.1-sol`, effort `xhigh` in rollout `01a201c3-ff74-7c12-8797-68ebdcfd3c83`.

One actionable provenance correction remains. I found no additional defect in the inspected render interface or benchmark compatibility logic.

- **Correct the original M1 attribution.** [Investigation line 3](/home/canarit/projects/axylo/bench/results/p1-investigation-2026-11-22.md:3) associates the 17.36 ms result with `a63bbeea`. Its [raw record](/home/canarit/projects/axylo/bench/history/20261118T023053Z-first-3x120-uplot-vs-axylo-svg-7ee1.json:90) records checkout `e6e0e195`, dirty library sources and production bundle hash `01f2d3271feea13d…`. Replace that attribution with the exact run and bundle reference. The record identifies measured bytes; it does not establish a clean library source revision. The later clean `a63bbeea` sweep is a separate measurement.

The other requested checks support these conclusions:

- **Shared interface — observed diff and successful typecheck.** `contracts.ts` changes comments only; `MarkRenderer` retains both kinds and the four-argument drawing methods. The controller uses `Pick<MarkRenderer, 'kind' | 'draw'>`, interaction takes `MarkRenderer`, and SVG implements it. `interaction.ts` has no diff from `bb2826a`. No contract change is needed. See [contract](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:565), [controller](/home/canarit/projects/axylo/packages/axylo/src/core/controller.ts:96), [interaction](/home/canarit/projects/axylo/packages/axylo/src/dom/interaction.ts:458) and [SVG](/home/canarit/projects/axylo/packages/axylo/src/render/svg.ts:316).

- **Shipping paths — static wiring plus existing-bundle inspection.** Every chart composition selects SVG through [chart creation](/home/canarit/projects/axylo/packages/axylo/src/core/chart.ts:65). Canvas mark implementation and selector are gone; all SVG mark handlers remain. The four existing distribution bundles contain neither the old selector nor Canvas mark class. Utility canvases remain for [text measurement](/home/canarit/projects/axylo/packages/axylo/src/core/environment.ts:91) and [color conversion](/home/canarit/projects/axylo/packages/axylo/src/theme/resolve.ts:297).

- **Artifact compatibility — static build logic and mocked adapter execution.** Older sealed artifacts retain their own adapters, which work without requesting capabilities. This includes the original Canvas/SVG artifact and the early SVG-only artifact. Fresh builds detect Canvas source presence, write capabilities and conditionally include the Canvas adapter. The current adapter sends `__renderer` only for Canvas-capable sources and rejects Canvas requests otherwise. See [builder](/home/canarit/projects/axylo/bench/build.mjs:105) and [adapter](/home/canarit/projects/axylo/bench/src/adapters/axylo-common.js:179). Fresh rebuilding and browser drawing were not exercised.

- **Two-build guard — observed pure-function checks.** The exception covers only an *absent* Canvas adapter when both artifacts have capabilities and another adapter is selected. Changed Canvas bytes present on both sides, selected adapters, unrelated adapters and page files still fail comparison. Old/current sealed artifacts with different adapter generations remain rejected without the override. See [guard](/home/canarit/projects/axylo/bench/run.mjs:58). The added [test](/home/canarit/projects/axylo/bench/test/provenance.test.mjs:47) covers its basic cases.

- **Newer history — observed verification.** All 25 table records have matching medians, manifests and file hashes, with 20 complete pairs each. The SVG-only snapshot matches all 100 recorded compiled inputs at `298b29e`; the final candidate matches all 100 current compiled inputs. Dirty snapshots should continue to be identified by artifact and source hash.

`npm run typecheck` exited successfully. Final read-only verification output:

```text
Existing sealed artifacts: 25 integrity checks passed
Investigation table: 25 records, medians, manifests and file hashes verified
```

Additionally, 10 guard assertions and nine mocked adapter checks passed. No files or build outputs were changed. Build-producing tests and browser benchmarks were not run. Recorded timings support the reported observations, not isolated causal savings. P1 remains above the specified 10 ms budget; the proposed 30 ms limit is still a proposal, as [the report acknowledges](/home/canarit/projects/axylo/bench/results/p1-investigation-2026-11-22.md:68).
