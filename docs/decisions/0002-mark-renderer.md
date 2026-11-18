# Decision 0002: SVG paths draw the marks by default

Status: decided from the M1 measurements, by the coordinator, on 2026-11-18. The owner asked for this to be settled by measurement. It reverses the working assumption in the plan (Canvas 2D) and can be reversed again by one internal switch if the measurements still missing say otherwise.

Evidence: [bench/results/m1-renderer-comparison.md](../../bench/results/m1-renderer-comparison.md). One session of 39 runs, production build, headless Chrome 157, machine under load from other work, A-versus-A noise bands for two workloads only.

## What was measured

Canvas → SVG, medians of main-thread task time unless stated. "Lower" means the 95% interval cleared zero and the noise band where one existed.

| Workload | Canvas | SVG | Verdict |
|---|---|---|---|
| Streaming, per update | 2.26 ms | 1.45 ms | SVG lower |
| Theme change, per toggle | 2.68 ms and 27 drawing calls | 2.01 ms and no drawing call | SVG lower |
| Resize, one chart of 100,000 points | 915 ms | 472 ms | SVG lower on the main thread |
| Same, CPU across all threads | 1,035 ms | 1,770 ms | **SVG higher** |
| Resize, 24-chart page | 730 ms | 525 ms | SVG lower |
| First chart, 10,000 points | 34.0 ms | 28.4 ms | SVG lower |
| 24-chart page at pixel ratio 2 | 199 ms | 158 ms | SVG lower |
| First chart, 3 × 120 | 23.6 ms | 19.8 ms | Inconclusive |
| First chart, 100,000 points | 81.8 ms | 83.5 ms | Inconclusive |
| First chart, 1,000,000 points | 622 ms | 652 ms | Inconclusive (4 blocks) |
| Memory, 24-chart page at pixel ratio 2 | 34.2 MiB renderer, 11.5 MiB GPU, 7.7 MiB backing stores | 17.7 MiB, 2.2 MiB, none | SVG lower; its JavaScript heap is 0.1–0.3 MiB higher and it has 144 more DOM nodes |

No frame was later than 25 ms in any configuration, so frame pacing does not separate the two.

## Why SVG

1. Where the two differ on the main thread, SVG is ahead; where they do not differ, the measurements cannot tell them apart. Nothing measured favours canvas except CPU summed over all threads during a continuous resize of a 100,000-point chart.
2. The drawing is simplified to a few vertices per pixel column before either renderer sees it, so a path's size is bounded by the plot width, not by the data. That removes the usual reason to prefer canvas for large series.
3. SVG follows the page without code: a theme change restyles the marks with no call, forced colors and print work through CSS, browser zoom stays sharp, and there is no backing store to size, cap or lose.
4. It uses roughly half the renderer memory on a dashboard page.

## What this does not establish

- **GPU rasterization was not measured.** Headless Chrome rasterizes in software here. The one result against SVG (all-thread CPU while resizing) is raster work; on a GPU it may shrink or grow.
- **Dense point marks were not measured.** A scatter chart with tens of thousands of markers is the case most likely to favour canvas.
- **One browser, one machine, one session.** Firefox and Safari may order the two differently.
- Both renderers are far from uPlot (about 80 ms against 12 ms at 100,000 points). The profiles put that in data normalization and garbage collection, not in drawing (2–3%), so the renderer choice does not decide the performance budgets.

## Consequences

- The default mark renderer is SVG. The canvas renderer stays in the code behind the same internal switch, with the pixel-agreement tests between the two kept.
- Before 1.0: measure scatter at 10,000, 50,000 and 200,000 points with both renderers and decide whether scatter above some size should use canvas automatically. If it never should, the canvas renderer is removed from the 1.0 bundle to save bytes.
- When a real GPU and a second browser are available: rerun the resize and million-point workloads headed. If canvas wins there by more than the shipping thresholds in the performance plan, flip the switch back.
- The plan's sections 2.2 and 2.3 are read with SVG in the "marks" position: a theme change no longer needs a redraw, and device pixel ratio matters only to simplification.
