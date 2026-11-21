<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh (session rollout). workspace-write. Checked by the Claude coordinator at the owner's request: benchmark tests 98 of 98 pass outside the sandbox; the change read. Saved by the coordinator. -->

Dropped the idle-machine rule. One-minute load is still recorded at every block start and included in decision results. The runner script starts immediately. The existing Chrome-version, admission and complete-pair checks still apply. I updated the tests, documented the owner’s decision, and verified that the sealed artifact includes `__bench.memory()`. The change uses the existing contracts. [Benchmark README](/home/canarit/projects/axylo/bench/README.md) · [Performance plan §5.1](/home/canarit/projects/axylo/docs/04-plan-performance.md#51-declared-endpoints-provisional-until-the-pilot)

I replayed both families in a temporary directory. All 17 endpoint results retained their block loads. The software family selected SVG under rule 3. The GPU family remains open because `gpu-dpr2-P5-gpu-memory` showed an order effect.

### Tests

`node --test bench/test/*.test.mjs` reported:

```text
ℹ tests 10
ℹ suites 0
ℹ pass 7
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1961.369241
```

The three failing files were `inference`, `noise`, and `provenance`. An in-process retry passed 94 of 98 tests, including all three load-rule tests. The four failures involved sandbox restrictions on subprocess I/O or loopback listening. `bash -n` and `git diff --check` passed. The Chrome measurements are pending.

### Coordinator commands

Run from the repository root. `--dir` selects the saved ledger and the family’s `pilot.json` or `pilot-gpu.json`. The 2,269-byte Canvas cost comes from the earlier decisions for this artifact.

```bash
A=bench/artifacts/20261119T091624Z-b643862f-b78698
D=bench/decision/no-idle-2026-11-21

node bench/decision.mjs decide --family renderer --artifact "$A" --dir "$D" --history-dir bench/history --canvas-bytes 2269
node bench/decision.mjs decide --family gpu --artifact "$A" --dir "$D" --history-dir bench/history --canvas-bytes 2269

node bench/run.mjs --endpoint P2-1M --artifact "$A" --baseline uplot --candidate axylo
node bench/run.mjs --endpoint P4 --artifact "$A" --baseline uplot --candidate axylo
node bench/run.mjs --endpoint P7-mem --artifact "$A" --aa axylo
node bench/run.mjs --endpoint P7-lifecycle --artifact "$A" --aa axylo
```

| Endpoint | Budget check |
|---|---|
| P2-1M | Axylo median `taskMs` over 20 runs ≤ **250 ms**. |
| P4 | Median of Axylo’s per-run `inputToReadoutP95Ms` ≤ **one frame** (16.7 ms at 60 Hz). Each run takes the nearest-rank p95 over 200 moves, counting misses as infinite. |
| P7-mem | `ownedBytes` ≤ **17,600,000 bytes**, or 1.1× the two caller columns. |
| P7-lifecycle | Check for an upward trend in post-GC heap through **1,000 cycles**. The plan’s per-run `heapGate` fails when median heap at cycles 2,000–2,500 exceeds the median at cycles 1,500–2,000 by more than **1%**. |

[Product spec §5](/home/canarit/projects/axylo/docs/02-product-spec.md#5-performance-budgets)