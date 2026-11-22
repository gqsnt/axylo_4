# Daily revenue grammar review

Separate read-only same-provider Codex review. Requested model `gpt-6.1-sol`, effort `xhigh`. Observed model `gpt-6.1-sol`, effort `xhigh` in the session rollout (01a2019e-1846-7250-959b-88cbaa8ebcfa).

No actionable findings in the current `rehearsal/` diff.

- Registration is limited to daily revenue in [files.mjs:23](/home/canarit/projects/axylo/rehearsal/files.mjs:23). Both grammar files receive SHA-256 hashes in [protocol.mjs:61](/home/canarit/projects/axylo/rehearsal/protocol.mjs:61), which flow into saved records.
- The grammar input joins the existing grading criteria in [grade.mjs:221](/home/canarit/projects/axylo/rehearsal/grade.mjs:221) and runs in Los Angeles and Tokyo through [grade.mjs:249](/home/canarit/projects/axylo/rehearsal/grade.mjs:249).
- Expectations match the README: `+2 → 2`; `.5` and `0x10` produce gaps and two reportable omissions. Read-only assertions confirmed the table comparator independently rejects each incorrect interpretation.
- Primary and alternate conversion expectations remain intact. The four tasks, model IDs, and two-passes-in-three rule across eight cells are unchanged.

Final verification output:

```text
PASS: two-of-three rule across all eight cells
Read-only assertions: all passed; no browser or file-writing harness invoked.
```

Browser tests were not run because they create workspaces and grading files. No files changed; no contract changes needed.
