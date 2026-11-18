<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ecaf-0fdc-7631-a7e1-58ed8c0b7479). -->

Built the [acceptance matrix](/home/canarit/projects/axylo/acceptance/matrix.json) with 61 criteria and 35 chart-type rules, a dependency-free [checker](/home/canarit/projects/axylo/acceptance/check.mjs), fixture tests, and a [README](/home/canarit/projects/axylo/acceptance/README.md).

The [report](/home/canarit/projects/axylo/acceptance/report.md) records **13 pass, 0 fail, 251 no evidence, 25 not run, 21 cannot be verified here, and 266 not applicable** after joining the latest unit results.

**Highest-priority gaps**

1. **Data fidelity.** F2 and F3 have only partial evidence across all six chart types. F12 still needs changed-value disclosures verified in the accessibility tree and in production. F10 lacks complete stack coverage for area, bar, and compact. F8 lacks end-to-end coverage for donut edge cases.
2. **Accessible reading.** A1 and A5 lack full evidence for every type. A2 has partial keyboard evidence, and A4 has line browser coverage awaiting execution and gaps for area, bar, scatter, and donut. A3 requires screen-reader rehearsal.
3. **Legibility and interaction.** L8 lacks full fallback evidence for all five full chart types. I1 lacks end-to-end pointer evidence across those same types, including the p95 latency check. Compact C1–C4 have partial evidence. A9 still needs the published WCAG conformance table.

The [prioritized gap list](/home/canarit/projects/axylo/acceptance/report.md:120) names every affected chart type and explains what each weak test leaves unchecked.

**Verified.** The checker exited `0` with and without the Vitest report. `--release` exited `1` on coverage gaps. The six checker cases passed.

```text
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

The latest Vitest run recorded 590 passing assertions, a normalization timing failure at 125.2 ms against a 100 ms threshold, and a palette suite that could not load `research/palette/palette.json`. Those failures are recorded separately from acceptance-cell results. Browser tests were not run.

Section 3.6 cells that say “No” are checks of feature absence. Archived benchmark measurements are linked without verdicts while limits remain provisional. No contract changes are needed.