# Release benchmark and acceptance evidence review

Separate read-only same-provider Codex review. Requested model `gpt-6.1-sol`, effort `xhigh`. Observed model `gpt-6.1-sol`, effort `xhigh` in rollout `01a201f1-7181-71a1-9fb3-10a68b5b312c`.

The evidence is consistent overall, but release readiness remains blocked by P1, the lifecycle heap result, and pending acceptance cells.

1. **P1 still misses its budget.** The candidate measures **27.40 ms against 10 ms**, exceeding the limit by **17.40 ms**. The proposed 30 ms target has not changed the specification. Optimize further or explicitly revise the budget with its supporting measurements and rationale. [budgets-2026-11-21.md:26](/home/canarit/projects/axylo/bench/results/budgets-2026-11-21.md:26)

2. **The heap failure remains unresolved.** All **40/40 candidate runs** exceed 1% growth; the two medians are **1.169% and 1.168%**. Passing owned-buffer measurements and zero listener, observer, and node deltas do not clear this failure. Investigate retained objects before drawing a leak diagnosis: these records neither identify the objects nor establish unbounded growth. [budgets-2026-11-21.md:34](/home/canarit/projects/axylo/bench/results/budgets-2026-11-21.md:34)

3. **Correct the P3 spot-check denominator.** “0 in 0 runs / 0 in 0 runs” should describe **zero late intervals in 20 runs per renderer**, each covering 300 intervals—6,000 intervals per renderer. The task-time figures, **2.281 / 1.334 ms**, are correct. [budgets-2026-11-21.md:48](/home/canarit/projects/axylo/bench/results/budgets-2026-11-21.md:48)

I directly checked:

- **21 complete records and 840 timed runs**, recalculating task times, pointer p95 values, heap-window growth, medians, pair counts, and block-load ranges. The other table values and margins matched. Interrupted jobs were excluded.
- Sealed artifact hashes, served-file hashes, and candidate source hashes against the working tree. Packed targets remain exactly **118,784 B all / 100,352 B line**. The matched removal reductions are **2,462 / 1,628 B**, as decision 0002 states. Its saved software and GPU verdicts also match the description.
- A **non-release, no-write checker invocation**, using the existing tarball’s verified integrity to avoid packing. It reproduced `acceptance/report.md` exactly. P6 passes; the remaining performance cells and DX5 remain `not run`. Benchmark histories are existence-checked, not numerically graded. [check.mjs:175](/home/canarit/projects/axylo/acceptance/check.mjs:175) [check.mjs:427](/home/canarit/projects/axylo/acceptance/check.mjs:427)
- Existing A3/DX9 waivers are unchanged. By source inspection, pending measurements still block release and cannot be waived; failure, stale-result, and documented-gap rules remain intact. [check.mjs:502](/home/canarit/projects/axylo/acceptance/check.mjs:502)
- The comparison timing table remains pending, so the conditional timing-number spot-check did not apply. [05-comparison.md:88](/home/canarit/projects/axylo/docs/05-comparison.md:88)

The audit checks ended with:

```text
PASS: baseline, candidate and renderer-spot P3 logs each cover 300 intervals per run, with zero intervals over 25 ms.
PASS: both lifecycle records fail the 1% gate in all 40 timed runs.
```

No files changed, builds, benchmark reruns, or release-mode invocation occurred. No contract change is needed. I used the plan’s heap checkpoint windows and median of per-run pointer p95 values when interpreting the spec’s broader wording.
