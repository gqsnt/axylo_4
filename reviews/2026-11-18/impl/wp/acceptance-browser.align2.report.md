<!-- Author: Claude Opus 5.5 (requested effort high), Agent-tool subagent a61d95e46b3f0f3aa, resumed. Saved by the coordinator from the hand-back. -->

## Third alignment pass: report

Both changes you asked for are in, plus one fix for a test defect that a library change exposed. Nothing is committed, and I touched only `packages/axylo/test/browser/acceptance/**`. TypeScript reports no errors in these files.

### What changed

**1. Readout-mode bracket (I1, five types, width and height).**
- A new helper `plotSides(page, axis, limit)` bisects the container size. It returns both sides of the jump, each with the plot size measured there:
  - the smallest container whose plot is at least the limit (floating mode);
  - the largest container whose plot is under it (readout mode).
- The test sets each container in turn and checks each side on its own terms:
  - **Floating side:** the plot is at least 240 px (or 140 px) and a floating tooltip shows.
  - **Readout side:** the plot is under the limit, the strip shows the datum under the plot on at most two lines, there is no floating tooltip, and the strip covers nothing and is covered by nothing.
  - **Both sides:** showing or hiding a datum moves nothing in the figure.
- The titles now describe the jump instead of 239/241 px.

**2. Rule 3b (hover approach).**
- **Approach test, all five types:** the pointer now rests 300 ms on the datum before the 24 steps. The per-step checks (tooltip shown, same rows, rectangle unmoved) apply from the first step for every type, including bar, scatter and donut.
- **New converse tests**, each with a precondition that the tooltip really is placed beside the bar:
  - **I1 bar, no rest:** on bars that fill the plot's height (author domain [0, 100], six full bars), the same straight path, taken in 6 px moves with no pause, must show the next band once it crosses into it.
  - **I1 bar, after a rest:** the datum is held along the corridor; one move straight up out of the corridor must show the band under the pointer.
  - **I1 bar, fast sweep:** one move per band, across a beside-placed tooltip, must show Q1 to Q6 in turn.
  - **I1 donut, fast sweep:** one move per slice around the ring must show every slice in turn.

**3. Test defect fixed (it surfaced in the A5 dark-scheme palette tests).** `--axylo-default-background` is now a `light-dark()` pair after the stylesheet change in `4504ca4`. Copying the token's text to the page's body resolved it as light, so the dark marks were measured on white and all six A5 dark tests failed. Both places that read it (A5 and `util.defaultBackground`) now resolve it with a probe element inside the figure, so the chart's own scheme applies. After the fix, A5 and the negative controls passed: 46 of 46.

`EVIDENCE.json` now has 555 entries, from the 09:44 run; no titles changed afterwards.

### Runs
Full suite on the bundle built at 09:44 from HEAD `648c819` (core sixth pass `4504ca4`, decision 0004 rule 3b in `169f2cf`), default SVG renderer:
```
      Tests  7 failed | 548 passed (555)
   Start at  09:44:39
   Duration  435.09s (tests 99%, import 1%)
```

Of those seven failures:
- **Six A5 dark-palette tests:** the test defect in item 3, now fixed. After the fix, A5 and the negative controls passed 46 of 46 on the same build. I have not run the whole suite again since.
- **"I1 bar: the tooltip can itself be hovered":** the rows change at step 1, because the path to the beside-placed tooltip crosses into Q3. This is rule 3b, which is still being implemented.

The two readout-height tests now pass on both sides of the limit. So do the three bar converse tests and the donut sweep, since a pointer that has not rested is not held now either. L4 on a `prefers-color-scheme` change also passed on this build. Your official run on a quiet tree is still to come.
