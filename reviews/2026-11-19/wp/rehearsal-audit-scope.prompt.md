# Rehearsal audit: a path inside the attempt's own sandbox folder is not a forbidden access

You built `rehearsal/` (latest commit after a1b1bec). Same rules: you own `rehearsal/` only; no network; do not run real agents; you cannot commit.

A live Claude Code trial (uncounted) was voided by the audit for this path: `/tmp/axylo-rehearsal-eyL05q/node_modules/axylo/README.md`. The attempt's run directory was `/tmp/axylo-rehearsal-eyL05q/`, its workspace `/tmp/axylo-rehearsal-eyL05q/workspace/`, and the package is staged at `workspace/node_modules/axylo`. The agent asked for a path one level above the workspace, inside the attempt's own run directory, which holds only that attempt's fresh home, temp space and workspace (see `workspace.mjs`). Nothing there is forbidden. The record is `rehearsal/records/trial-2026-11-19/2026-11-19-claude-daily-visits-2-*/` (read its `run.json` and `transcript.jsonl`).

Change the audit so that:
- a path inside the attempt's own run directory (its workspace, fresh home, fresh config directory, temp space) is allowed, whether it exists or not;
- the forbidden set stays: the Axylo repository (any path under the repository root, resolved through symlinks), the real home (except the linked login files the runner itself created, which the agent must not read either: reading the symlink target is forbidden), any other attempt's run directory, and anything else outside the run directory other than system tools, as now;
- reading the linked login (`.credentials.json` in the fresh config folder, `auth.json` in the fresh `CODEX_HOME`) is reported as its own finding ("read the linked login") and voids the attempt.

Tests: the recorded transcript above (copy the relevant lines into a fixture) is now "no findings"; a path into the repository, into the real home, into another `axylo-rehearsal-*` directory, and a read of the linked login each void the attempt. Then regrade the saved trial: say whether `grade.mjs` can be run on it as the README describes, and if so run it and report the result.

Run `npx --no-install vitest run --root rehearsal --exclude '**/*.browser.test.mjs'`. Report (final message): the change, the tests, the last lines of the run.
