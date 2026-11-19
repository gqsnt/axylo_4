# DX12 agent rehearsal

Run from the repository root with an authenticated Codex CLI or Claude Code installation, the existing development dependencies, system Chrome, and the built documentation and packed Axylo tarball.

```sh
node rehearsal/run.mjs --agent codex --model YOUR_MODEL_ID --effort high --task daily-visits --workdir /tmp/axylo-runs
node rehearsal/summary.mjs
```

Use `--agent claude` for Claude Code. The runner applies `--effort` to Codex. Claude's stream reports the model and leaves the observed effort empty. The task IDs are `daily-visits`, `regional-sales`, `signups`, and `daily-revenue`. The runner uses the system temporary directory if `--workdir` is omitted and creates a fresh subdirectory for each run. The agent has 20 minutes by default. To override that limit, pass `--timeout-ms` in milliseconds.

The workspace draws from `apps/docs/dist` and `tests/dist/.packed/axylo-0.0.0.tgz`. The docs include their published examples and omit the internal repository snapshots linked from conformance evidence. The fixture and fixed prompt are the other inputs. The grader supplies the original fixture to `render`, so changes to an agent's scratch copy of `data.json` cannot change the data being graded.

The runner keeps each run under `rehearsal/records/` with the transcript, stderr, delivered chart if present, grade, and run metadata. The transcript audit checks recorded command lines and tool inputs for paths outside the workspace, with exceptions for system executables and `/dev/null`. It reports detected paths and any malformed transcript lines. It can only check accesses visible in the transcript and paths it can resolve. A void run remains in the summary with its grade for inspection. These records are agent rehearsal only.

To regrade a prepared workspace, use the workspace path printed by the runner.

```sh
node rehearsal/grade.mjs --task daily-visits --workdir /path/to/run/workspace
```

The grader uses two headless Chrome contexts with English (US) formatting and different time zones. The expected JSON gives table rows in reading order. An expected `null` is a missing observation. The table may omit a wholly missing row or label it “No data.” Chart types are read from Axylo's accessible plot description or generated summary. The grader opens the standard “View as table” control.

The runner and standalone grader return 0 for a pass, 1 for a failed grade or void run, and 2 for a setup or tool error.

```sh
npx --no-install vitest run --root rehearsal
npx --no-install vitest run --root rehearsal --exclude '**/*.browser.test.mjs'
```

The first command includes the Chrome tests. The second checks the fixtures, audit, agent invocation, workspace setup, and pre-browser grading without opening Chrome.
