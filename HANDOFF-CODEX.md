# Hand-off: you now run the Axylo project to its 1.0 release

This is the complete brief for a Codex session that takes over the Axylo project as its only agent. It was written on 2026-11-20 by the previous coordinator (Claude Opus 5.5) on the owner's instruction: "the project will be handled next by codex only". Read all of it before doing anything, then read the files it names.

## For the owner: how to start this session

Interactive (recommended, so you can answer its questions and grant pushes):

```sh
cd /home/canarit/projects/axylo
codex -m gpt-6.2-astra -c model_reasoning_effort="medium" -s danger-full-access -a on-request
```

then paste: `Read HANDOFF-CODEX.md and follow it.`

Why `danger-full-access`: under `workspace-write` the sandbox keeps `.git` read-only (no commits) and blocks the sockets Chrome needs (`setsockopt: Operation not permitted`), so the browser suites, the docs build's checks, the benchmarks and the rehearsal cannot run. `-a on-request` keeps you asked before anything the session judges risky. If you prefer to keep `workspace-write`, the session can only edit and run Node tests, and you would commit and run the browser suites yourself.

---

## 1. Your role

You are the project's coordinator and its only worker: you plan, code, test, review through a separate read-only run (section 8), commit, keep `STATUS.md` current, and report to the owner. Everything below the owner's decisions is yours to decide; anything listed in section 2 as the owner's is not.

`AGENTS.md` (which Codex loads on its own) was written for worker agents in a shared checkout. Two of its rules change for you: "Do not commit. The coordinator commits." becomes "commit your own verified work"; "Stay in your files" becomes "you own the whole repository, but never touch other projects". Everything else in `AGENTS.md` holds (fixed contracts, no runtime dependencies, tests from the spec, typed arrays on hot paths, no DOM at import time, diagnostics through the `DiagnosticSink`).

## 2. The owner and the rules they set

The owner is a solo developer (owner-architect) with no colleagues and no study participants: never propose recruiting users or participants, and never add a gate that needs them. They write short, non-native English with typos ("continue", "do it"): read generously, never ask about a typo. They often hand over packs drafted with ChatGPT (`~/Downloads/*.zip`, folders with START_HERE or MANIFEST files).

The owner's rules, from their own instruction file, apply to you in full:

1. **Authorization is per action.** Push, merge, tag, publish and delete each need their own explicit grant; a past approval is not standing permission ("push for CI" is not "merge"). Never publish to npm or any registry, never force-push, never delete branches unless told.
2. **No routine GO.** Local edits, tests and commits inside the task are pre-authorized. Do not stop after a plan, a report or a first step to ask whether to continue: continue to real delivery. A mockup or "more research needed" is not completion.
3. **SHAs in packs are anchors, not reset targets.** Never reset the repository. Inspect the live state, keep newer and unrelated work, reconcile narrowly (`git apply --check` first).
4. **Honest evidence.** Never weaken a test or edit an expected value to make it pass. Keep "observed", "inferred" and "agent rehearsal" apart. A baseline expected failure is not a repaired pass. CI results do not transfer across commits. Cross-compiling is not native Windows; never weaken Windows coverage.
5. **Record requested and observed model and effort** from harness metadata (for Codex: the session rollout, section 8), never from a profile name or a model's own claim. Never guess a model ID; never silently substitute a provider or model.
6. **Independent review.** Nobody certifies their own work. A missing response, a timeout or an unavailable model is never approval.
7. **Smallest coherent change.** Keep the current design unless an alternative pays for itself; do not manufacture defects, gates or busywork; ask before turning a proposal into a decision.
8. **Time budgets are ceilings, not targets.** If interrupted, commit a resumable checkpoint (`STATUS.md`) with the exact next action; never call interrupted work complete.
9. **Pause.** When the owner says stop, stop; resume only on their explicit word. Finished jobs, reconnects and restarts are not permission.
10. **Housekeeping.** Do not delete caches or other projects' files unless asked (list them, then wait for "Yes, delete it"). Check a process's identity before killing it, and never kill by pattern. Do not edit the owner's own goal or instruction files. Leave Codex rollouts as they are.

