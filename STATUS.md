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

Observed model and effort are read from harness metadata when a package finishes; "pending" until then.

| Package | Owner (requested → observed) | Files | State |
|---|---|---|---|
| Contracts review | Codex gpt-6.2-sol max → gpt-6.2-sol, max | read-only | Done; 14 findings, most accepted in simplified form (see commit 2047383) |
| Scales, ticks, time zones, formatting | Claude Opus 5.5 high → claude-opus-5-5, high | `src/scale`, `src/format`, tests | Done and committed (93 tests pass, verified by coordinator). Cross-review by Codex gpt-6.2-astra xhigh running: `wp/scale.review.md` |
| Benchmark harness, first version | Claude Opus 5.5 high → claude-opus-5-5 (effort to confirm from transcript) | `bench/` | Done and committed (17 harness tests pass, verified by coordinator). Reproduces uPlot and Chart.js with a noise band. Not yet cross-reviewed. Needs a readiness and readback hook in Axylo benchmark builds before Axylo can be admitted |
| Data layer and diagnostics | Codex gpt-6.2-sol xhigh → pending | `src/data`, `src/diagnostics`, tests | Running |
| Layout and drawing simplification | Codex gpt-6.2-sol xhigh → pending | `src/layout`, `src/simplify`, tests | Running |
| Canvas and SVG renderers, text layer, theme | Claude Opus 5.5 high → pending | `src/render`, `src/theme`, tests | Running |

Briefs and reports: `reviews/2026-11-18/impl/wp/`.

## Next action

As each package returns: run `npm run typecheck && npm test`, read its report, have the other provider review it (Opus xhigh reviews Codex code; Codex gpt-6.2-astra xhigh reviews Opus code), fix, commit. Then round 2: scene builders, the two mark renderers, the DOM text layer and figure, theme detection, and the chart core with the commit contract, which together make the M1 vertical slice.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
