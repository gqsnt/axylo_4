# Implementation status

Checkpoint file for the Axylo 1.0 build. Updated at every commit so work can resume after a restart. Plan: `docs/03-plan-typescript-release.md`.

## Model assignment (owner, 2026-11-18)

Code: Claude Opus 5.5 (effort high), Codex `gpt-6.2-sol` (effort xhigh). Design, review and other reasoning-heavy work: Claude Fable 5.2 (medium, the coordinator), Claude Opus 5.5 (xhigh), Codex `gpt-6.2-astra` (xhigh), Codex `gpt-6.2-sol` (max). Code written by one provider is reviewed by the other.

## Milestones

The plan's milestones were built in parallel by module, not strictly in order, because every stage had a fixed contract. State by plan milestone:

| Milestone | State |
|---|---|
| M0 Foundations | Done: workspace, toolchain, contracts, benchmark harness (first version), build and size scripts. Not done: the acceptance matrix as data, CI workflows (no remote exists) |
| M1 Vertical slice | Charts render end to end with both mark renderers. Renderer comparison: running (`bench/results/m1-renderer-comparison.md` when done). Interaction pattern: decided without a screen reader, `docs/decisions/0001-plot-interaction-pattern.md` |
| M2 Faithful data | Data layer, diagnostics, temporal kinds, formatting, domains: built and cross-reviewed |
| M3 Reading the chart | Title, states, pointer tooltip, label fitting: built. Legend, full tooltip, reference labels: in progress (chart core part 2, design pass 1) |
| M4 Accessibility | In progress (chart core part 2). Screen-reader rehearsal cannot be done here |
| M5 Bar, area, donut, compact, scatter | All render through the shared pipeline. Type-specific acceptance tests, the palette, and donut legend: in progress or not started |
| M6 Updates and scale | update, append, zoom, simplification: built. Not started: performance tuning against budgets (first indication: about 84 ms for 100,000 points in the development build against about 12 ms for uPlot), the deferred stack rebuild, the scatter worst-case pick |
| M7 Distribution and documentation | Not started: React adapter, documentation site, packed-distribution tests, size check against targets |
| M8 Release | Not started |

## Work packages

Observed model and effort are read from harness metadata (Codex session rollouts, Claude subagent transcripts). Briefs, reports, reviews and fix briefs are in `reviews/2026-11-18/impl/wp/`.

| Package | Author (observed) | Cross-review | State |
|---|---|---|---|
| Scales, formatting | claude-opus-5-5, high | Codex gpt-6.2-astra xhigh: 14 findings | Fixed, committed |
| Layout, simplification | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 14 findings | Fixed, committed |
| Data layer, diagnostics | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 18 findings | 17 fixed, 1 left by decision; committed |
| Renderers, text layer, theme | claude-opus-5-5, high | Codex gpt-6.2-astra xhigh: 18 findings | Fixed including the stylesheet; committed |
| View, scene | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 17 findings | 16 fixed, finding 10 deferred to M6; committed |
| Lookup, reader, messages | gpt-6.2-sol, xhigh | Opus 5.5 xhigh: 15 findings | 14 fixed, finding 12 partly open (dense coincident scatter pick); committed |
| Chart core, part 1 | claude-opus-5-5, high | Codex gpt-6.2-astra xhigh: running (`wp/core1.review.md`) | Committed. Unit 483 pass, browser all pass |
| Benchmark harness | claude-opus-5-5, high | Not yet reviewed | Committed; M1 renderer comparison running (same agent) |
| Design pass 1 (labels wrap to three lines, reference labels, horizontal bar order, scatter x domain) | Codex gpt-6.2-sol xhigh (running) | – | Running (`wp/design-pass-1.*`) |
| Chart core, part 2: tooltip, keyboard proxy, toolbar and legend, zoom gestures, table, announcements | Claude Opus 5.5 high (running) | – | Running |

## Next action

1. When the core part 1 review returns: send its findings to the part 2 agent (it owns the same files) once part 2 has reported, or sooner if a finding blocks it.
2. When design pass 1 returns: verify, commit, run `node scripts/gallery.mjs light canvas` and look at the image.
3. When the renderer comparison returns: read `bench/results/m1-renderer-comparison.md`, write `docs/decisions/0002-mark-renderer.md` from its numbers.
4. When part 2 returns: verify (`npm run check`), commit, cross-review with Codex gpt-6.2-astra xhigh.
5. Then: palette design (A5 thresholds, both schemes), performance work against the budgets using the profile summaries, the acceptance matrix as data, the React adapter, documentation, packed-distribution tests.

## Known limits that no agent can close

Screen-reader rehearsal (A3), real Safari and iOS, a real Android phone, and Firefox/WebKit runs need the owner's devices or a CI service. Only system Chrome is available here. These are recorded as not done wherever they apply.
