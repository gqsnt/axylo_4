<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Checked by the coordinator: docs build (checked), docs unit 244, docs browser 175, rehearsal 120. Saved by the coordinator. -->

1. **Number grammar.** [Your data](/home/canarit/projects/axylo/apps/docs/pages/data.md) and [Options](/home/canarit/projects/axylo/apps/docs/pages/options.md) now spell out which decimal strings Axylo accepts. The [runnable example](/home/canarit/projects/axylo/apps/docs/examples/mixed-numbers.html) shows the AX106 gap and reader note before normalization, then draws all three valid values while still reporting `"0x10"`.
2. **Searchable Options.** I verified that all 82 option entries and 61 message keys in [the built HTML](/home/canarit/projects/axylo/apps/docs/dist/options.html) each occupy one line with their description. The table markup and styles are unchanged apart from whitespace.
3. **Node validation.** [Diagnostics](/home/canarit/projects/axylo/apps/docs/pages/diagnostics.md) and Getting started show a runnable `node check.mjs` example beside TypeScript. The packed-package test confirmed that `validate()` returns hints in both builds.
4. **Rehearsal record.** [Stability](/home/canarit/projects/axylo/apps/docs/pages/stability.md) and [Conformance](/home/canarit/projects/axylo/apps/docs/pages/conformance.md) record the 24/24 result for `1e93128` and its limits, including the lack of filesystem-enforced docs-only access.
5. **Next rehearsal.** Added a [third revenue fixture](/home/canarit/projects/axylo/rehearsal/fixtures/daily-revenue.grammar.json) with a hand-derived expected table and an independent test. The current batch was not regraded. No public contract changes are needed.

### Verification

```text
Docs Vitest
 Test Files  5 passed (5)
      Tests  244 passed (244)

Unchecked docs build
  migrate-recharts    1000 words
  stability           1427 words

Rehearsal Vitest without Chrome
 Test Files  3 passed (3)
      Tests  88 passed (88)
```

The docs build initially hit `spawnSync npm EPERM`. It passed with file-backed subprocess output and a writable offline npm cache. The checked build, both packed-consumer type checks, and all five packed Node tests also passed.

### Coordinator

Register and hash the third input for the next batch in `rehearsal/files.mjs`, `rehearsal/grade.mjs`, and `rehearsal/protocol.mjs`. Run `npm run build`, `npm run test:browser`, and `npx --no-install vitest run --root rehearsal` on the Chrome-capable host. Browser rendering remains unverified here.

Sentence for `rehearsal/README.md`:

> For the next release, grade `daily-revenue.grammar.json` in both time zones and check that `"+2"` reads as `2` and that `".5"` and `"0x10"` each leave a gap and count toward the reader’s omission note.