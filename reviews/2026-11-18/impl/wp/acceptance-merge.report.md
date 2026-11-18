<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed47-7812-7280-9fdd-e013a1a2a093). -->

Merged all 951 indexed acceptance tests, plus distribution and React evidence, into the [matrix](/home/canarit/projects/axylo/acceptance/matrix.json). The [checker](/home/canarit/projects/axylo/acceptance/check.mjs) now accepts multiple reports and roots and prints the sources for each cell. The [regenerated report](/home/canarit/projects/axylo/acceptance/report.md) uses all four available result files. Changes are confined to `acceptance/`. Contract changes needed · none.

| Status | Before, previous run | After |
|---|---:|---:|
| Pass | 13 | 117 |
| Fail | 0 | 11 |
| Weak | — | 128 |
| No evidence | 251 | 18 |
| Not run | 25 | 21 |
| Cannot be verified here | 21 | 15 |
| Not applicable | 266 | 266 |

The previous checker counted partial-only cells under **no evidence**.

**Still without evidence, in reader priority order.** All six chart columns for A9, the WCAG conformance table, then DX9, release compatibility and deprecation, then DX12, the agent rehearsal. P1–P8 remain pending for valid acceptance measurements.

**Where results diverged.** The Chrome report for `77213c0` records five failures. L1 fails at 200% text for line, area, scatter, and donut. Node’s ordinary-layout checks pass for the three Cartesian types. C4 fails for compact bar while the compact line and area model checks pass. I applied A5’s non-color cue requirement to compact bars, since C4 explicitly names lines. The other six failing cells share the DX7 package-size result. Line-only measured **97.61 KiB against 25 KiB**, and everything measured **97.75 KiB against 40 KiB**. [Packed size measurement](/home/canarit/projects/axylo/bench/size-latest.json)

**Weak evidence.** The [prioritized gap list](/home/canarit/projects/axylo/acceptance/report.md:137) names every affected cell and explains what its assertions leave open. For example, F10 verifies incomplete stacks in the model but leaves their displayed readouts unchecked. L8 checks summary visibility without measuring its line count. I1 has no p95 latency result, and I5’s 300 ms check cannot establish the 200 ms limit. The report also records the outstanding screen-reader, Firefox, Safari, phone, and GPU verification.

**Verification.** All 494 Node acceptance tests passed. The broader Node run exited `1` after the React distribution suite hit `spawnSync node EPERM`; its 12 cases were skipped. The supplied distribution reports recorded 83 Node and 18 Chrome passes. I used the supplied browser results without launching Chrome.

```text
Vitest    JSON report written to /home/canarit/projects/axylo/acceptance/results/unit.json
node --test    ℹ tests 1 · ℹ pass 1 · ℹ fail 0
Without test isolation    ℹ tests 12 · ℹ pass 12 · ℹ fail 0
Checker    unit-only exit 0 · combined exit 0 · --release exit 1
```