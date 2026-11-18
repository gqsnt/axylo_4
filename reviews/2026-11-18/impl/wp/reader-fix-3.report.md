<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1ed07-b9cc-7883-b5e1-b2771b848005). -->

All six A10 authored-warning cases and all three C5 compact chart cases passed. The C5 production case and all reader, messages, and diagnostics unit tests also passed.

The four default templates now use `{seeTable}`. The reader fills it from `seeTable` when a table exists and trims trailing whitespace when the substitution is empty. Overrides without the placeholder keep the author’s wording and spacing. [Message defaults](/home/canarit/projects/axylo/packages/axylo/src/messages/index.ts:16) · [Reader](/home/canarit/projects/axylo/packages/axylo/src/reader/index.ts:49)

**Unit tests changed**

- Replaced “defines table guidance separately from the note and summary templates” with “includes the table guidance placeholder in all four default templates.” [Messages tests](/home/canarit/projects/axylo/packages/axylo/test/messages/index.test.ts:29)
- Replaced “adds the authored table suffix only when a table exists and preserves authored disclosure text” with “fills explicit table guidance in authored disclosures and preserves overrides that omit it.” [Reader tests](/home/canarit/projects/axylo/packages/axylo/test/reader/index.test.ts:68)
- Corrected the append expectations in “keeps disclosures before the author description and joins both visible notes” and “identifies an undrawable duplicate-x series even when absent from the visibility mask.” Added “skips a disclosure that becomes empty and preserves whitespace in a template without the placeholder.” [Reader tests](/home/canarit/projects/axylo/packages/axylo/test/reader/index.test.ts:46)

**Remaining acceptance failures**

| Cases | Observed failure |
|---|---|
| A4 line, area, bar — lazy table uses the heading and units | The x header is `Distance` instead of `Distance (m)`. The controller does not pass the x unit to the reader. |
| F2 scatter — gaps are unplotted, zero is readable and the table says No data | The table omits both missing observations. |
| F2 scatter — missing zero draws two imputed zero points and exposes all four observations | The scene contains two points instead of four. |
| F4 scatter — calendar days, months and years keep their input precision across time zones | The summary renders `Feb 1, 2024` for a month input expected to read `Feb 2024`. |
| F7 line, area, bar, scatter — automatic value domain ends at the first drawn tick that reaches the reference extreme | For reference `61`, the domain ends at `80` while the first qualifying drawn tick is `70`. |
| L3 line, area, bar, scatter, donut — a zero-sized plot draws when the host acquires room | The host records an empty `0 × 0` draw before the container acquires room. |

The requested combined run exited 1. Verification was Node-only, and the changes are uncommitted.

```text
 Test Files  4 failed | 15 passed (19)
      Tests  15 failed | 528 passed (543)
   Start at  06:02:22
   Duration  12.89s (tests 85%, transform 9%, import 6%)
```

**Suggested `public.ts` comment**

```ts
/** Replaces `{seeTable}` in `valuesNotShown`, `valuesChanged`, `labelsHidden`, and `seriesNotDrawn` when the reader model has a table, with an empty substitution and trailing sentence whitespace trimmed when the table is absent. */
```