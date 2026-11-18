<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed4e-2b8a-70c3-b1c3-2704f45e7496). The layout files also carry uncommitted edits by the core's author (value-domain work); the code is committed together with the fourth core pass. -->

Fixed the false AX143 count in layout. The old code carried duplicate tick text from denser candidates into `fit.hidden`, even when every label in the selected set was visible. [labels.ts](/home/canarit/projects/axylo/packages/axylo/src/layout/labels.ts:133)

Number, time, date, and wall-clock x axes and the numeric y axis now report zero hidden tick labels. Repeated date context is part of time formatting. Category axes count each omitted category and each drawn label that was middle-truncated. Wrapping, rotation, and reference labels contribute zero. L1 lists continuous thinning as a remedy and permits distinct middle truncation. I followed the requested property and counted distinct category truncations too. [index.ts](/home/canarit/projects/axylo/packages/axylo/src/layout/index.ts:131) · [references.ts](/home/canarit/projects/axylo/packages/axylo/src/layout/references.ts:61) · [L1](/home/canarit/projects/axylo/docs/02-product-spec.md:111)

The Node regressions reproduced the false count for both instant fixtures before the fix. The phone and four-month fixtures already passed with the deterministic measurer. Added 1,000 generated cases covering continuous and category axes, three locales, widths from 120 to 1,920 px, and both bar orientations. [layout.test.ts](/home/canarit/projects/axylo/packages/axylo/test/layout/layout.test.ts:221)

`npm run typecheck` passed. The requested Vitest run finished with:

```text
 Test Files  17 passed (17)
      Tests  534 passed (534)
   Start at  07:22:31
   Duration  13.46s (tests 86%, transform 7%, import 6%)
```

The controller can keep summing `fit.x.hidden` and `fit.y.hidden`. No contract change is needed. I preserved the concurrent value-domain edits. The browser example remains unverified.