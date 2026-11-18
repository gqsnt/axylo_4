# Implementation status

Checkpoint file for the Axylo 1.0 build. Updated at every commit so work can resume after a restart. Plan: `docs/03-plan-typescript-release.md`.

## Model assignment (owner, 2026-11-18)

Code: Claude Opus 5.5 (effort high), Codex `gpt-6.2-sol` (effort xhigh). Design, review and other reasoning-heavy work: Claude Fable 5.2 (medium, the coordinator), Claude Opus 5.5 (xhigh), Codex `gpt-6.2-astra` (xhigh), Codex `gpt-6.2-sol` (max). Code written by one provider is reviewed by the other.

## Milestones

| Milestone | State |
|---|---|
| M0 Foundations | In progress: workspace, toolchain, contracts, test and build scaffolding done. Contracts under review. Benchmark harness and acceptance matrix not started. |
| M1 Vertical slice | Not started |
| M2 Faithful data | Not started |
| M3 Reading the chart | Not started |
| M4 Accessibility | Not started |
| M5 Bar, area, donut, compact, scatter | Not started |
| M6 Updates and scale | Not started |
| M7 Distribution and documentation | Not started |
| M8 Release | Not started |

## Work packages

Observed model and effort are read from harness metadata (Codex session rollouts, Claude subagent transcripts).

| Package | Owner (requested → observed) | Files | State |
|---|---|---|---|
| Contracts review | Codex gpt-6.2-sol max → gpt-6.2-sol, max | read-only | Done; applied in commit 2047383 |
| Scales, ticks, time zones, formatting | Claude Opus 5.5 high → claude-opus-5-5, high | `src/scale`, `src/format` | Committed. Reviewed by Codex gpt-6.2-astra xhigh (`wp/scale.review.md`: 2 blocking, 12 major). Fixes in progress by the original agent |
| Benchmark harness, first version | Claude Opus 5.5 high → claude-opus-5-5, high | `bench/` | Committed. Not yet cross-reviewed. Needs a readiness and readback hook in Axylo benchmark builds |
| Data layer and diagnostics | Codex gpt-6.2-sol xhigh → gpt-6.2-sol, xhigh | `src/data`, `src/diagnostics` | Committed (60 tests). Review by Opus 5.5 xhigh running. Known fix: scatter must allow duplicate x |
| Layout and drawing simplification | Codex gpt-6.2-sol xhigh → gpt-6.2-sol, xhigh | `src/layout`, `src/simplify` | Committed (24 tests). Review by Opus 5.5 xhigh running |
| Canvas and SVG renderers, text layer, theme | Claude Opus 5.5 high → pending | `src/render`, `src/theme` | Running |
| View and scene building | Codex gpt-6.2-sol xhigh → pending | `src/view`, `src/scene` | Running |
| Lookup, reader model, messages | Codex gpt-6.2-sol xhigh → pending | `src/lookup`, `src/reader`, `src/messages` | Running |

Briefs, reports and reviews: `reviews/2026-11-18/impl/wp/`.

## Next action

1. As reviews return: send the findings to the package's author to fix (Codex packages: a new `codex exec` run with the review file; Opus packages: resume the agent), verify, commit.
2. When renderers, view/scene and lookup/reader are in: dispatch the chart core (commit contract, figure DOM, resize, theme wiring, tooltip, keyboard, toolbar, table, benchmark hook) to Opus 5.5 high, which gives the M1 vertical slice for `line`.
3. Then the M1 measurements: canvas against SVG on the benchmark harness, and the decision record.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
