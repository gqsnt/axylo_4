# Design review: does this agent rehearsal test what spec DX12 asks?

This is an ordinary software quality review of a test harness for a charting library's documentation. You are the analyst: read-only, do not edit anything; your final message is the report. Repository: /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library). Read `AGENTS.md`, then the DX12 row of `docs/02-product-spec.md`:

> A coding agent gets the first chart right. Given fixed prompts and trap fixtures (UTC-midnight ISO dates, numeric strings, unsorted rows, missing days, a misspelled field), an agent with only the published docs produces a chart with no error diagnostics that passes the reader criteria. Recorded as agent rehearsal, not as user evidence.

The harness is `rehearsal/` (read `rehearsal/README.md`, every file in it, the fixtures with their `.expected.json`, the prompts, the tests). It was designed by the coordinator (brief: `reviews/2026-11-19/wp/rehearsal-harness.prompt.md`) and built by another Codex run (report: `reviews/2026-11-19/wp/rehearsal-harness.report.md`). Its tests pass, browser grading included. No agent has been rehearsed yet. The documentation the agents will read is `apps/docs/pages/*.md` (built to `apps/docs/dist`); the library's behaviour for each trap is in `packages/axylo/src/diagnostics/registry.ts` (AX101, AX104, AX111 and the others) and `apps/docs/pages/data.md`.

## Questions to answer

1. **Validity.** For each of the five traps the spec names, does a fixture contain it in a form a real back end would send, and would a typical first attempt by an agent that does not read the relevant documentation fail the grade, while an agent that follows the documentation passes? Name any trap that the library handles silently anyway (so the trap tests nothing), and any trap where the grade could pass with a wrong chart. Check the expected tables by your own reasoning from the fixtures and the documentation, not by running Axylo.
2. **Grading.** Are the grader's criteria exactly DX12's ("no error diagnostics", "passes the reader criteria"), neither stricter nor looser? What does "the reader criteria" have to mean here, given the spec's reader-facing rows (A1 name, A4 table, F2 gaps, F4 dates, F11 order, F12 note)? Is anything a reader would notice not graded (wrong chart type, the wrong series, a truncated title, the "Values not shown" note when values were dropped silently by the agent's own code)?
3. **Isolation and fairness.** Can the agent reach anything besides the docs and the packed package (the repository, the web, its own memory of an earlier run)? Is the transcript audit sufficient to void a run that did? Are the prompts neutral (no hint of the trap), and equal for the two agent families (Codex CLI and Claude Code)?
4. **What a result can and cannot claim.** How many runs per agent and task are needed before a pass rate means anything, given that runs are not deterministic? Propose the smallest protocol that gives an honest record (which models, how many runs, what counts as the rehearsal "passing" for 1.0), and what the record must say about its limits.
5. **Changes.** List the changes the harness needs before its results count, most important first, each concrete enough to implement (file, what to change). Separate "must change" from "would be better".

Be concrete and short; no general advice.
