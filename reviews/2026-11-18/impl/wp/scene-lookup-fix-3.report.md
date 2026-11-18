<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed9f-8dbe-7c41-94c6-3853d7e035b9). -->

**Donut.** The 0.1% slice had a 0.997 CSS px outer arc in the Node reproduction, so the separator consumed it. Every positive slice now gets at least 1 CSS px of fill at mid-radius, with 1 CSS px separators. Wider slices give up space proportionally. The ring keeps its input order and full sweep, and the lookup uses the adjusted geometry while reporting the original values and shares. [Scene](/home/canarit/projects/axylo/packages/axylo/src/scene/index.ts:73) · [Donut geometry](/home/canarit/projects/axylo/packages/axylo/src/view/donut-geometry.ts:7) · [Donut lookup](/home/canarit/projects/axylo/packages/axylo/src/lookup/donut.ts:35)

**Scatter.** SVG rounding made `second` about 0.006 CSS px closer at the modeled midpoint in both row orders. Normalization preserved the caller’s row indexes, so `src/data` needs no change. The lookup now measures ties from the closest point and selects the later source row. [Scatter grid](/home/canarit/projects/axylo/packages/axylo/src/lookup/scatter-grid.ts:230)

Suggested `Lookup.pick` comment

> Among scatter points within 24 CSS px, choose the latest source row whose pointer distance differs from the closest point’s by less than half a device pixel.

Two core changes remain with the coordinator. Pass `pixelRatio` as the sixth `buildLookup` argument and include it in the scatter lookup cache key. Use `donutGeometry` for donut focus outlines so they follow widened slices. [Controller](/home/canarit/projects/axylo/packages/axylo/src/core/controller.ts:1314) · [Focus](/home/canarit/projects/axylo/packages/axylo/src/core/focus.ts:234)

Both fixture regressions failed before the fix and passed after it. Added 1,500 donut property runs covering path presence, positive area, order, non-overlap, and gaps. Scatter tests cover reversed source order, device pixel ratios, the strict tie threshold, and the 24 CSS px cutoff. Typecheck and all 27 renderer unit tests passed. The fixture rectangles were modeled in Node from the browser setup. Browser acceptance remains unverified.

```text
 Test Files  24 passed (24)
      Tests  636 passed (636)
   Start at  08:55:41
   Duration  16.71s (tests 86%, transform 9%, import 5%)
```