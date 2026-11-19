# Analysis: how does Axylo compare with the ten libraries of Phase 1?

You are the analyst. Read-only: edit nothing; your final message is the deliverable, a Markdown document the coordinator will save as `docs/05-comparison.md` after checking it against the data. Repository: /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library; read `AGENTS.md`).

## Sources

- `docs/01-landscape.md`: the Phase 1 report on ten libraries (Chart.js, Recharts, D3, ECharts, Highcharts, ApexCharts, Plotly.js, Nivo, MUI X Charts, uPlot): its method (section 2), its scoreboards (3.1, 4.1), findings, what each library needed beyond data (5.1), load (5.3). Read it fully: the comparison must use the same criteria and the same scoring rules, applied to Axylo, or say where a rule cannot apply.
- `research/README.md` and `research/harness/` (the harness, the adapters `src/libs/*.js`, `probe.mjs`): how each measurement is taken. Axylo's adapter is `src/libs/axylo.js`; it was added on 2026-11-19 (`reviews/2026-11-19/wp/phase1-axylo.report.md` lists what each task needed beyond data).
- `research/harness/results.json` (probe output for all eleven libraries, rerun on 2026-11-19 for every step except timing), `sizes.json`, `palette.json`, `spot-checks.json`, `shots/` (screenshots; `_sheet-*.png` are side-by-side sheets: look at them), `rerun-2026-11-19.log`. `node research/tables.mjs` prints the report's tables from these files (you may run it; it only reads).
- Axylo's own claims are in `docs/02-product-spec.md`; its known limits in `apps/docs/pages/stability.md` ("Known limits"). Use them only to say where a measured result confirms or contradicts a claim, never as evidence.

## What to produce

A comparison document, plain and short, readable by the project's owner:

1. **Method and its limits**: same harness, same data, same probes as Phase 1; rerun on 2026-11-19 for all eleven, so the ten others were re-measured too (say where their results changed from the Phase 1 report and whether that changes any Phase 1 conclusion; versions are in `results.json` `_env` or the adapters' `meta`). The timing step (`perf`) was not rerun yet: it needs an idle machine and runs with the benchmarks; mark every timing cell "pending" and do not reuse Phase 1 timings for Axylo. Axylo was built by the people doing the comparison: say so, and say which checks are therefore most exposed to that bias and how the reader can check them (the screenshots, the probe code).
2. **The scoreboards of 3.1 and 4.1 with an Axylo row**, scored by the same rules from the recorded results (show the cell values and, where a cell is a judgement, the evidence: the result key or screenshot). Where Axylo scores worse than a library, say so plainly.
3. **What each task needed beyond data** (as 5.1), Axylo beside the others, and the harness line counts.
4. **Size** (as 1.4 and 5.3's size part) with Axylo, and how this measurement relates to Axylo's own size check (`bench/size-latest.json`, 115.74 KiB everything): explain the difference in method if the numbers differ.
5. **Findings**: what the rerun shows Axylo does better, the same, and worse, each tied to a recorded result; anything in the results that contradicts a claim of the spec.
6. **What remains**: timing; anything the probes could not measure for Axylo and why.

Every number must come from the files above; if you compute a number, say how. Do not invent results. If a probe result for Axylo looks like a probe defect rather than Axylo's behaviour (an Axylo-specific hook reading the wrong element, for example), say so and keep it out of the scores until it is checked. Concrete and short; no marketing.