Machine facts the owner wants respected: the PC restarts often and `/tmp` is a tmpfs that is wiped on restart. When the owner says "continue" after a restart, first check the real state (git, running processes, interrupted runs, what is on disk), recover, report, then go on. Keep large build scratch and anything you need to keep out of `/tmp`; scratch goes in a directory you create inside the project and remove.

Also from the owner, for this project:
- **CI:** the GitHub repository's Actions cannot run (billing on the owner's account). The owner knows. Do not check CI, do not report on it, do not ask about it. Local runs are the check.
- **Privacy:** the owner's email address appears in commit metadata; never put it, or any personal detail, into a request to an outside service.

## 3. The project

Axylo is an MIT-licensed TypeScript browser charting library with no runtime dependencies: line, area, bar, scatter and donut charts plus a compact variant, aimed at being faithful to the data, readable everywhere and accessible by default. Read, in this order:

1. `STATUS.md`: what is true now, the owner's binding decisions, what is left. Current as of the hand-off.
2. `docs/02-product-spec.md`: the specification, every acceptance criterion (F, L, I, A, C, DX, P rows), the diagnostics registry (section 3.5), the type matrix (3.6).
3. `docs/03-plan-typescript-release.md` (the release plan; milestone M8 holds the release gate) and `docs/04-plan-performance.md` (the benchmark method, section 5.1).
4. `docs/decisions/0001` to `0004` (interaction pattern, mark renderer, palette, tooltip and focused text, with clarifications).
5. `acceptance/README.md` (the matrix, checker, provenance, engines, release gate), `rehearsal/README.md` (the agent rehearsal and its protocol), `bench/README.md`, `research/README.md`.
6. `docs/05-comparison.md` (Axylo against ten libraries) and `CHANGELOG.md` (draft).

Layout: `packages/axylo` (the library: `src/core/contracts.ts` and `src/public.ts` are the fixed interfaces; a change there is a contract change: make it only when the work needs it and say so in the commit), `apps/docs` (documentation site), `tests/dist` (tests on the packed package), `acceptance` (matrix, checker, recorded results), `rehearsal` (agent rehearsal harness), `bench` (benchmark harness), `research` (Phase 1 landscape study and harness), `reviews` (every brief, report and review, with provenance), `scripts` (build, pack, size).

## 4. Machine and tools

- Ubuntu, NVIDIA RTX 2060 SUPER, Wayland. Node 24, TypeScript, Vitest, fast-check, esbuild, playwright-core; system Chrome (via `channel: 'chrome'`, currently 158); Playwright Firefox 159 and WebKit 27.2 are installed under `~/.cache/ms-playwright`. WebKit on Linux is the engine, not Safari.
- Not available here: Safari, Edge, Windows, macOS, a real phone, a screen reader.
- The machine runs the owner's other projects too (`~/projects/concord_v5`, `lapel`, others). Never touch them. Their builds can push the load very high, which matters for benchmarks (section 6, step 1).
- Codex CLI 0.170.0; Claude Code CLI 2.1.327 (used only as an agent under test in the rehearsal). Model IDs: confirm in `~/.codex/models_cache.json` (key `slug`) before use; `gpt-6.2-sol` and `gpt-6.2-astra` exist.
- Remote `origin` = `https://github.com/gqsnt/axylo_4` (private). Pushing needs the owner's word each time.

## 5. Commands

```sh
npm run typecheck                     # library, API examples, distribution tests
npm test                              # Node: unit, property and acceptance-through-the-controller tests
npm run build                         # packages/axylo/dist (the shared build the browser suites load)
npm run test:browser                  # every browser suite in system Chrome, SVG renderer
AXYLO_RENDERER=canvas AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart packages/axylo/test/browser/a11y
AXYLO_ENGINE=firefox AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser    # also webkit
npm run test:dist && npm run test:dist:browser                                     # the packed package
node scripts/pack.mjs && node scripts/size.mjs --no-build                          # pack, then sizes against the targets
node apps/docs/build.mjs                                                           # docs site (refuses if dist is not the build of the source)
AXYLO_BROWSER=1 npx vitest run --config apps/docs/vitest.config.ts                 # docs examples in the browser
npx --no-install vitest run --root rehearsal                                       # rehearsal harness tests
node --test acceptance/test/*.test.mjs                                             # checker tests
node acceptance/check.mjs                                                          # matrix check (static)
```

Recording evidence (each writes `acceptance/results/<config>.json` and a provenance sidecar; the tree must not change while it runs):

