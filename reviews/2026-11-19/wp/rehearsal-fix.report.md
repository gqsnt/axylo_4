<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Verified by the coordinator: rehearsal suite 74 of 74 pass, browser grading included. Saved by the coordinator. -->

Implemented all five design-review changes in [rehearsal/](/home/canarit/projects/axylo/rehearsal). No contract change is needed.

1. **Isolation and audit.** Each attempt gets a fresh workspace and home outside the repository. The runner removes write permissions from staged inputs, checks their hashes before grading, and deletes the workspace after saving the record. Empty, malformed, or truncated transcripts are marked unverifiable. Recorded paths and excluded tool calls are checked separately. [Isolation and audit details](/home/canarit/projects/axylo/rehearsal/README.md:19)
2. **Reader grading.** The grader checks the table caption and semantic headers, equivalent calendar dates, plotted x order, SVG stroke breaks, visible title clipping, and omission counts on screen and in Chrome’s accessibility tree. The signup reference now displays “Signups.” Browser controls cover bridged gaps, filtered revenue, wrong units, and incorrect, hidden, or inaccessible omission notes. I treated units and currency as unspecified because the prompts and data declare none. [Browser tests](/home/canarit/projects/axylo/rehearsal/test/grade.browser.test.mjs)
3. **Release protocol.** The runner defaults to three fresh, uncoached 20-minute attempts per task for each pinned model at `xhigh` effort. It supports `--attempts` and `--parallel`, keeps failures and timeouts, and links replacements to recorded voids or infrastructure failures. The summary prints all eight cell counts and checks for 3/3 in every cell. [Protocol](/home/canarit/projects/axylo/rehearsal/README.md:10)
4. **Fixtures.** Regional sales quarters are shuffled and independently sorted in the fixture test. Every task has a changed-value grading input and a hard-coding control. The alternate signup input contains one genuinely omitted value. [Fixture tests](/home/canarit/projects/axylo/rehearsal/test/fixtures.test.mjs)

**CLI isolation limits.** Codex 0.170.0 describes `--sandbox` as applying to “model-generated shell commands” and says `--ignore-user-config` still uses `CODEX_HOME` for auth. The runner uses `workspace-write` with command networking disabled, a fresh `CODEX_HOME`, and only a login symlink. Host reads remain possible. Claude Code 2.1.327 says `--bare` skips auto-memory, `--restricted` ignores user, project and local settings and confines file tools, and `--strict-mcp-config` ignores other MCP configurations. Its `--tools` flag lists the built-ins “to make available,” so the runner excludes web tools there and allows Node through Bash. Claude’s Node subprocess can still read host files and fetch over the network. The transcript audit cannot see those operations. Claude’s bare mode requires `ANTHROPIC_API_KEY`, and its stream does not independently report effort.

**Verified locally.** `npm run typecheck` and `git diff --check` passed. Both installed CLIs parsed the launch flags in help mode. The Node suite exercised fixture derivation, transcript audit, stub launches, timeouts, cleanup, and replacement rules.

```text
Test Files  2 passed (2)
     Tests  43 passed (43)
```

**Coordinator verification.** The 31 Chrome cases and live rehearsal remain unrun. Run the full suite in a Chrome-capable environment before collecting the release batch.

```sh
npx --no-install vitest run --root rehearsal
node rehearsal/run.mjs --attempts 3 --parallel 2 --records /tmp/axylo-release-rehearsal
node rehearsal/summary.mjs --records /tmp/axylo-release-rehearsal
```