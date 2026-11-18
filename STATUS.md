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

Observed model and effort are read from harness metadata (Codex session rollouts, Claude subagent transcripts). Briefs, reports and reviews are in `reviews/2026-11-18/impl/wp/`.

| Package | Author (observed) | State | Cross-review |
|---|---|---|---|
| Contracts | Coordinator | Committed, revised once | Codex gpt-6.2-sol max: done, applied |
| Scales, ticks, time zones, formatting (`src/scale`, `src/format`) | claude-opus-5-5, high | Committed; 143 tests | Codex gpt-6.2-astra xhigh: 14 findings, all fixed and committed |
| Benchmark harness (`bench/`) | claude-opus-5-5, high | Committed; 17 tests | Not yet reviewed |
| Data layer and diagnostics (`src/data`, `src/diagnostics`) | gpt-6.2-sol, xhigh | Committed; 60 tests. Known fix: scatter must allow duplicate x | Opus 5.5 xhigh: running |
| Layout and simplification (`src/layout`, `src/simplify`) | gpt-6.2-sol, xhigh | Committed; fixes for the review running (Codex, `wp/layout.fix.*`) | Opus 5.5 xhigh: `wp/layout.review.md`, 14 findings |
| Renderers, text layer, theme (`src/render`, `src/theme`) | claude-opus-5-5, high | Committed; 33 Node and 45 browser tests | Codex gpt-6.2-astra xhigh: running (`wp/render.review.md`) |
| View and scene (`src/view`, `src/scene`) | gpt-6.2-sol, xhigh | Committed; 40 tests | Opus 5.5 xhigh: running |
| Lookup, reader model, messages (`src/lookup`, `src/reader`, `src/messages`) | gpt-6.2-sol, xhigh | Committed; 28 tests. Pending: scatter refs resolve by x; test helper needs the new `x` field | Opus 5.5 xhigh: running |
| Chart core, part 1: lifecycle, pipeline, figure DOM, all five entry points, compact, benchmark hook (`src/core`, `src/dom`, `src/index.ts`) | Claude Opus 5.5 high (running) | Running | – |

## Next action

1. As each review returns: save it under `wp/`, send its findings to the package's author to fix (Codex packages: a new `codex exec` run given the review file; Opus packages: resume the agent), verify with `npm run typecheck && npm test` (and `npm run test:browser` for browser code), commit with targeted `git add` paths.
2. When chart core part 1 returns: verify, commit, cross-review (Codex gpt-6.2-astra xhigh), then run the M1 measurement (canvas against SVG on the benchmark harness) and write the renderer decision record.
3. Then chart core part 2 (Opus 5.5 high): keyboard model, toolbar with legend toggles, zoom and pause, table view, announcements, focus handling, touch, the screen-reader pattern decision (by accessibility-tree inspection only; no reader can be run here).

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
