# Benchmarks: drop the idle-machine rule (the owner's decision)

You are working in /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library). Read `AGENTS.md`, `STATUS.md`, `bench/README.md` and `docs/04-plan-performance.md` section 5.1. You cannot commit (`.git` is read-only in your sandbox) and you cannot launch Chrome; the coordinator commits and runs the measurements. Never touch other projects.

## The owner's decision (2026-11-21, verbatim)

"pc under 10% usage is like not really used. stop with your crazy rules." The rule that a benchmark session counts only if the one-minute load was under 1.0 at the start of every block is dropped. Earlier the same day the owner also said of the run started without the idle wait: "count it as release evvidence".

## What to do

1. In `bench/src/decision.js` (`sessionEligibility` and wherever the load limit is applied), `bench/decision.mjs` and `bench/run.mjs` (if they wait for or gate on load): the load is still recorded in every block and result, as information, and never makes a block or session ineligible. Keep the other eligibility rules (one Chrome version per session, admission, complete pairs) exactly as they are.
2. Update the tests in `bench/test/` that assert the old rule. These tests change because the owner changed the rule, not to make code pass: say so in a comment on each changed test. Add a test that a session at a one-minute load of 8 is eligible and that the load appears in its record.
3. Update `docs/04-plan-performance.md` 5.1 and `bench/README.md` to state the new rule as the owner's decision of 2026-11-21, with the owner's reason in their own words. In `bench/README.md` also correct the statement that the library has no `__bench.memory()` hook for P7-mem: check `packages/axylo/src/core/instrument.ts` and describe what it returns now.
4. Make `bench/results/run-2026-11-19.sh` stop waiting for an idle machine (keep it runnable).
5. Write down, for the coordinator, the exact commands to (a) re-run `decide` for both families on the records of the 2026-11-21 run (`bench/decision/no-idle-2026-11-21/`, artifact `bench/artifacts/20261119T091624Z-b643862f-b78698`; read how `decision.mjs` finds its ledger and pilots), and (b) measure the remaining budget endpoints P2-1M, P4, P7-mem and P7-lifecycle on that artifact (`bench/README.md`, "Budget endpoints outside both families"), with how each result is judged against its budget in `docs/02-product-spec.md`.

Do not change any budget, tolerance or threshold other than the load rule. Run `node --test bench/test/*.test.mjs` and report the last lines. Final message: what changed, the tests, the exact commands for the coordinator.
