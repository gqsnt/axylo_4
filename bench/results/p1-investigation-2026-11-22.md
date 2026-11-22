# First-chart and compact creation investigation

The November 18 M1 result was 17.36 ms with Chrome 157, eight pairs, the synthetic 3 × 120 input and a dirty library snapshot recorded under `a63bbeea`. The following history sweep uses sealed snapshots of committed sources, the named P1 `trend` fixture, Chrome 158.0.8127.36 and 20 complete pairs per record. Each pair used one sealed artifact. uPlot was the contemporaneous control for interpreting different machine conditions. As specified by P1, the budget remains an absolute Axylo time.

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
