You are implementing two modules of Axylo, a browser charting library, in this repository. Other agents are working in the same checkout on other directories at the same time.

First read `AGENTS.md` and follow it exactly. Then read:
- `packages/axylo/src/core/contracts.ts`: the fixed interfaces. You produce `Layout` (with `Projection`, `PlacedText`, `AxisLabelFit`) and the packed geometry used by `PathMark`, `AreaMark` and `PointMark`; you consume `TickCandidates`, `TextMeasurer`, `TextStyle`, `XScale`, `ContinuousScale`, the SLOT_* states and the join rule stated in a comment under the frame types.
- `docs/02-product-spec.md`: criteria F2, F5, L1, L3, L5, L6, L8, A6, C3 and the type matrix in 3.6.
- `docs/03-plan-typescript-release.md` section 2.3, the paragraph "Simplified drawing".

## You own (create and edit only these)
- `packages/axylo/src/simplify/**`
- `packages/axylo/src/layout/**`
- `packages/axylo/test/simplify/**`
- `packages/axylo/test/layout/**`

Pure TypeScript that runs in Node. No DOM. No runtime dependencies. Do not import from other modules of the library except `core/contracts.ts`: anything you need from elsewhere (scale constructors, text measurement) is a parameter.

## Module 1: simplified drawing of lines and areas (`simplify/`)

This is the heart of spec F5 and F2. Read both criteria twice.

1. `joinRuns(slot, range)`: given one series' slot states and a slot range, return its runs: maximal sequences of SLOT_VALUE slots in which consecutive values are joined according to the join rule (two consecutive values are joined if and only if every slot strictly between them is SLOT_NO_ROW). Also return the isolated values (a value joined to nothing on either side), which must be drawn as visible points.

