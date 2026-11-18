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

Observed model and effort are read from harness metadata (Codex session rollouts, Claude subagent transcripts). Briefs, reports, reviews and fix briefs are in `reviews/2026-11-18/impl/wp/` (`<package>.prompt.md`, `.report.md`, `.review.md`, `.fix.prompt.md`, `.fix.report.md`).

| Package | Author (observed) | Cross-review | State |
|---|---|---|---|
| Contracts | Coordinator | Codex gpt-6.2-sol max | Revised several times as reviews came in; each change is its own commit |
| Scales, formatting | claude-opus-5-5, high | Codex gpt-6.2-astra xhigh: 14 findings | Fixed, verified, committed (143 tests) |
| Layout, simplification | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 14 findings | Fixed, verified, committed (40 tests) |
| Benchmark harness | claude-opus-5-5, high | Not yet reviewed | Committed (17 tests) |
| Data layer, diagnostics | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 18 findings | Fix run in progress (Codex) |
| Renderers, text layer, theme | claude-opus-5-5, high | Codex gpt-6.2-astra xhigh: 18 findings | Fix run in progress (Opus). Stylesheet changes are held back until the chart core releases `theme/css.ts` |
| View, scene | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 17 findings | Fix run in progress (Codex). Finding 10 (stack rebuilt over the whole frame per revision) deferred to M6: needs a `StackView` offset |
| Lookup, reader, messages | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 15 findings | Fix run in progress (Codex) |
| Chart core, part 1 | Claude Opus 5.5 high (running) | – | Running |

The type check is expected to be red until the four fix runs finish (new message keys, `DonutSlice.colorIndex`, point refs with `x`).

## Next action

1. As each fix run returns: read its report, run `npm run typecheck` and the package's tests, commit with targeted `git add` paths.
2. When the renderer fixes return: apply the stylesheet changes its report lists to `packages/axylo/src/theme/css.ts` (token part only), after chart core part 1 has finished with that file.
3. When chart core part 1 returns: verify (`npm run check`), commit, cross-review with Codex gpt-6.2-astra xhigh, then run the M1 measurement (canvas against SVG through `bench/`) and write the renderer decision record under `docs/decisions/`.
4. Then chart core part 2 (Opus 5.5 high): keyboard model, toolbar with legend toggles, zoom and pause controls, table view, announcements, focus handling, touch; the screen-reader pattern decision by accessibility-tree inspection only.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