```sh
node acceptance/run.mjs unit
node acceptance/run.mjs dist
node acceptance/run.mjs dist-browser
node acceptance/run.mjs browser
AXYLO_ENGINE=firefox node acceptance/run.mjs browser
AXYLO_ENGINE=webkit node acceptance/run.mjs browser
node acceptance/check.mjs --release --results acceptance/results/unit.json acceptance/results/browser.json \
  acceptance/results/browser-firefox.json acceptance/results/browser-webkit.json \
  acceptance/results/dist.json acceptance/results/dist-browser.json
```

## 6. What is left for 1.0, in order

### Step 1. Performance (the owner said "we will do perf ben later": start it only on the owner's word)

1. If any file under `packages/axylo/src` changed since commit b643862, rebuild the artifact (`node bench/build.mjs`, note the directory it prints) and set `A=` in `bench/results/run-2026-11-19.sh` to it (commit that). Otherwise the existing artifact `bench/artifacts/20261119T091624Z-b643862f-b78698` stands.
2. Run `bench/results/run-2026-11-19.sh` in the background with its output kept on disk (it appends to `bench/results/run-2026-11-19.log`). It runs both families of the decision procedure (`renderer`, software rasterization, about 3.2 h; `gpu`, about 2.2 h): three control sessions, a pilot, the endpoints and the decision per family, and waits before every session until the one-minute load has stayed under 1.0 for ten minutes. The procedure discards any block measured on a busy machine, so do nothing heavy while it runs and tell the owner the machine must stay quiet. If it is interrupted, read the log and rerun only the missing steps: `node bench/decision.mjs <controls|pilot|endpoints|decide> [--family gpu] --artifact <A>`, or `--only <ids>` for ineligible endpoints.
3. Then the Phase 1 timing step, on the same quiet machine: in `research/harness`, `node packed-axylo.mjs`, `npx vite build`, serve with `npx vite preview --port 4173 --strictPort` (stop it afterwards), and `node probe.mjs perf` plus the tuned set listed in `research/README.md`. Commit the results.
4. Analyse, thoroughly (this is the work that most needs care):
   - every budget P1 to P8 (`docs/02-product-spec.md`, the P rows; method `docs/04-plan-performance.md` 5.1) against the measurements: met, missed (by how much), or not measurable here and why;
   - the renderer decision (`docs/decisions/0002-mark-renderer.md` is provisional and says what the measurements must show to confirm or reverse SVG as the default);
   - the timing table of `docs/05-comparison.md` with Axylo beside the ten libraries, measured under the same conditions.
5. Where a budget is missed: profile, fix the cause in the library with a test that fails before the fix, keep sizes under the targets (`node scripts/size.mjs --no-build` after packing), rerun the full test set (section 7), then re-measure only the affected endpoints on a quiet machine. Do not change a budget or a threshold to make it pass; a budget change is the owner's decision, with the measurement and a written reason in the spec.
6. Update the matrix's P rows and DX5 (they read "pending" until measurements are recorded) with the recorded evidence, through the checker's citation forms (`acceptance/README.md`), and regenerate `acceptance/report.md` with `node acceptance/check.mjs --write`.

### Step 2. The release commit

1. Make sure the tree is clean and every change is committed. Freeze: `npm run build`, `node scripts/pack.mjs`, `node apps/docs/build.mjs`, `node scripts/size.mjs --no-build` (both targets met).
2. Run the full test set (section 7) on that build. Fix any failure properly (no weakened test), and if you fix anything, start step 2 again.
3. Record the six configurations (section 5), on a quiet tree, with nothing else writing to the repository.
4. Repeat the agent rehearsal at this commit: `node rehearsal/run.mjs --attempts 3 --parallel 2 --records rehearsal/records/release-<short commit>`, then `node rehearsal/summary.mjs --records rehearsal/records/release-<short commit>`. Its protocol (fixed in `rehearsal/README.md`) runs Codex CLI `gpt-6.2-sol` and Claude Code `claude-opus-5-5`, both at xhigh; the owner's rule is at least 2 of 3 counted attempts per agent-and-task cell. The Claude half needs the machine's Claude Code login; if an attempt reports that the login expired, that is an infrastructure failure (the slot stays open): ask the owner to run `claude auth login`. If the owner wants the rehearsal to use Codex only, that changes the protocol: ask, then change `rehearsal/README.md` and `summary.mjs` accordingly. Before counting, read every void's reason; the last batch found an audit defect that way. Register the harder revenue input `rehearsal/fixtures/daily-revenue.grammar.json` first (the README's "For the next release" section says how and why).
5. Run the release check (section 5). It must exit 0 under the owner's gate: every cell passes, is not applicable, is weak with a written gap and all its cited results passing, or is waived by the owner. If it does not, fix the cause (missing results, a failing test, a gap that is not written down); never add a waiver yourself.
6. Rebuild the docs (`node apps/docs/build.mjs`) so the conformance page counts the recorded results; check the page says what the checker says.
7. Update `CHANGELOG.md` (evidence, sizes, performance results) and `STATUS.md`. Commit.

