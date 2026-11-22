# Implementation status

Checkpoint for the Axylo 1.0 build: what is true now and what is left. Rewritten on 2026-11-20 for the hand-off to a Codex-only coordinator (`HANDOFF-CODEX.md`). The history of how each piece got here is in `git log` and in `reviews/2026-11-18/` and `reviews/2026-11-19/` (briefs, reports, reviews, each with the observed model and effort). Update this file at every commit so work can resume after a restart.

## Where it stands

**The 2026-11-21 renderer run counts as release evidence.** On the sealed b643862 artifact and Chrome 158.0.8127.36, software completed 2,400 timed runs and the RTX 2060 SUPER GPU completed 1,500. The owner dropped the idle-machine rule (4664bd1). Load is recorded for context.

**SVG is the sole renderer for 1.0.** The software family selected SVG under rule 3. The GPU family returned no decision. The owner confirmed SVG only on 2026-11-22. The internal canvas renderer and switch have been removed. The baseline budget runs and SVG-only verification finished. See the current checkpoint below.

- **Product:** feature-complete for 1.0 against `docs/02-product-spec.md`: line, area, bar, scatter, donut and a compact variant (line, area, bar); rows, wide rows and typed columns; calendar dates, instants and wall-clock times; `update`, `append` with a window and Pause, zoom and pan on continuous x axes, the Select range toggle (two clicks); 29 diagnostics (`AX1xx`); name, summary, table, keyboard navigation, tooltip, strip readout; theming from the page; SVG marks; no runtime dependencies.
- **Candidate size** (spec DX7): everything 115,793 B (113.08 KiB), line only 97,002 B (94.73 KiB). Canvas removal with the shared renderer interface preserved saved 2,462 B and 1,628 B in the matched size snapshots.
- **SVG-only verification:** 1,854 Node tests, 1,162 Chrome browser tests, 794 passed and 193 skipped in each of Firefox and WebKit, 90 packed-package Node tests, 26 packed-package browser tests, 175 docs browser tests, 121 rehearsal harness tests, 44 acceptance checker tests, 98 benchmark Node tests, and 17 benchmark browser tests. The isolated final canvas suite on ddb712f passed 319 with 4 skipped. Logs are under `acceptance/results/verify-svg-only/` and `acceptance/results/verify-ddb712f/`.
- **Recorded evidence** (`acceptance/results/*.json` with provenance sidecars, not in git): six configurations recorded at 1e38333, all with zero failures. They are stale for the current tree and must be recorded again at the release commit.
- **Acceptance matrix** (`acceptance/matrix.json`, report `acceptance/report.md`): reachable when every cited result passes: 112 pass, 164 weak (each with its gap written), 32 pending, 11 cannot be verified here (all waived by the owner), 257 not applicable. Gap list: `reviews/2026-11-18/impl/wp/matrix-merge3.report.md`.
- **Release check** (`node acceptance/check.mjs --release --results <six files>`): the owner's gate (below) is implemented (d3c726a). The release check is on hold under the owner's P1 stop rule. P1 and P7 lifecycle exceeded their limits. The remaining work is comparison timing, full source verification, six frozen acceptance configurations and the release rehearsal.
- **Agent rehearsal (DX12):** 24 of 24 at release candidate 1e93128 (Codex CLI gpt-6.2-sol and Claude Code claude-opus-5-5, three uncoached attempts on each of four tasks; the owner's rule is 2 of 3 per cell), accepted as the release record (`reviews/2026-11-19/wp/rehearsal-analysis.md`); records in `rehearsal/records/release-1e93128/` (on disk, not in git). It must be repeated at the release commit.
- **Comparison with ten libraries:** `docs/05-comparison.md` (Phase 1 harness rerun with Axylo on 2026-11-19, every step except timing).
- **Docs site:** `apps/docs` (build `node apps/docs/build.mjs`), including the generated conformance page, known limits and the rehearsal's record.
- **Release notes:** `CHANGELOG.md`, drafted under "Unreleased"; the version and date are the owner's.
- **Remote:** `origin` = `https://github.com/gqsnt/axylo_4` (private). `main` was pushed once, at 34ce116 (2026-11-19); later commits are local only. CI cannot run (GitHub billing on the owner's account): the owner knows and does not want it checked; local runs are the check.

## Owner's decisions (binding)

| Date | Decision |
|---|---|
| 2026-11-18 | Palette candidate B (9861f54). Licence MIT, holder "The Axylo authors". No React adapter in 1.0 (adapters for React, Vue, Svelte later; plain TypeScript now). No screen-reader rehearsal for 1.0: say so plainly, do not block on it (A3 waived). Playwright Firefox and WebKit allowed. Memory budget P7: 1.1 × the caller's two columns. Spec questions that restate implemented behaviour were settled in the spec (eb2de43). Stacks: a series with no row at an x is a missing component, "incomplete" (af21368). |
| 2026-11-19 | Size targets 116 KiB everything, 98 KiB line only (streaming as an opt-in import is the first size item after 1.0). Review rounds on the controller and interaction layers stopped after round 3; leftovers are documented limits. Rehearsal rule: at least 2 of 3 counted attempts per agent-and-task cell. Release gate "documented gaps": a cell passes release mode if it passes, is not applicable, is weak with a written gap and all its cited results passing, or is waived; failures, stale or missing results and unmeasured budgets block. DX9 waived for 1.0 only (no previous release). CI: do not check it; test locally. |
| 2026-11-20 | The project is handled by Codex only from now on (`HANDOFF-CODEX.md`). |
| 2026-11-21 | The 2026-11-21 benchmark run counts as release evidence. The idle-machine rule is dropped (4664bd1). Record the measured load for context. |
| 2026-11-22 | SVG is the sole renderer for 1.0. Canvas leaves the bundle. Recurring performance improvement follows 1.0. |

## Checkpoint 2026-11-21 15:40 local (owner restarting; resume later on their word)

The idle-machine rule is dropped (4664bd1, the owner's decision). Done since, in `bench/results/budgets-2026-11-21.log`:
- **Renderer, software family, decided:** rule 3, nothing separates the renderers within the noise; **SVG stays the default and canvas is removed from the 1.0 bundle** (it costs 2,269 B gzipped, more than 512 B). Decision file `bench/decision/no-idle-2026-11-21/decision-renderer-20261121T143350Z.json`. Removing canvas is a library change still to make (it frees about 2.2 KiB of size margin); update decision 0002 from provisional.
- **Renderer, GPU family:** no decision yet (an order effect on the GPU memory endpoint; canvas faster on both resizes beyond tolerance but not by the worthwhile margin). `decision-gpu-20261121T143402Z.json`.
- **P2 at 1,000,000 points: met.** Axylo 82.3 ms median of 20 (budget 250 ms); uPlot 20.1 ms. Record `bench/history/20261121T143403Z-first-1x1000000-uplot-vs-axylo-efcc.json`.
- **P4: interrupted** at block 11 of 20 by the owner's restart (partial record `20261121T143530Z-hover-1x100000-uplot-vs-axylo-8100.json`, not a result; the finished blocks read about 15.9 ms for Axylo against a 16.7 ms budget).
- **Not run yet:** P7-mem, P7-lifecycle.

Next command (from the repository root): `A=bench/artifacts/20261119T091624Z-b643862f-b78698; for e in "P4 --baseline uplot --candidate axylo" "P7-mem --aa axylo" "P7-lifecycle --aa axylo"; do node bench/run.mjs --endpoint $e --artifact "$A"; done` (P7-lifecycle is the long one, probably 30 to 60 minutes). Then the P1 to P8 table in `bench/results/budgets-2026-11-21.md`.

## Current checkpoint

Baseline P1–P8 are recorded in `bench/results/budgets-2026-11-21.md`. P4 passed at 16.10 ms. P7 owned buffers passed at 1,023,304 bytes. The P7 create–destroy benchmark exceeded the 1% heap-growth gate in 40 of 40 runs, with median growth of about 1.146% and no median listener, observer or node growth. P1 and P8 also missed their baseline budgets.

The SVG-only verification is complete. The first full Chrome try hit browser launch errors with a long temporary path. A short path resolved them. The rehearsal harness uses persistent scratch outside the checkout, as required by its isolation check. The SVG-only artifact is `bench/artifacts/20261122T042403Z-bb2826ac-ec008a`. The read-only SVG review found no actionable issues (`reviews/2026-11-22/wp/svg-only.report.md`).

The daily-revenue third input is now registered and hashed for the release rehearsal. All 121 rehearsal harness tests passed and the independent review found no actionable issues.

The P1 history sweep and production CPU profiles are in `bench/results/p1-investigation-2026-11-22.md`. The first-render increases cluster around the theme, controller and interaction changes. The largest named cost on the UTC trend was discovering the viewer's default time zone.

The 06:32 restart on 2026-11-22 interrupted the P3 run and follow-up review. The partial P3 record `20261122T053039Z-stream-w600-aa-axylo-82fa` is archived. It has no budget verdict. The completed final-candidate endpoints are P1 27.40 ms (miss), P2 39.64 ms and 79.81 ms (met), and P8 70.74/68.38 ms (met). Final packed sizes are 115,793 B and 97,002 B (both met). The sealed artifact is `bench/artifacts/20261122T052512Z-de0f0ab3-d46057`. It survived the restart and its file hashes verify.

The independent review found two compatibility issues and a provenance wording issue. The shared renderer interface is restored, the selected adapters share bytes across capability variants, and the SVG-only source snapshot is identified. The completed follow-up verified those fixes and traced the 17.36 ms M1 baseline to the original dirty checkout and exact bundle. That attribution is corrected. Typecheck and 99 benchmark Node tests passed.

All P1–P8 endpoints on the sealed SVG-only candidate and the original-artifact spot checks are recorded in `bench/results/budgets-2026-11-21.md`. P1 is 27.40 ms against 10 ms. P7 lifecycle crossed the 1% heap gate in all 40 runs, with 1.169% and 1.168% median growth and zero median listener, observer or DOM-node increases. P2, P3, P4, P5, P6, P7 owned buffers and P8 met their measured budgets. The independent evidence review checked 21 complete records and 840 timed runs. The matrix cites the raw budget records and the generated report identifies the benchmark evidence for manual review.

The timing comparison is running. Source verification on `771c47a` passed typecheck, 1,856 Node tests and 1,162 Chrome tests. Firefox passed 794 with 193 skipped. WebKit and the remaining suites are still running.

Next command: `tail -n 10 acceptance/results/verify-perf/comparison-default.log; cat acceptance/results/verify-perf/full/exits`. When both jobs finish, fill the comparison timing table and commit the freeze. Then run `bash acceptance/results/verify-perf/record-freeze.sh` and the release rehearsal. Hold the release check under the P1 stop rule.

## What is left for 1.0, in order

1. **Performance.** Record the last canvas browser suite, remove canvas from the library and build, measure the packed size, and finalize decision 0002. Profile and address P1, then P8 and P4 if it misses. Rebuild a sealed artifact after source changes. Re-measure P1–P8, compare P1/P3/P5 against the original artifact, and rerun the Phase 1 timing comparison. Update the acceptance matrix, docs and changelog from the recorded evidence.
2. **The release commit.** Freeze it; `npm run build`, `node scripts/pack.mjs`, `node apps/docs/build.mjs`; record the six configurations on a quiet tree; repeat the agent rehearsal there; the release check must exit 0; rebuild the docs so the conformance page shows the recorded results.
3. **Version, changelog date, tag, publish**: each only on the owner's explicit word. So is every push.

## Known limits

- Not testable on this machine: Safari (macOS, iOS), Edge, Windows, macOS, a real phone. No screen reader was run (owner's decision).
- GPU rendering can be tested here (headless Chrome with `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or headed); the benchmark's gpu family does this.
- Documented product limits: `apps/docs/pages/stability.md`, "Known limits".
- Open, not scheduled: values around 1e-43 and smaller can get mismatched or missing ticks; a click does not pin in a strip readout on line charts under about 170 px of plot (decision 0004 allows it); the scatter lookup build got slower in its author's measurement (200,000 points: 44.8 to 78.1 ms), to weigh in the performance pass; view/scene finding 10 (stack rebuilt over the whole frame per revision) deferred to performance work.
- `bench/history/20261118T03503*` (two files) are left uncommitted on purpose; `.claude/launch.json` is a local editor file.
