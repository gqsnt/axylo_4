# Review: Axylo internal contracts, before any implementation exists

You are an independent reviewer. Read-only: do not create, edit or delete files; put everything in your final message.

Axylo is a browser charting library about to be implemented by several coding agents working in parallel. They will code against one shared types file. Your job is to find what in that file will make the build fail, force rework, or make a spec criterion impossible, and to give the exact replacement TypeScript.

Read, in this order:
1. `packages/axylo/src/core/contracts.ts` (the file under review)
2. `packages/axylo/src/public.ts` (public API types)
3. `docs/02-product-spec.md` (acceptance criteria F, L, I, A, C, DX, P and the diagnostic registry in 3.5, the type matrix in 3.6, compact variant in 3.7)
4. `docs/03-plan-typescript-release.md` sections 1.5 (commit contract), 2 (architecture, invalidation)

Check specifically:
- **Frame.** Can it represent, without loss: long rows, wide rows and borrowed typed columns of 1,000,000 points; explicit null, invalid values, a series with no row at an x, and absent steps (F2, join rule); the three temporal kinds (F4); stacked bar and area with mixed signs and incomplete stacks (F10); donut; scatter; streaming `append` with a `keep` window without copying everything each time; source-row provenance for diagnostics and the table?
- **Exactness.** Is anything a reader can ask for (tooltip, table, keyboard, summary) forced to come from the Scene instead of the Frame?
- **Simplified drawing (F5).** Can the per-column, per-run guarantee be implemented with `PathMark`/`AreaMark` as defined, at device-pixel resolution, for stacked areas?
- **Layout and text (L1, L3, L8, A6).** Is `Layout` enough for thinning, wrapping, rotation, middle truncation, the hidden-label note, the too-small fallback, axis titles, bar value labels and the donut legend-with-values?
- **Two renderers.** Can both a Canvas 2D and an SVG-path renderer implement `MarkRenderer` so that the SVG one follows CSS theme changes without redraw and the canvas one repaints on theme change? Is the overlay contract workable for both?
- **Interaction and accessibility (I1–I6, A1–A7, C1).** Are `View`, `Lookup` and `DatumRef` sufficient for nearest-x tooltips with "No observation", scatter picking, keyboard order per the type matrix, focus that survives streaming eviction, and paged tables?
- **Invalidation (plan 2.2).** Do the types let each stage be cached on explicit keys?
- **Performance (P1–P8).** Any type choice that forces per-point objects, copies of large columns, or O(n) work per frame where the plan promises pixel-bounded work?

Rules:
- At most 14 findings, most severe first. No praise, no summary of the files.
- Each finding: what breaks, which spec criterion or plan rule, and the exact replacement type definitions (TypeScript, complete enough to paste).
- Label reasoning as Inferred; label anything from memory.
- End with a short list of things in the contracts you checked and would keep as they are (one line each), so the implementers know what is settled.
