<!-- Author: agent a7e48ddd0321b1b1e (observed model in its transcript: claude-opus-5-5); saved by the coordinator -->

The matrix is brought up to both strengthening passes (91d649e, d936ec3), with one blocker: about 40 of the new Node titles cannot be cited until `packages/axylo/test/acceptance/EVIDENCE.json` is regenerated (see "One thing you need to do").

The checker accepts the matrix (exit 0, still the same six warnings, all correct as before) and its tests pass 38 of 38. Its static count is: pass 6 (P6), fail 0, weak 166, no evidence 0, not run 136, not recorded for this revision 0, cannot be verified here 11, not applicable 257. I edited only `acceptance/matrix.json`, and regenerated `acceptance/report.md` with `node acceptance/check.mjs --write`. Nothing was built, no suite was run, nothing is committed, and the scratch directory is removed.

## New reachable counts (what each cell reaches once its cited results pass)

| Status | Now | Before |
|---|---|---|
| Pass when run | 110 | 65 |
| Weak | 166 | 211 |
| Pending | 32 | 32 |
| Cannot be verified here | 11 (5 are A3, waived) | 11 |
| Not applicable | 257 | 257 |

The cells that now reach pass are:
- F1 bar and compact; F2 scatter and donut; F4 (five cells); F8 donut; F12 (four cells)
- I1 line, area, bar and scatter; I2 (four cells); I6 full; T-tooltip-area
- A1 full and compact; A7 full; L7 full; C5

## What changed

**Structural repairs.**
- The new `KINDS` loops turned 84 existing titles into template-only ones. I set or dropped `registration` to match the current templates. Every title was confirmed in `EVIDENCE.json`.
- The stale T-zoom-scatter title is replaced by the new one, in both T-zoom-scatter and F7/scatter.
- "F2 bar: a missing bar shows…" can no longer be cited by title. Its title is chosen by a `compact ? '…' : '…'` expression the scanner cannot read, which is a new scanner limit. I cite it as `{ prefix: "F2 bars", atLeast: 2 }`: that describe holds exactly the full-bar and compact-bar cases.

**Node citations added (all titles the scanner lists literally):**
- **F1** bar and compact: horizontal bars. The compact case runs compact bar.
- **F2:** the scatter null case and the donut null slice.
- **F3**, per type, closing those gaps:
  - a hint does not throw under strict;
  - AX199 from a throwing row getter;
  - field and row indexes for AX107 and AX108;
  - the DX5 strict create/update/append test (it already existed);
  - the F12 AX107 note.

  The "AX142 after the call" test is cited as weak only. AX142 is a hint, which strict never throws, so it shows nothing about late warnings.
- **F4:** mixing wall-clock times with instants and no calendar date (five cells).
- **F7:** y refit after an x zoom (line, area, bar); exact x span with x references (line, area); the scatter date x; compact having the same domain (compact line, area and bar).
- **F8:** a null slice while grouping happens.
- **F10:** all-negative totals (area, bar). The strengthened in-place tests close the bar "incomplete" tooltip gap and the compact "incomplete" wording gap.
- **F12:** AX107, with a limit that its note is checked on the model only.

**Browser citations added**, with `compactKind` checked for every compact cell:
- **A1:** the 14 compact area and compact bar titles. The compact gap is closed: line, area and bar now each cover every part.
- **L7:** compact area and bar.
- **F2, A5, C1, C2:** compact area and bar tests added where they apply.
- **I1:** the new below-80 px test per full type, which closes the L8-minimum gap.
- **A8:** the new pinned and readout-strip test per full type.
- **T-zoom-scatter:** the new test closes "x only", the `+` key and the refit.

**Gaps removed because the tests were strengthened in place:**
- L7: the `Set` de-duplication, on all six cells.
- I2: first entry only. I6: paused view compared only with the table open. T-tooltip-area: stale total. C5: marker title.
- A1: `clip-path: inset(0)`, and ids checked before tables open. A7: `role="log"` and the two-append read.
- A8: the state predicate. C2: no bridging check, and the citation moved from weak to evidence. C4: colour now required.
- DX2: caller index by form is now checked per type. What remains there is two-series normalized data on non-line types.

**Limits updated:** the L7 recorder, I2, I6, the A7 donut share, the F7 scatter refit, the T-zoom-scatter keys and drags, and the I1 below-minimum test. The DX5 pending text now says "for this revision".

**Gaps I kept or added:**
- C1: "nothing inside exposed" lets text nodes through.
- C3: only the highest and lowest heights are checked.
- F2 compact line and area: the zeros are the lowest vertices, not shown to sit on the baseline.
- A8: the dirty fixture is not crossed with the other states.
- F3: the AX141, AX142, AX143 and AX132 gaps and the throwing-tick-formatter gap all remain.

## One thing you need to do

