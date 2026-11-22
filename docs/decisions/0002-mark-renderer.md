# Decision 0002: SVG draws the marks in 1.0

Status: **final for 1.0**, confirmed by the owner on 2026-11-22. All shipped chart types draw marks with SVG. The benchmark harness retains the old Canvas records and can replay the renderer decision on the original sealed artifact.

## Release evidence

- The software family selected SVG under [rule 3](../04-plan-performance.md#51-declared-endpoints-provisional-until-the-pilot). Eight timing endpoints were too noisy to distinguish the renderers by the declared tolerances. Neither renderer had a late streaming run. The old Canvas implementation added 2,269 bytes gzipped in the matched script-tag measurement, above rule 3’s 512-byte cutoff. [Software decision](../../bench/decision/no-idle-2026-11-21/decision-renderer-20261121T143350Z.json)
- The GPU family returned no decision because the dashboard GPU-memory result depended on run order. Canvas took less main-thread time on both GPU resize workloads beyond the tolerance, with neither difference reaching the worthwhile margin. [GPU decision](../../bench/decision/no-idle-2026-11-21/decision-gpu-20261121T143402Z.json)
- Both families ran on Chrome 158.0.8127.36 on the same reference desktop, using artifact `20261119T091624Z-b643862f-b78698`. The owner accepted the 2026-11-21 measurements and dropped the idle-machine rule. Load is recorded with the results. [Benchmark method](../../bench/README.md)

The SVG implementation uses CSS paint expressions for live theme changes and retains the plot's device-pixel geometry. 1.0 has no Canvas marks option. HTML text, accessibility, hit testing and streaming remain independent of the mark renderer.

The packed consumer bundles shrank by 2,487 gzipped bytes for all chart types (118,252 to 115,765) and 1,646 for the line-only entry (98,627 to 96,981). These before-and-after pack measurements include the related removal of the switch and Canvas-only styles.

## Historical M1 review and measurements

The table below is kept as measured. These statements made from it in the first version are withdrawn or narrowed:

- **Withdrawn: "nothing measured favours canvas except all-thread CPU during resize."** The recorded heap, DOM-node and layout counts also favour canvas.
- **Withdrawn: the resize CPU gap is raster work.** The number is CPU for the whole renderer process; no stage was traced.
- **Withdrawn: simplification bounds every chart by its width.** It was shown for line series only; point marks and many-series charts were not measured.
- **Withdrawn: an SVG theme change needs no run-time work.** Both renderers recorded six DOM mutations per toggle; "no canvas drawing call" is all that was observed.
- **Withdrawn: normalization and garbage collection explain the gap to uPlot.** About 71–73% of busy time in the production profiles is unmapped; the normalization share comes from development builds. It is a hypothesis to test, not a finding.
- **Narrowed: "half the renderer memory."** The halving is of the increase above a data-only page at pixel ratio 2 (34.2 → 17.7 MiB). Absolute renderer memory was 74.7 → 56.2 MiB, and at pixel ratio 1 the increase was 23.1 → 18.4 MiB.
- **Narrowed: "no frame later than 25 ms."** True of the recorded animation-frame callbacks; the window can miss an interval that spans its boundary, and a callback is not a presented frame.
- **Void: every 24-chart page row** (page at pixel ratio 1 and 2, resize of the 24-chart page, and the memory row). The harness fix pass found that these runs drew no marks: at 230 × 115 px each tile is below the 120 × 80 px plot minimum of spec L8, so every chart showed its text fallback. The SVG records carry `svgPaths: 0`; the canvas runs held empty canvases. The numbers compare two empty charts and say nothing about the renderers. The harness now rejects a run whose chart drew no marks, and the page workload uses 340 × 200 px tiles.
- **Narrowed: verdicts.** 149 metric comparisons were judged without adjustment for choosing among them, on six pairs or fewer per workload, with noise bands from one session and two workload shapes. Two "SVG lower" rows allow a gain as small as 0.16 ms (10,000 points) and 6.3 ms (dashboard at pixel ratio 2).

Evidence: [bench/results/m1-renderer-comparison.md](../../bench/results/m1-renderer-comparison.md). One session of 39 runs, production build, headless Chrome 157, machine under load from other work, A-versus-A noise bands for two workloads only.

### What M1 measured

Canvas → SVG, medians of main-thread task time unless stated. "Lower" means the 95% interval cleared zero and the noise band where one existed.

| Workload | Canvas | SVG | Verdict |
|---|---|---|---|
| Streaming, per update | 2.26 ms | 1.45 ms | SVG lower |
| Theme change, per toggle | 2.68 ms and 27 drawing calls | 2.01 ms and no drawing call | SVG lower |
| Resize, one chart of 100,000 points | 915 ms | 472 ms | SVG lower on the main thread |
| Same, CPU across all threads | 1,035 ms | 1,770 ms | **SVG higher** |
| Resize, 24-chart page | 730 ms | 525 ms | Void: no marks were drawn |
| First chart, 10,000 points | 34.0 ms | 28.4 ms | SVG lower |
| 24-chart page at pixel ratio 2 | 199 ms | 158 ms | Void: no marks were drawn |
| First chart, 3 × 120 | 23.6 ms | 19.8 ms | Inconclusive |
| First chart, 100,000 points | 81.8 ms | 83.5 ms | Inconclusive |
| First chart, 1,000,000 points | 622 ms | 652 ms | Inconclusive (4 blocks) |
| Memory, 24-chart page at pixel ratio 2 | 34.2 MiB renderer, 11.5 MiB GPU, 7.7 MiB backing stores | 17.7 MiB, 2.2 MiB, none | Void: no marks were drawn |

No frame was later than 25 ms in any configuration, so frame pacing does not separate the two.

### Why SVG was the working default

1. On the line workloads measured, main-thread task time was lower with SVG or the two could not be told apart.
2. Line series are simplified to a few vertices per pixel column before either renderer sees them, so for line charts the path size follows the plot width, not the data.
3. SVG follows the page with less code: forced colors and print work through CSS, browser zoom stays sharp, and there is no backing store to size, cap or lose. This is a design argument, not a measurement.

### What M1 did not establish

- **GPU rasterization was not measured.** Headless Chrome here does not use a GPU. The resize, pixel-ratio-2 and process-memory results need a headed, GPU-backed rerun before they transfer.
- **Dense point marks were not measured.** A scatter chart with tens of thousands of markers is the case most likely to favour canvas.
- **One browser, one machine, one session.** Firefox and Safari may order the two differently.
- **Many series, pan and zoom, and the budget workloads P4, P7 and P8 were not measured**, and the million-point comparison has four pairs.
- Both renderers are far from uPlot in the configurations measured (about 80 ms against 12 ms at 100,000 points; uPlot draws no tooltip or accessibility layer). Where that time goes is not established.
