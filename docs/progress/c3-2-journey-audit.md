# Cycle C3.2 — Sharded Product Experience Audit Summary

**Commit Audited:** `6ad9937` / `380bbcd` (`C3.1` signed off `Verdict: Merge`)
**Audit Shards:**
- **Shard 2 (Responsive, Narrow Viewport & Touch — Anthropic `opus-5.5-high`):** 7 findings (`F-RESP-1`..`F-RESP-7`); confirmed all single-tap I4 paths exist without dragging, mapped exact floating/strip/`none`/too-small thresholds (`240×140`, `80`, `120×80`), flagged `TAP_TIME = 500ms` (`F-RESP-4`), touch pin re-tap toggle (`F-RESP-3`), `legend: 'right'` narrow fallback (`F-RESP-1`, owner decision), `'none'` mode tap readout (`F-RESP-2`), and compact `24×16` test gap (`F-RESP-6`).
- **Shard 3 (Keyboard, Focus, ARIA & Manual AT — OpenAI `sol-6.2-medium`):** 6 ranked findings (`F-A11Y-1`..`F-A11Y-6`) plus full manual AT closure protocol for NVDA+Firefox, JAWS+Chrome, VoiceOver+Safari (macOS/iOS), TalkBack+Chrome.
- **Shard 1 (Geometry & Histogram Gaps):** `histogram-resize-test` and `histogram-theme-test` identified as directly closable automated Chrome gaps in `packages/axylo/test/browser/chart/histogram.browser.test.ts` + `acceptance/journeys.json`.

## Prioritized C3.3 Execution List
1. **`F-A11Y-1` (A1):** Treat blank/whitespace `title` and empty `labelledBy` heading text as absent so figures are never left unnamed (`AX140` + fallback).
2. **`F-A11Y-2` (A2/A3):** Transfer keyboard focus + slice identity from donut slice-list to the plot slider (or open table) when an all-zero donut becomes ready.
3. **`F-A11Y-3` (F12/C5/A4):** Omit `"See table"` referral when empty histogram has no openable table, and include omission sentence in compact error image description when omission marker is shown.
4. **`F-A11Y-4` (A4/A7):** Preserve unchanged `<tr>` DOM nodes during passive table refresh (append outside displayed page) so AT reading cursors are not disrupted.
5. **`F-RESP-3` & `F-RESP-4` (I4):** Toggle/dismiss touch pin on second tap of the same pinned datum, and raise `TAP_TIME` from `500 ms` to `1,000 ms` for motor accessibility.
6. **Histogram Browser Gap Closure:** Add resize (`640px → 220px → 640px` + `100px` too-small) and theme (`light`/`dark`/`forced-colors` + custom color override + `axe`) tests to `histogram.browser.test.ts`, closing `histogram-resize-test` and `histogram-theme-test` in `acceptance/journeys.json`.
