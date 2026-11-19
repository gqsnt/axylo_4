# Analysis: what does a 24 of 24 agent rehearsal show?

You are the analyst. Read-only: edit nothing; your final message is the deliverable. Repository: /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library; read `AGENTS.md`). Spec row DX12 in `docs/02-product-spec.md`. The harness is `rehearsal/` (read `README.md` and the code); your own earlier design review of it is `reviews/2026-11-19/wp/rehearsal-design.review.md`, and the changes made after it are in `git log -- rehearsal`.

## The batch

Release candidate 1e93128 (library, packed package and docs built from that commit). Records in `rehearsal/records/release-1e93128/` (not in git; read them on disk): 24 attempts, 3 per task for each of Codex CLI `gpt-6.2-sol` and Claude Code `claude-opus-5-5`, both requested at xhigh; observed models as requested; Claude's effort is not reported by its stream. First run: 8 pass, 16 void, because the transcript audit read strings in code as paths. After the audit fix (commit 37970cb) every record was re-audited from its saved transcript and the voided ones were regraded from their saved answers (`node rehearsal/reaudit.mjs`; history in each `run.json`): 24 of 24 pass. The owner's rule for 1.0 is at least 2 of 3 per agent-and-task cell.

## Questions

1. **Is the pass real?** For each task, read the agents' answers (`answer/chart.js` in each record) and transcripts. Did the agents handle each trap the way the documentation teaches (UTC-midnight instants as calendar dates, mixed numeric strings, missing days, the misspelled field), or did they pass because the library's defaults handled it, or because the grade is lenient? Name any answer that passes but that a careful reviewer would call wrong, and say which grading criterion should have caught it.
2. **What did the agents read?** From the transcripts: which documentation pages and package files each agent used, whether the docs answered their questions, where agents struggled or guessed, and how long attempts took. This is the useful part for the docs: list concrete documentation gaps or confusions the transcripts show, with the page and what was missing.
3. **The re-audit.** Check that re-auditing and regrading was sound: the audit changes (37970cb) only remove false positives (each of the 15 is a string, not an access), the one real look outside (`codex daily-revenue-3`, `/AGENTS.md`, `/tmp/AGENTS.md`) found nothing, and the regraded answers are the saved ones. Say whether you would accept this batch as the release record or require a fresh batch.
4. **Bias.** The harness was built by gpt-6.2-sol, which is also one of the two agents under test; its design was reviewed by you. Is there anything in the prompts, fixtures or grader that favours one agent family? Anything the two families did differently?
5. **What the record may claim**, in two or three sentences for the conformance and stability pages, and what it must not claim.

Concrete and short; cite record names and file lines.
