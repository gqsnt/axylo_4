<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh (session rollout turn_context). workspace-write. Verified by the coordinator: npx vitest run --root rehearsal, 31 of 31 pass including the 15 browser grading cases the sandbox could not run. Design by the coordinator (Claude Opus 5.5); design review by gpt-6.2-astra follows. Saved by the coordinator. -->

Implemented DX12 in [rehearsal/](/home/canarit/projects/axylo/rehearsal/). It includes four fixed prompts and fixtures with hand-written expected rows, a [runner](/home/canarit/projects/axylo/rehearsal/run.mjs) for Codex and Claude, a [grader](/home/canarit/projects/axylo/rehearsal/grade.mjs) for Los Angeles and Tokyo, and a [summary](/home/canarit/projects/axylo/rehearsal/summary.mjs) of saved records.

```sh
node rehearsal/run.mjs --agent codex --model YOUR_MODEL_ID --effort high \
  --task daily-visits --workdir /tmp/axylo-runs
node rehearsal/summary.mjs
```

A local stub verified invocation, transcript capture, model recording, and the summary. The non-browser tests passed.

```text
Test Files  2 passed (2)
     Tests  16 passed (16)
```

Chrome failed to launch in the sandbox with `setsockopt: Operation not permitted`, so the 15 browser cases remain unverified. No live agent runs were made.

The visits fixture covers 30 calendar days with 27 observations. The grader accepts each missing day as absent or “No data.” Axylo automatically parses fields made entirely of decimal strings, so the unparsed-string failure test uses mixed numbers and strings in the combined fixture. The workspace copy preserves published examples and omits internal source snapshots. The audit checks paths visible in transcripts. The harness uses the existing public contracts.