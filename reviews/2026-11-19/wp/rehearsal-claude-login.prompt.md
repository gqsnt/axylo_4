# Rehearsal: let Claude Code attempts run on the machine's normal login, isolated as Codex attempts are

You built `rehearsal/` (latest commit 027281a). Same rules: you own `rehearsal/` only; no network; do not run real agents; you cannot commit.

## The problem

`rehearsal/agent.mjs` launches Claude Code with `--bare`. `claude --help` (2.1.327) says bare mode authenticates "strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read)". This machine has no `ANTHROPIC_API_KEY`; its Claude Code login is the OAuth login stored in `~/.claude/.credentials.json`. So every Claude attempt would fail to authenticate. The coordinator does not handle API keys.

## What to do

Mirror what you did for Codex (a fresh `CODEX_HOME` with only `auth.json` symlinked):
1. When `ANTHROPIC_API_KEY` is set in the runner's environment, keep the current behaviour (`--bare`, key passed through).
2. Otherwise: do not pass `--bare`; give the attempt a fresh `CLAUDE_CONFIG_DIR` (and fresh `HOME`, as now) containing only a **symlink** (never a copy, never reading it) named `.credentials.json` pointing at the real `~/.claude/.credentials.json` (path resolved from the real home, passed in like `codexLogin`). Keep `--restricted`, `--safe-mode`, `--strict-mcp-config`, `--no-session-persistence`, the tool restrictions and everything else you have. Check in `claude --help` which of those remain valid without `--bare`, and what loads by default without `--bare` (CLAUDE.md discovery, auto-memory, hooks, plugins, skills) from the fresh config directory and the disposable workspace: since both are empty, say so in the README and in `run.json` (`claudeMode: "bare" | "fresh-config"`), and add any flag the help offers to turn those off without `--bare`.
3. The audit and `observedMatches` must work in both modes (the observed model comes from the assistant messages; effort: say what the stream reports).
4. Delete the symlink with the attempt's directory afterwards; the real file must never be modified (test that the runner never opens it: it only creates a symlink).
5. Tests in `rehearsal/test/runner.test.mjs` for both modes with a stub CLI.

Run `npx --no-install vitest run --root rehearsal --exclude '**/*.browser.test.mjs'` and `npm run typecheck`. Report (final message): the change, the help-text lines you relied on, what loads in fresh-config mode, the last lines of the runs.
