# First-chart and compact creation investigation

The November 18 M1 result was 17.36 ms with Chrome 157, eight pairs and the synthetic 3 × 120 input. Record `20261118T023053Z-first-3x120-uplot-vs-axylo-svg-7ee1` names dirty library sources at checkout `e6e0e195` and the measured production bundle SHA-256 `01f2d3271feea13dfb0d76b8ed2c83b2248586cb0e03954a38f5199327e7049d`. The clean `a63bbeea` run below is a separate measurement. The history sweep uses committed sources through `b643862`; the final SVG-only row uses the sealed working-tree artifact `20261122T042403Z-bb2826ac-ec008a` (library source hash `9597eef14ad21995`, matching the library at `298b29e`). Every record uses the named P1 `trend` fixture, Chrome 158.0.8127.36 and 20 complete pairs from one sealed artifact. uPlot was the contemporaneous control for interpreting different machine conditions. As specified by P1, the budget remains an absolute Axylo time.

| Library source | uPlot | Axylo SVG | Load range | Record ID |
|---|---:|---:|---:|---|
| `a63bbeea` | 8.60 ms | 20.06 ms | 1.99–2.83 | `20261122T044718Z-first-trend-uplot-vs-axylo-svg-0188` |
| `156f414` | 8.87 ms | 21.52 ms | 3.16–4.27 | `20261122T045704Z-first-trend-uplot-vs-axylo-svg-070e` |
| `4809516` | 7.77 ms | 20.68 ms | 2.44–3.54 | `20261122T045819Z-first-trend-uplot-vs-axylo-svg-ec98` |
| `77213c0` | 8.73 ms | 21.47 ms | 2.11–3.22 | `20261122T045933Z-first-trend-uplot-vs-axylo-svg-aab6` |
| `93311fa` | 8.60 ms | 22.48 ms | 2.83–4.35 | `20261122T050427Z-first-trend-uplot-vs-axylo-svg-822e` |
| `4504ca4` | 8.20 ms | 23.41 ms | 3.86–5.74 | `20261122T050542Z-first-trend-uplot-vs-axylo-svg-e9df` |
| `11fe315` | 9.24 ms | 22.13 ms | 2.89–3.85 | `20261122T050657Z-first-trend-uplot-vs-axylo-svg-28b9` |
| `e9449a6` | 8.79 ms | 24.11 ms | 4.49–6.10 | `20261122T050811Z-first-trend-uplot-vs-axylo-svg-8da7` |
| `37ed261` | 8.20 ms | 26.80 ms | 2.95–3.87 | `20261122T044833Z-first-trend-uplot-vs-axylo-svg-22c4` |
| `28174df` | 8.47 ms | 28.30 ms | 3.25–3.81 | `20261122T044947Z-first-trend-uplot-vs-axylo-svg-17d9` |
| `12492de` | 8.62 ms | 27.30 ms | 2.29–3.84 | `20261122T050047Z-first-trend-uplot-vs-axylo-svg-4bd3` |
| `03ff5b1` | 8.75 ms | 29.85 ms | 3.00–3.75 | `20261122T050202Z-first-trend-uplot-vs-axylo-svg-f9c5` |
| `9f9eeef` | 9.57 ms | 31.97 ms | 3.49–5.27 | `20261122T045102Z-first-trend-uplot-vs-axylo-svg-ec94` |
| `b643862` | 10.62 ms | 33.77 ms | 7.44–9.87 | `20261122T045219Z-first-trend-uplot-vs-axylo-svg-2a04` |
| SVG-only change | 10.99 ms | 33.03 ms | 8.43–9.58 | `20261122T045336Z-first-trend-uplot-vs-axylo-svg-4aaa` |

The increases are concentrated around the interaction and theme work at `e9449a6`, the per-kind composition at `37ed261`, and the later lookup and interaction work through `9f9eeef`. Adjacent source snapshots show 22.13 → 24.11 ms for the theme and focus change and 29.85 → 31.97 ms for the interaction change. The intervals and load differ between jobs, so these are locations of observed increases, with no isolated causal estimate for each feature. The last two records and the profiles overlapped browser verification and ran under visibly heavier load. The quieter owner-accepted baseline and new budget runs govern the budget verdict.

## Production CPU profiles

Three first-chart profiles per source use the artifact's production source map. Times are median self milliseconds across the three active windows. Compiled and native work without a separately sampled stack cannot be attributed fully. The browser accessibility tree itself was not separately instrumented.

| Stage | b643862 | SVG-only |
|---|---:|---:|
| Data normalization | 1.69 | 2.01 |
| Scales and view | 1.54 | 1.65 |
| Layout and formatting | 2.32 | 3.06 |
| Scene | 0.77 | 0.80 |
| Drawing | 1.38 | 1.80 |
| DOM, including controls and accessibility elements | 2.61 | 2.95 |
| Interaction module within DOM | 1.53 | 1.84 |
| Reader summaries and table model | 1.21 | 1.22 |
| Theme resolution | 1.98 | 1.86 |
| Core orchestration | 12.35 | 13.58 |
| Native main-thread work | 5.57 | 6.52 |
| Other JavaScript | 4.79 | 6.36 |

