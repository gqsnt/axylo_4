`npm run typecheck` and `npm test` passed. I changed only `src/view`, `src/scene`, and their tests. Browser rendering was verified through geometry tests in Node.

| Finding | Reproduced | Fixed | Test coverage |
|---|---|---|---|
| 1. Zoom-edge extrema | Yes | Yes | Empty-window line, monthly area, sparse `SLOT_NO_ROW` series, and mixed-sign stack totals |
| 2. Zoom width | Yes | Yes | Off-edge, oversized, zero-width, and reversed windows on line and scatter |
| 3. Missing bar at plot edge | Yes | Yes, in the renderer | Both orientations failed against the historical renderer and passed against the current clip-aware renderer |
| 4. Donut colors | Yes | Yes | Eight arcs around zero and missing entries, plus grouped “Other” |
| 5. Series identity | Yes | Yes for markers and bars. No for stacked-area fill patterns | Scatter marker offsets and grouped and stacked bar patterns through 32 series |
| 6. Continuous bars | Yes | Yes in view and scene. No end to end | Whole centered bars in both orientations, partial zoom bands, and irregular spacing |
| 7. Numeric temporal positions | Yes | Yes | Numeric zoom and author bounds on time, date, and wall axes |
| 8. X references | Yes | Yes | Automatic extents on line and scatter, plus scene reference geometry |
| 9. Author x domain | Yes | Yes in view and scene | Narrower author bounds, confined zoom, excluded category marks, and a single-position domain |
| 11. Property coverage | Yes | Yes | Two 1,000-case properties cover independent flags, zoom, author domains, hidden series, both long-form missing states, dense simplification, and x references |
| 12. Contrast dashes | Yes | Yes | Eight distinct patterns, cycling with marker offsets |
| 13. Marker spacing | Yes | Yes | Clustered points with a distant endpoint |
| 14. Missing stack component | Yes | Yes, at the scene anchor | Positive and negative outer stack ends |
| 15. Equal reference bounds | Yes | Yes | X and y rules with an empty diagnostic sink |
| 16. Parser diagnostics | Yes | Yes | AX107 and AX112 for option values, plus AX109 for a time reference |
| 17. Repeated diagnostics | Yes | Yes | AX130, AX131, and AX110 report again only after their conditions clear and return |

Stacked-area fills use `AreaMark`. Supporting their patterns requires optional `AreaMark.pattern` with the same values as `RectMark.pattern`, plus renderer support. A separate layout probe also confirmed that `core/axes.ts` still expands a continuous-bar zoom of `[0.8, 1.2]` to approximately `[0.3, 1.7]`. That caller needs to use `view.xDomain` directly. The chart’s fresh diagnostic collector also needs to retain active conditions across rebuilds if they should remain visible in the chart’s diagnostics list.

I assigned palette slots to drawn donut slices first, then to arcless legend entries. For a missing component in a mixed-sign stack, I used the negative end when the preceding components occupy only the negative side, and the positive end otherwise.

```text
 Test Files  33 passed (33)
      Tests  483 passed (483)
   Start at  03:03:44
   Duration  1.70s (tests 79%, transform 11%, import 9%, worker 1%)
```