### Step 3. Version, tag, publish

Each only on the owner's explicit word, one at a time: the version number (the package is `0.0.0`; the changelog says "Unreleased"), the date in the changelog, a git tag, a push to `origin`, an npm publish. Ask for each; do not bundle them.

## 7. The full test set (run it before every release-relevant commit)

`npm run typecheck`; `npm test`; `npm run build`; `npm run test:browser`; the canvas run of `chart` and `a11y`; the Firefox and WebKit runs of `packages/axylo/test/browser`; `npm run test:dist` and `npm run test:dist:browser`; `node apps/docs/build.mjs` and the docs browser tests; `npx --no-install vitest run --root rehearsal`; `node --test acceptance/test/*.test.mjs`; `node acceptance/check.mjs`; sizes. Long browser runs take 10 to 20 minutes each: run them in the background and keep their output in a log file inside the project (`acceptance/results/verify-<commit>/` is the convention; it is ignored by git).

Evidence rules: report exact counts (passed, failed, skipped, not run) and which commit and build they ran on. Say plainly what was not run. A result recorded on one commit says nothing about another.

## 8. Review and provenance

- **Independent review (owner's rule 6).** Do not certify your own changes. For any non-trivial change (library code, the checker, the matrix, the rehearsal harness, a decision document), run a separate read-only reviewer and act on its findings: `codex exec -m gpt-6.2-sol -c model_reasoning_effort='"xhigh"' -s read-only -C /home/canarit/projects/axylo --json -o <report.md> - < <prompt.md> > <events.jsonl>` (put the brief, report and events under `reviews/<date>/wp/`). Such a review is same-provider (OpenAI reviewing OpenAI): label it so, never as cross-provider. Give the reviewer the code and the spec, not your conclusion.
- **Observed model and effort:** the reviewer's rollout file `~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread_id>.jsonl` (the thread id is the first `--json` event), fields `turn_context.payload.model` and `.effort`. Record both, requested and observed, in the report's header and in the commit message. Read rollouts; never edit them.
- **The provider may refuse a review prompt** as a "possible cybersecurity risk" (it happened once with words like "break an invariant"); reword the brief plainly as a software quality review and rerun with the same model and effort, keeping the failed run's log.
- **Commit messages** say what changed and why, the verification you ran with its counts, and the model that did the work (for example "(Codex gpt-6.2-astra medium)"). Commit with targeted paths, never `git add -A` across unrelated files.

## 9. Restart recovery and checkpoints

At the start of every session and after any interruption: `git status`, `git log --oneline -5`, running processes of your own (benchmark script, test runs), the last lines of any run log, `STATUS.md`. Recover, tell the owner in two or three lines what you found, then continue. Keep `STATUS.md` current after every commit: what is true now, what is running, the exact next command.

## 10. Never

- Never push, tag, publish, merge or delete a branch without the owner's word for that action.
- Never change a test's expected value, a budget, a size target, a threshold or the release gate to make something pass.
- Never add a waiver to the matrix: only the owner grants them (existing waivers: A3, no screen-reader rehearsal; DX9, first release).
- Never touch other projects or their build folders; never kill a process you did not start.
- Never check or report on GitHub CI.
- Never store anything you need in `/tmp`.

## 11. Reporting to the owner

Short and plain: what is done (with the evidence and counts), what is not, what needs their decision. One question at a time, with your recommendation. Do not ask permission for work this brief already authorizes; do ask for every item in section 10.
