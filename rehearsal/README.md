# DX12 agent rehearsal

Use one records directory per release rehearsal. Build the published docs and pack the release candidate before running. The harness reads `apps/docs/dist` and `tests/dist/.packed/axylo-0.0.0.tgz`. Installations of Codex CLI, Claude Code, system Chrome, and the repository development dependencies are required. Codex uses the file login at `~/.codex/auth.json`. Claude's `--bare` mode uses `ANTHROPIC_API_KEY` from the launch environment.

```sh
node rehearsal/run.mjs --attempts 3 --parallel 2 --records /tmp/axylo-release-rehearsal
node rehearsal/summary.mjs --records /tmp/axylo-release-rehearsal
```

## Release protocol

- Use the fixed prompts for `daily-visits`, `regional-sales`, `signups`, and `daily-revenue`. Run three fresh, uncoached attempts per task with each of Codex CLI `gpt-6.2-sol` and Claude Code `claude-opus-5-5`. Both request `xhigh` effort and have 20 minutes per attempt. Codex reports the observed model and effort through its rollout. Claude reports the observed model in the stream. Its effort is recorded from the invocation flag because the stream exposes no independent effort field. An observed Claude version suffix is retained and must agree across counted runs for that agent.
- Give each agent the same prompt bytes, published docs, installed package and primary data. Allow reading inputs, writing the answer and running documented Node self-checks within the time limit. Grade after the CLI exits. Keep grading data, expected results and grader output out of the staged inputs and give the agent no feedback or follow-up.
- An invocation fills open slots up to `--attempts` per selected cell. The default is three. `--parallel` caps concurrent attempts and defaults to one. Omit `--agent` and `--task` to run all eight cells. Use one runner invocation at a time for a records directory. `--workdir` selects the scratch parent outside the repository and defaults to the system temporary directory. Records default to `rehearsal/records/`.
- Keep passes, failures and timeouts as counted outcomes. Only voids and infrastructure failures leave slots open. Rerun the same batch to fill those slots after inspecting the saved reason. The new record links to the record it replaces. A timed-out attempt still counts even if killing the process truncates its transcript. Its audit remains unverifiable.
- The release rehearsal passes when every agent × task cell has three passes in its three counted slots, for 24 passes total. The summary also checks that counted records use matching docs, package, task inputs, grader, tool versions and observed model IDs. Keep the release candidate and CLI installations fixed while collecting a batch. An empty summary displays zero counts for all cells.
- Report this as “agent rehearsal: these prompts, these models, Chrome; not user evidence”. With independent runs, three successes have a two-sided exact 95% interval of about 29% to 100% per cell. The counts apply to these line and bar tasks in Chrome and do not establish general success rates or human usability.

## Isolation and audit

Each attempt gets a newly created directory outside the repository with a fresh home, temporary storage and workspace. The workspace contains copies of the published docs, the unpacked package, primary data and prompt, and a writable location for `chart.js` and its helpers. The docs retain published examples and exclude internal source snapshots. The runner applies `chmod -R a-w` to `docs/` and `node_modules/` and removes write permission from the fixture, prompt and package manifest. These file modes protect against accidental writes. A sufficiently privileged or same-owner subprocess can still change modes or replace inputs. The runner verifies staged input hashes before grading, and the browser grader supplies canonical data from the harness.

- **Codex CLI 0.170.0.** The runner assigns a fresh `CODEX_HOME` and symlinks only `auth.json` from the real login. It uses `--ignore-user-config` and `--ignore-rules`, disables apps, plugins, memory and hooks, skips host skill discovery, and disables web search. It uses `-s workspace-write`, `-a never`, and `sandbox_workspace_write.network_access=false`. The CLI help describes `--sandbox` as selecting the sandbox for “model-generated shell commands” and says `--ignore-user-config` still uses `CODEX_HOME` for auth. Workspace-write applies write and network restrictions to agent commands. It allows host reads, and Codex's shell can run more than Node. The prompt and audit constrain use of that wider surface.
- **Claude Code 2.1.327.** The runner sets a fresh `HOME` and `CLAUDE_CONFIG_DIR`, and uses `--bare`, `--restricted`, `--safe-mode`, and `--no-session-persistence`. The help says `--bare` skips auto-memory and `CLAUDE.md` auto-discovery, `--restricted` ignores user, project and local settings and confines file tools to working directories, and `--strict-mcp-config` ignores other MCP configurations. The runner supplies an empty MCP configuration. The help describes `--tools` as the built-ins “to make available” and says permissions that would prompt “are denied automatically” with `--permission-prompts none`. The built-in allowlist exposes file tools and Bash, with `--allowedTools` limiting Bash permission to `node …` and `dontAsk` denying other calls. Web tools and Chrome are absent. Managed settings and managed plugin hooks may still apply. A Node subprocess can have host filesystem and network access through the operating system.
- Both CLIs need their provider transport. These CLI controls give fresh session state and restrict configured tools. They do not provide a filesystem namespace or a transport-only network policy for Claude's Node subprocess. For strictly enforced docs-only reads and network isolation, use external isolation that enforces those boundaries for both CLIs. Keep host managed policies fixed and record them with the rehearsal if they apply.

The audit requires a parseable transcript with the CLI's start and terminal events. Empty, malformed, or truncated transcripts are **unverifiable**. Recorded out-of-workspace paths and excluded tool calls are a second check. Detection covers recorded tool inputs, literal command paths, and symlink targets that can be resolved when auditing. It cannot observe a subprocess's actual reads, dynamically constructed paths or fetches from Node code. “No findings” describes the transcript only.

Each record stores `run.json` with the CLI version, arguments, requested and observed model metadata, elapsed time and status, and SHA-256 hashes of both inputs, their expected results, the prompt, copied docs, packed library and grader. It also stores the transcript, stderr, answer files if present, and the grade and Chrome version if the answer reached Chrome. The disposable workspace and home are removed after saving the record. An interrupted batch may leave an incomplete record or scratch directory.

## Reader grading and verification

The grader uses clean headless Chrome contexts in Los Angeles and Tokyo with English (US) as the page locale. Each answer must handle the original and changed-value input. The alternate signups input has an absent value field that should produce an omission note. Dates are graded as calendar days, including unambiguous month-first and day-first forms. Series labels must match the requested fields. The fixtures declare no measurement unit or currency. The grader opens the standard table control, checks caption, semantic headers and rows, reads the plotted x order and SVG stroke breaks, samples the first calendar date through the plot control, and checks title clipping and omission counts in both the visible note and the accessibility tree.

To regrade, use a workspace with the same packed package installed and the saved answer files restored into it.

```sh
node rehearsal/grade.mjs --task daily-visits --workdir /path/to/prepared/workspace
npx --no-install vitest run --root rehearsal --exclude '**/*.browser.test.mjs'
npx --no-install vitest run --root rehearsal
```

The first Vitest command runs fixture, comparator, audit and local-runner tests without Chrome. The second also runs the browser references and negative controls. The runner exits 0 when all newly scheduled attempts pass or there are no open slots, 1 for any new failed, timed-out or void attempt, and 2 for setup or infrastructure errors. Use the summary to evaluate the whole release rehearsal.
