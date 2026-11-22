# November 22 comparison timing review

Separate read-only same-provider Codex review. Requested model `gpt-6.1-sol`, effort `xhigh`. Observed model `gpt-6.1-sol`, effort `xhigh` in rollout `01a201fc-5274-7170-902a-3ec6c85e5d73`.

No actionable findings in the reviewed timing changes.

Directly verified:

- Working-tree diffs for all five requested files.
- All 17 timing rows: 11 default, one floor and five tuned. Recomputed 49 medians from 147 task-time samples; checked completed/attempted counts, both `0/1` timeouts, all streaming values and callback counts, and all 166 load readings.
- Chrome version, run dates, configuration coverage and UTC-to-CET start times against `_runs`. All 51 scale and 17 stream log entries match `results.json`.
- Actual tarball SHA-512 against the README, packing manifest and `bench/size-latest.json`; vendor ESM/CSS/IIFE bytes against the archive; sealed artifact IIFE and SVG-only capability. Documented sizes and adapter line count match.
- Measurement windows in `research/harness/src/main.js:25`: creation through two animation frames plus 1.6 seconds; streaming after settling, with 300 frame-paced updates and the recorded task-time division. The producer uses animation frames rather than an independent clock.
- `docs/05-comparison.md:90` distinguishes this comparison from section 5’s absolute budgets. The comparison’s three scale runs and single streaming run differ from the budget methodology, including its independent clock and 25 ms threshold.

The latest README timestamp matches the original consumer-size packing record. The current manifest records a later repack with identical archive content.

Read-only checks ended with:

```text
PASS: 17 timing rows; 49 successful scale cells from 147 task-time samples; 2 one-attempt timeouts.
PASS: 17 stream time/count cells (300 updates each); 166 load readings; browser/date/run coverage and latest _env.
```

Streaming summaries were checked against stored fields and source formulas; underlying CDP deltas and individual update samples are not retained. Historical load causes and performance repeatability remain unverified.

No files or build outputs changed. No release check, benchmarks, builds or test suite ran. No contract change needed.
