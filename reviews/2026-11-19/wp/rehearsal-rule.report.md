<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Checked by the coordinator: rehearsal Node tests 57 pass. Saved by the coordinator. -->

The summary now applies the owner’s 2026-11-19 rule for 1.0. It prints `rehearsal rule met` when all eight agent × task cells have at least two passes in three counted slots and the records are comparable. It shows each cell’s counts, batch totals, and failure reasons. [Summary](/home/canarit/projects/axylo/rehearsal/summary.mjs) · [Release protocol](/home/canarit/projects/axylo/rehearsal/README.md)

The runner now leaves slots open for authentication failures, provider failures, and CLI exits before model work. Failed grades remain counted, as do harness timeouts without evidence of an infrastructure failure. I verified that the saved Claude login failure reopens slot 1 and that the original record is preserved. [CLI classification](/home/canarit/projects/axylo/rehearsal/agent.mjs) · [Runner](/home/canarit/projects/axylo/rehearsal/run.mjs) · [Tests](/home/canarit/projects/axylo/rehearsal/test/runner.test.mjs)

The two-sided exact 95% interval for 2 successes in 3 trials is **9.43% to 99.16%**. I computed the Clopper–Pearson bounds by solving \(P(X \ge 2)=0.025\) for the lower bound and \(P(X \le 2)=0.025\) for the upper bound, with \(X \sim \mathrm{Binomial}(3,p)\).

**Vitest**

```text
 Test Files  2 passed (2)
      Tests  57 passed (57)
   Start at  09:08:33
   Duration  2.23s (tests 78%, import 13%, transform 9%)
```

**Typecheck** exited 0.

```text
> typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
```

Verification used stubs and the saved trial record. Browser tests and live agent runs were outside this check. No public contract changes were needed.