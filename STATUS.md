# Implementation status

Checkpoint for the Axylo 1.0 build: what is true now and what is left. Rewritten on 2026-11-20 for the hand-off to a Codex-only coordinator (`HANDOFF-CODEX.md`). The history of how each piece got here is in `git log` and in `reviews/2026-11-18/` and `reviews/2026-11-19/` (briefs, reports, reviews, each with the observed model and effort). Update this file at every commit so work can resume after a restart.

## Where it stands

**Both renderer benchmark families finished on 2026-11-21 at 08:32 CET.** The run without idle waits used the sealed b643862 artifact and Chrome 158.0.8127.36. Across controls, pilots and endpoints, software completed 64 jobs and 2,400 timed runs, and the RTX 2060 SUPER GPU completed 40 jobs and 1,500 timed runs. All timed runs succeeded. Zero of the 17 endpoints qualified for the release renderer decision because every endpoint job had blocks at or above the load limit. Both decision files report `NO DECISION YET`.

No renderer benchmark is running. The log is `bench/results/run-2026-11-19.log`. The exploratory ledger, pilots and decisions are in `bench/decision/no-idle-2026-11-21/`. The ledger names each raw record in `bench/history/`, which also retains the early interrupted control (`20261121T042009Z-first-trend-aa-axylo-canvas-db18.json`). The next command for release renderer evidence is `bash bench/results/run-2026-11-19.sh` on an idle machine.

- **Product:** feature-complete for 1.0 against `docs/02-product-spec.md`: line, area, bar, scatter, donut and a compact variant (line, area, bar); rows, wide rows and typed columns; calendar dates, instants and wall-clock times; `update`, `append` with a window and Pause, zoom and pan on continuous x axes, the Select range toggle (two clicks); 29 diagnostics (`AX1xx`); name, summary, table, keyboard navigation, tooltip, strip readout; theming from the page; SVG marks by default (canvas internal); no runtime dependencies.
- **Size** (spec DX7, packed files, `node scripts/size.mjs --no-build`): everything 115.48 KiB (target 116), line only 96.32 KiB (target 98) at 1ceaba9. 573 of the last 650 bytes saved come from import order in `packages/axylo/src/index.ts`, which can shift with later edits: re-measure after every source change.
- **Tests on this machine** (latest full coordinator runs, on a build of 1ceaba9 or later; library sources unchanged since 1ceaba9): Node suite 1854; browser suites on SVG 1010 passed, 1 skipped; `chart` + `a11y` on canvas 319 passed, 4 skipped; `tests/dist` Node 90, browser 26; docs browser 175; rehearsal harness 120. Firefox 159 and WebKit 27.2 (Playwright builds; WebKit is not Safari): every browser suite passes; about 180 tests per engine report themselves not run because they need Chrome-only tooling (accessibility tree through CDP, multi-touch, pen, heap inspection).
- **Recorded evidence** (`acceptance/results/*.json` with provenance sidecars, not in git): six configurations recorded at 1e38333, all with zero failures. They are stale for the current tree and must be recorded again at the release commit.
- **Acceptance matrix** (`acceptance/matrix.json`, report `acceptance/report.md`): reachable when every cited result passes: 112 pass, 164 weak (each with its gap written), 32 pending, 11 cannot be verified here (all waived by the owner), 257 not applicable. Gap list: `reviews/2026-11-18/impl/wp/matrix-merge3.report.md`.
- **Release check** (`node acceptance/check.mjs --release --results <six files>`): the owner's gate (below) is implemented (d3c726a). It blocks today on stale results and on the unmeasured performance budgets only.
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

## What is left for 1.0, in order

1. **Performance.** The release renderer decision needs eligible controls, pilots and endpoint evidence. The standard script waits for ten idle minutes before each session. Every measured block needs a one-minute load under 1.0. Before a future run after a library source change, build a new artifact with `node bench/build.mjs` and update `A=` in the script. Measure the budget endpoints outside the renderer families and run the Phase 1 timings (see `research/README.md`). Evaluate P1–P8, settle the renderer decision if the evidence allows, update the timing table in `docs/05-comparison.md`, and fix missed budgets.
2. **The release commit.** Freeze it; `npm run build`, `node scripts/pack.mjs`, `node apps/docs/build.mjs`; record the six configurations on a quiet tree; repeat the agent rehearsal there; the release check must exit 0; rebuild the docs so the conformance page shows the recorded results.
3. **Version, changelog date, tag, publish**: each only on the owner's explicit word. So is every push.

## Known limits

- Not testable on this machine: Safari (macOS, iOS), Edge, Windows, macOS, a real phone. No screen reader was run (owner's decision).
- GPU rendering can be tested here (headless Chrome with `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, or headed); the benchmark's gpu family does this.
- Documented product limits: `apps/docs/pages/stability.md`, "Known limits".
- Open, not scheduled: values around 1e-43 and smaller can get mismatched or missing ticks; a click does not pin in a strip readout on line charts under about 170 px of plot (decision 0004 allows it); the scatter lookup build got slower in its author's measurement (200,000 points: 44.8 to 78.1 ms), to weigh in the performance pass; view/scene finding 10 (stack rebuilt over the whole frame per revision) deferred to performance work.
- `bench/history/20261118T03503*` (two files) are left uncommitted on purpose; `.claude/launch.json` is a local editor file.
