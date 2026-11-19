<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Checked by the coordinator: full rehearsal suite 119 pass with Chrome. Saved by the coordinator. -->

Fixed the [audit](/home/canarit/projects/axylo/rehearsal/audit.mjs) to use recorded file-tool paths and [shell operands](/home/canarit/projects/axylo/rehearsal/shell.mjs). Missing paths outside the run directory are recorded without voiding the attempt. Existing outside paths and accesses to forbidden zones still void.

Added [reaudit.mjs](/home/canarit/projects/axylo/rehearsal/reaudit.mjs) to verify input and grader hashes, restore eligible saved answers, and regrade them with the runner’s grader. It preserves the original slot, transcript, answer, and verdict history. The [summary](/home/canarit/projects/axylo/rehearsal/summary.mjs) reports the latest verdicts and the number of re-audited records.

Auditing copies of all 24 transcripts cleared all 15 false positives. `daily-revenue-3` recorded `/AGENTS.md` and `/tmp/AGENTS.md` as missing. All 24 records matched the prepared input and grader hashes. Version 1 records use the replay host for existence checks because they lack saved filesystem observations.

The non-browser run ended with:

```text
Test Files  3 passed (3)
     Tests  87 passed (87)
  Duration  2.38s (tests 81%, import 15%, transform 4%)
```

`npm run typecheck` exited 0. The Chrome replay test was added and remains unrun. The saved batch is untouched, and no contract changes are needed.

Coordinator commands from the repository root:

```sh
node rehearsal/reaudit.mjs --records rehearsal/records/release-1e93128
node rehearsal/summary.mjs --records rehearsal/records/release-1e93128
```