The Node pass did not update `packages/axylo/test/acceptance/EVIDENCE.json`, which still has 545 entries. The checker refuses a template-only title when the `EVIDENCE.json` beside its file lacks it, so these tests cannot be cited yet:
- **production.test.ts:** 24 titles ("F3 {type}: an error prints once…", "…prints once per page across two charts", "…a hint is delivered and not printed").
- **F7:** the stacked-totals first-tick tests.
- **F2:** the instant-axis absent-step tests.

The affected F3, F7 and F2 gaps name these tests and say why they are not credited. Regenerating that `EVIDENCE.json` from a Node run would let them close.

## Gaps that remain, most important first

1. F3, all types: production delivery is tested but not citable (EVIDENCE.json); an error-level throw under strict and late warnings other than AX160 are unchecked; AX141 outside line is only seen raised; AX142 delivery; AX143 (wording only on line and area, nothing on scatter); a throwing tick formatter on area, bar and scatter; AX132 on compact bar.
2. L2, all six: text outside the resting state (tooltip, strip, table, notes, messages, L8 fallback) is not measured, there is no dark-scheme check, and text over a mark is not checked.
3. A9, all six: no test reads the generated conformance page or compares the WCAG list with W3C's; publication with each release and per-criterion test support are untested.
4. L1, full: generated label sets are checked only in Node; the browser's own text-only zoom is not run; the late font is tried at two widths; the L1 bar note and AX143 are not forced in a browser; the truncated label's tooltip text and unordered categories on line and area are unchecked.
5. C2 compact: dense compact drawing is not painted; AX108; what the dirty fixture draws; F1 negatives; I5 on compact area and bar (reduced motion, update, 24 charts); L4 triggers on compact area and bar; AX132; AX141 on compact area and bar.
6. F7: stacked totals' first tick (not citable); time-series x span; a scatter time x; a y reference band beside area and scatter; compact x span; the compact area and bar reference shown at the view stage only.
7. F2 line, area, bar and compact: the instant-axis absent step (not citable); the baseline of zeros on compact line and area; a no-row slot on compact bar; the property runs compact area only.
8. A2, full: Pause and the zoomed-only controls are never reached by the arrow keys; the zoomed number or date bar; scatter after hiding the focused series.
9. I4, all: the pager and jump field are never measured; Resume; Reset and Pan sizes off the line chart; per-type touch coverage; dragging over a compact chart.
10. A5, all: AX141 is shown at 1:1, not at the threshold; separators in light only; the order of bars within a group; telling donut slices apart without colour; compact palette and AX141 on line only; stacked compact separators; four or more patterns.
11. L4, all six: a `style` change on `<html>`, a contrast-preference change, the forced-colours frame, `--axylo-background` on a real chart.
12. A8: the dirty fixture is not crossed with states; a zoomed number or date bar is not scanned.
13. L3 and L8, full: a zero-sized container in a browser and a run-time height change; no fixture forces the L8 ellipsis.
14. F6, all: the page locale in a browser outside line; localized ticks, percent and zoned times on a chart; a throwing tick formatter's fallback.
15. A4, full: F6 formatting checked in en-US only; the caption read as the computed name; the region is never scrolled; the million-row jump runs on line only.
16. A10, all: two message keys are never shown; `lang` is not checked on several surfaces.
17. I3 and T-zoom, line, area, bar and scatter: axis kinds per type; a category x on line and area; scatter time and date zoom checked only through the Node controller.
18. L6, line, area, bar and scatter: x-axis title variants.
19. F10, F5 and T-dense-area (area, bar, compact): the no-row stack rule is checked below the controller only; compact stacks untested; weekly-beside-daily shown on the scene only; dense compact not drawn.
20. Compact cells:
    - A6 (no reflow or text-spacing test)
    - A7 (Node only)
    - I5 (area and bar)
    - I6 (no Pause; the documentation hands it to the author)
    - L7 (message clipping)
    - C1 (pointer input beyond a move and a click)
    - C3 (a wide, short tile)
    - C4 (four or more patterns)
    - F9 (painted colours for compact area and bar)
21. Single cells:
    - I1 donut: the whole slice left uncovered by the tooltip is not checked.
    - T-dense-donut: a zero-extent slice would pass.
    - T-reference-donut: no reference band is tried.
    - L5 line and area: points are evenly spaced; exactly 12 px is not tested.
22. DX rows:
    - DX3: typed mistakes are missing per type.
    - DX4: field and rows per code; message snapshots.
    - DX6: no 24-tile page.
    - DX8: non-line lifecycle, retention, reference labels.
    - DX11: the release-time check.
    - DX10: CI has never run.
    - DX1: no non-line snippets.
    - DX2: two-series normalized data on non-line types.
23. Pending or cannot be verified:
    - Pending: P1–P5, P7 and P8 not measured; P3 has no workload for non-line types; the DX5 heap trend; the DX12 rehearsal.
    - Cannot be verified here: DX9 (no release); A3 (the rehearsal, waived by the owner).
