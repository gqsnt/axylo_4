<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ede5-a918-7491-8275-e45efe686703). -->

Compact line, area, and bar charts now ignore `reference` in automatic domains, summaries, descriptions, and lookup text. The option raises one AX150 warning stating “Compact charts draw no references.” Updating to `compact: false` restores the saved reference and clears the warning. [Option resolution](/home/canarit/projects/axylo/packages/axylo/src/data/options.ts:215) · [View](/home/canarit/projects/axylo/packages/axylo/src/view/index.ts:320) · [Reader](/home/canarit/projects/axylo/packages/axylo/src/reader/index.ts:219)

- `legend`, `zoom`, `tooltip`, and `table` were already inert in compact mode and remain silent.
- Axis `label` supplies field and series names in the text alternative, as the existing C1 browser tests expect.
- `tickFormat` could run for hidden ticks and add a false “Values changed” note. Compact mode now skips these formatters and reports AX150 for the configured x and shared y tick formats.

Added domain, summary, and diagnostic tests for all three kinds, plus one line acceptance test covering the update in both directions. The new regressions failed before the fix. The four focused files passed all 100 tests afterward, and `npm run typecheck` passed. [Acceptance test](/home/canarit/projects/axylo/packages/axylo/test/acceptance/compact.test.ts:4) · [Evidence](/home/canarit/projects/axylo/packages/axylo/test/acceptance/EVIDENCE.json:5)

The requested run had two failures. The existing compact F7 property expects references to expand the domain, and the acceptance edit scope covered one added test. The streaming storage test retained 24,750,128 bytes against a 16,000,000-byte limit and reproduced on `HEAD`. [F7 property](/home/canarit/projects/axylo/packages/axylo/test/acceptance/f-domains.test.ts:64) · [Storage test](/home/canarit/projects/axylo/packages/axylo/test/data/streaming-storage.test.ts:112)

```text
 Test Files  2 failed | 24 passed (26)
      Tests  2 failed | 766 passed (768)
   Start at  10:06:34
   Duration  16.55s (tests 89%, transform 6%, import 4%)
```

I interpreted “object form” as object field encodings with `compact: true`, which the tests cover. A literal `compact: {...}` would require defining its shape, widening `CompactOption.compact`, and updating core’s `isCompact` check. No contract edits or commits were made. Browser tests were outside this run, and all test processes exited.