The P1 chart never opens the table or readout. Neither the table's DOM nor the tooltip module had separately attributable median self time. The forced strip-height measurement appeared in one of the SVG-only profiles at 0.46 ms. The largest named function was `viewerTimeZone`, about 6.24 ms in the original build and 6.06 ms in the SVG-only build. The trend fixture declares UTC and never needs the viewer's default zone. The reader also built an international list twice when every drawn series contributed the same names to the summary.

The SVG-only compact profile attributed 9.55 ms to the browser environment, 5.97 ms to data options and 14.21 ms to theme resolution over 40 charts. Default-zone discovery and canonical zone resolution are both repeated for charts with the same data. See the [P1 profile](profiles/2026-11-22/20261122T045502Z-first-trend-axylo.summary.json), [P8 profile](profiles/2026-11-22/20261122T045507Z-compact-trend-axylo.summary.json) and the [history sweep log](p1-investigation-2026-11-22.log).

## Measured startup changes

The P1 column uses Axylo and the same-session uPlot control. P8 uses two 20-run sides of an Axylo A/A run. Separately sealed builds were measured in separate jobs. The medians and load ranges below give observed differences across jobs. Individual savings are approximate because the changes were not randomized across jobs.

| Cumulative build | P1 Axylo / uPlot | P1 load | P1 record | P8 sides A / B | P8 load | P8 record |
|---|---:|---:|---|---:|---:|---|
| SVG-only baseline | 28.55 / 7.99 ms | 1.53–2.26 | `20261122T051331Z-first-trend-uplot-vs-axylo-5f76` | 80.64 / 77.73 ms | 1.08–1.41 | `20261122T051600Z-compact-trend-x40-aa-axylo-15d5` |
| Resolve the viewer zone only when local time is needed | 27.97 / 7.59 ms | 1.47–1.82 | `20261122T051446Z-first-trend-uplot-vs-axylo-d470` | 76.19 / 76.13 ms | 1.09–2.55 | `20261122T051714Z-compact-trend-x40-aa-axylo-a445` |
| Skip the unused strip measurement and resolve the locale once per frame | 27.05 / 7.55 ms | 1.81–2.25 | `20261122T051844Z-first-trend-uplot-vs-axylo-4ffb` | 74.95 / 77.21 ms | 1.92–2.74 | `20261122T051958Z-compact-trend-x40-aa-axylo-041b` |
| Probe CSS colors only when needed and recognize the exact UTC name | 27.07 / 8.09 ms | 1.08–2.46 | `20261122T052112Z-first-trend-uplot-vs-axylo-7773` | 69.66 / 68.58 ms | 1.47–2.03 | `20261122T052226Z-compact-trend-x40-aa-axylo-9133` |
| Retain the shared renderer interface and load the sealed capability before timing | 27.40 / 8.23 ms | 0.67–1.65 | `20261122T052521Z-first-trend-uplot-vs-axylo-82c9` | 70.74 / 68.38 ms | 1.49–1.94 | `20261122T052635Z-compact-trend-x40-aa-axylo-1d06` |

P1 moved from 28.55 to 27.40 ms in this sequence. The timezone change and frame preparation changes were followed by decreases of 0.58 and 0.91 ms respectively. The theme and exact-UTC change moved the P1 median by 0.02 ms and lowered the compact medians by 5.29 and 8.63 ms. Compact charts ended at 70.74 and 68.38 ms, below 80 ms on both sides. The final candidate still needs 17.40 ms, about 64% of its measured task time, removed to meet P1’s 10 ms budget.

## Remaining first-render cost

Three production profiles of the final candidate put the median active browser time at 37.63 ms under the profiler. The median self time is 6.33 ms in core orchestration, 5.49 ms in native main-thread work, 3.36 ms in layout and formatting, 2.58 ms in DOM code (including 1.66 ms in the interaction module), 2.01 ms in theme resolution, 1.64 ms in scales and view, 1.22 ms in normalization, 1.20 ms in drawing, 1.02 ms in reader work and 0.76 ms in scene construction. Another 10.02 ms is unattributed JavaScript, including harness work. The browser's accessibility tree has no isolated time in these samples. The on-demand tooltip and table rendering have no distinct sampled cost. The active compact profile attributes 11.47 ms to theme work across 40 charts. [Final P1 profile](profiles/2026-11-22/final/20261122T052750Z-first-trend-axylo.summary.json) · [Final P8 profile](profiles/2026-11-22/final/20261122T052755Z-compact-trend-axylo.summary.json)

The remaining work to reach 10 ms would include eliminating forced style and layout reads across chart creation, reducing first-use locale formatting, and deferring interaction setup that can safely wait for first focus or input. Those changes need separate prototypes and profiles. The generated description, synchronous diagnostics and first-frame drawing are required behaviors. The sampled costs do not establish that those changes alone could save 17.40 ms.

Proposal for the owner: set the 1.0 P1 budget to 30 ms for the same workload and reference desktop. The candidate recorded 27.40 ms in 20 runs, giving 2.60 ms of margin. The owner-accepted baseline was 29.42 ms. Keep 10 ms as a target for the recurring improvement work. The product specification still requires 10 ms.
