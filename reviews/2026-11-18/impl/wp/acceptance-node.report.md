<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ecf1-cc72-7090-a96c-2549eeac7a5b). -->

Added **494 Node acceptance tests** across 16 files. They exercise all 29 diagnostic codes and provide model evidence for 224 applicable matrix cells. All edits are under `packages/axylo/test/acceptance/`. No contract changes are needed.

| Line | Area | Bar | Scatter | Donut | Compact |
|---:|---:|---:|---:|---:|---:|
| 96 | 87 | 87 | 77 | 57 | 90 |

[Evidence index](/home/canarit/projects/axylo/packages/axylo/test/acceptance/EVIDENCE.json) · [Full report with counts, all 18 failures, likely causes, and spec readings](/home/canarit/projects/axylo/packages/axylo/test/acceptance/REPORT.md)

The failures cover scatter missing values, date precision and scale domains, automatic tick endpoints, missing x-axis units in aligned tables, AX143 guidance, and compact disclosure text. The assertions remain active.

The acceptance files passed strict TypeScript checking. Workspace typechecking stopped at TS2367 in the [browser naming test](/home/canarit/projects/axylo/packages/axylo/test/browser/acceptance/a1-names.browser.test.ts:45). Browser rendering, accessibility-tree inspection, assistive-technology rehearsals, and performance budgets remain pending.

```text
 Test Files  7 failed | 9 passed (16)
      Tests  18 failed | 476 passed (494)
   Start at  05:52:29
   Duration  13.01s (tests 89%, transform 5%, import 5%)
```