2. `simplifyLine(input)`: input is the x positions (Float64Array), one series' y (Float64Array or Float32Array) and slot states, the slot range to draw, a function or scale mapping an x position to CSS px, the plot's left edge and width in CSS px, and the device pixel ratio. Output: the indexes of the source slots to keep, in source order, with the breaks between runs, such that:
   - when the series has at most four value slots per device-pixel column on average over the plot width, every value is kept (no simplification);
   - otherwise, for every device-pixel column and every run that has samples in it, the first, the minimum, the maximum and the last sample of that run in that column are kept (so the drawn stroke covers exactly the run's vertical extent in that column, and enters and leaves at the right values); ties keep the earlier sample for the minimum and for the maximum;
   - runs are never merged: a break between two runs survives even when both fall in the same column;
   - isolated values are returned separately and are never dropped;
   - the work is one pass over the drawn slots with no per-point allocation; output arrays are typed arrays sized once (two passes are acceptable).
   Device-pixel column of a CSS x: `floor(x * devicePixelRatio)`.

3. `buildPath(indexes, breaks, …) → Float32Array` in the packed form `PathMark.xy` expects (a NaN pair lifts the pen), and `buildPoints` for the isolated values.

4. `simplifyArea(input)`: for one band of an area or stacked-area chart: an upper boundary and a lower boundary (each a Float64Array of values per slot; for an unstacked area the lower boundary is the constant zero line), the slot states that decide where the band exists, and the same mapping inputs. Output: the `upper`, `lower` and `runs` arrays that `AreaMark` expects. Each boundary is simplified on its own with the per-column rule above, so each keeps its own extremes; within one run the two boundaries start at the same x and end at the same x; the band is split wherever the join rule forbids joining. Provide a way for adjacent stack bands to reuse one boundary's packed array (the upper boundary of band k is the lower boundary of band k+1) so their shared edge is identical.

Tests for module 1 assert **which source indexes were kept**, not pixels:
- one outlier among 1,000,000 points is kept at several plot widths and at device pixel ratio 1 and 2;
- two peaks and a gap inside one column: both peaks kept, the break kept;
- alternating value and null slots across one column: every run survives as its own run or isolated point;
- tied extremes; the first and last sample of each column are kept; an irregular x spacing; a draw range that starts and ends mid-data;
- SLOT_NO_ROW between values is joined across, SLOT_NULL, SLOT_INVALID, SLOT_GAP and SLOT_ABSENT_FIELD are not;
- fast-check properties: for any data and width, in every column and run the kept set contains that run's minimum and maximum and its first and last sample; kept indexes are strictly increasing; no kept index is a non-value slot; simplifying an already simplified series changes nothing; the number of kept samples is at most 4 × (columns that have samples, counted per run);
- a 1,000,000-point pass takes a few milliseconds, not hundreds (assert a generous bound and print the time).

## Module 2: plot layout and label fitting (`layout/`)

`computeLayout(input) → Layout`. The plot container's size is given; the title, legend, controls and table are HTML outside it and are not your concern. Everything is in CSS px relative to the plot container.

Input (define the exact type in your module, plain data plus injected functions):
- container width and height (either may be zero: return `kind: 'unmeasured'`);
- the kind of plot: cartesian with a continuous x; cartesian with a band x (category line or vertical bars); horizontal bars; ring (donut); and whether it is compact; or a message to show (loading, empty, error);
- for each axis: its domain, its tick candidates (densest first, as `TickCandidates`), its title text if any, whether its labels may be thinned (time, date, number, and ordered categories: yes; plain categories: no);
- a `TextMeasurer` and `TextStyle`;
- scale constructors as parameters (`linear(domain, range)`, `time(domain, range)`, `band(count, range, padding)`) returning the contract's scale types;
- bar value labels are not part of 1.0: do not place them.

Rules:
- **Margins** are solved from the text: the value axis needs room for its widest tick label plus its title; the other axis needs room for its labels after fitting (one line, two lines, or rotated) plus its title. Solve iteratively until stable (the tick set chosen depends on the plot size, which depends on the margins). Axis titles never overlap tick labels (spec L6).
- **Value axis ticks**: the densest candidate set whose labels keep at least half a line height of space between them.
- **Label fitting on the x (or category) axis, spec L1, in this order**, recording each remedy used in `fit`:
  1. thin, only if the axis may be thinned: step down the candidate sets until labels have at least 8 px between them;
  2. wrap each label to at most two lines at word boundaries;
  3. rotate the labels by −45 degrees (anchor at the tick, `box` is the rotated bounding box);
  4. truncate in the middle with an ellipsis, shortest truncation that fits, keeping every drawn label distinct from every other (two labels that would truncate to the same text must be truncated differently or left longer);
  5. if labels still collide, hide the ones that do not fit, keeping as many as possible evenly spread, and report how many are hidden in `fit.x.hidden`.
  At every stage the test is the same: no two label boxes intersect (1 px tolerance) and no box leaves the container.
  For horizontal bars the category labels are on the left: fit them by truncating in the middle when they exceed 40% of the container width; if there are more labels than rows of text fit, hide evenly and report it.
- **Too small** (spec L8): when the resulting plot rectangle would be under 120 × 80 CSS px and the plot is not compact, return `kind: 'too-small'`.
- **Compact** (spec C3): the plot rectangle is the container inset by 2 px; no ticks, no text; `kind: 'compact'`.
- **Ring**: the largest ring that fits, centred, with an inner radius of 60% of the outer; `kind: 'plot'` with empty tick lists.
- **Message**: one centred `PlacedText` with role 'message', wrapped to the container width.
- The `projection` in the result uses the injected scale constructors with pixel ranges taken from the plot rectangle (y ranges run bottom to top).

Tests for module 2 use a deterministic measurer you define in the tests (for example 7 px per character, 16 px line height):
- fast-check: for container widths 240–1,920 px, heights 160–600 px and generated label sets (1–40 categories, 1–60 characters each, including labels that share long prefixes, and long unbroken words), the result is always one of the allowed kinds and, when it is `plot`: zero pairs of intersecting text boxes (1 px tolerance), no box outside the container, drawn labels pairwise distinct, `hidden` equals the number of labels not drawn, and the remedies are recorded in the allowed order;
- "Customer Success & Onboarding" among short labels at 720 px wraps to two lines and nothing is hidden; at 340 px every label is still distinct;
- two labels differing only at the end ("Customer Success – EMEA", "Customer Success – APAC") stay distinguishable after truncation;
- a plain category axis is never thinned before wrapping, rotating and truncating have been tried; an ordered one may be;
- a 100 × 60 container gives `too-small`; a 24 × 16 compact container gives `compact`; a 0 × 0 container gives `unmeasured`;
- the axis title boxes never intersect tick label boxes.

Run `npm run typecheck` and `npm test` from the repository root before you finish. If something outside your directories fails, say so and leave it alone.

Finish with the report described in AGENTS.md.
