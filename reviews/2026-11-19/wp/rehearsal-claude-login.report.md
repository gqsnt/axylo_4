<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Checked by the coordinator: rehearsal Node tests 45 pass. Saved by the coordinator. -->

Claude rehearsal attempts now keep `--bare` and pass through a nonempty `ANTHROPIC_API_KEY`. Otherwise they run in `fresh-config` mode with a fresh `HOME` and `CLAUDE_CONFIG_DIR` containing only a symlink to `~/.claude/.credentials.json`. The runner creates and removes the link without opening or copying the credential. [agent.mjs](/home/canarit/projects/axylo/rehearsal/agent.mjs), [workspace.mjs](/home/canarit/projects/axylo/rehearsal/workspace.mjs)

`run.json` records `claudeMode` in both cases. The audit and model check use the transcript, with the model taken from assistant messages. The runner requests `xhigh` and records effective effort as `null` because the stream exposes no effort field. [run.mjs](/home/canarit/projects/axylo/rehearsal/run.mjs)

### Claude Code 2.1.327 help

- `--bare` says authentication is “strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings” and “OAuth and keychain are never read.”
- `--safe-mode` disables customizations including `CLAUDE.md`, skills, installed plugins and hooks. `--disable-slash-commands` says “Disable all skills and commands.”
- `--restricted` “ignores user, project and local settings files” and “confines the file tools to the working directories.” `--strict-mcp-config` uses only `--mcp-config`, which the runner supplies empty. `--no-session-persistence` disables session saves in print mode. These restrictions are available independently of `--bare`.

The staged workspace has no local Claude customizations or saved memory. Fresh-config mode also explicitly disables auto-memory with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a switch present in the installed CLI. Built-in plugins, admin-managed settings and managed plugin hooks can still apply. [README.md](/home/canarit/projects/axylo/rehearsal/README.md)

### Verification

Both stub modes passed. The tests verified that the runner opened neither credential path, removed the link and left the fixture credential’s contents and permissions intact. Live OAuth, token refresh and browser behavior remain unverified. No contract change was needed. [runner.test.mjs](/home/canarit/projects/axylo/rehearsal/test/runner.test.mjs)

`npx --no-install vitest run --root rehearsal --exclude '**/*.browser.test.mjs'`

```text
 Test Files  2 passed (2)
      Tests  45 passed (45)
   Start at  08:57:22
   Duration  6.18s (tests 93%, import 4%, transform 3%)
```

`npm run typecheck` exited 0. Its last output was:

```text
> typecheck
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
```