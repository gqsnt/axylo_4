# Review ledger, 2026-11-18

Three independent reviews of the four design documents (revision 1) and the Phase 1 evidence, what each finding led to, and what was left undone.

**Status of revision 2: not reviewed.** The reviewers saw revision 1. Everything changed in response, including the new probes and the rewritten spec and plans, was written by the same author and has not been checked by anyone else. No reviewer approved anything; a review that raised no objection to a passage is not approval of it.

## Reviewers

| Reviewer | Requested | Observed | Source of "observed" | Sandbox | Assigned deep dive | Findings | Report |
|---|---|---|---|---|---|---|---|
| S | Codex `gpt-6.2-sol`, effort max | model `gpt-6.2-sol`, effort `max` | Codex session rollout metadata (`turn_context`), thread `01a1ebce-bc00-7710-aec9-d26ceee3267f`, CLI 0.169.0 | read-only | Product spec and architecture | 6 blocking, 23 major, 2 minor | [codex-sol.md](codex-sol.md) |
| A | Codex `gpt-6.2-astra`, effort xhigh | model `gpt-6.2-astra`, effort `xhigh` | Codex session rollout metadata, thread `01a1ebce-bc00-7f21-a81e-3ad6a761b405`, CLI 0.169.0 | read-only | Evidence, harness fairness, performance plan | 4 blocking, 18 major, 1 minor | [codex-astra.md](codex-astra.md) |
| O | Claude Opus 5.5, effort xhigh | model `claude-opus-5-5`, effort `xhigh` | Subagent transcript metadata | instructed read-only | Reader experience, accessibility, developer experience | 2 blocking, 16 major, 14 minor | [opus.md](opus.md) |

Model ids were taken from the Codex model catalog on this machine, not guessed. S and A are a different provider from the author. O is the same provider as the author (Claude) and is a second opinion, not a cross-provider review.

All three received the same brief ([brief.md](brief.md)) plus one deep-dive paragraph each (`lens-*.md`), worked in parallel, and did not see each other's reports. None of them reran the browser harness. O was told not to read `node_modules` and so could not check package contents. Raw Codex event logs are in `raw/`. The reviewed revision of the landscape report is kept in `reviewed-revision/`; the other three documents were overwritten in place and this repository has no version history, so their revision 1 text survives only as quoted in the reports.

## How findings were handled

Each claim about the evidence was checked against the files before anything changed. Where a reviewer said a probe was wrong or unfair, the probe was fixed and rerun instead of the sentence being softened. Verdicts: **Accepted** (changed as proposed or equivalently), **Partly** (changed, with a stated remainder), **Rejected** (with the reason), **Open** (the owner's decision).

### Evidence and landscape report

| # | Finding | Raised by | Verdict | What was checked | What changed |
|---|---|---|---|---|---|
| 1 | The ten are a judgment panel presented as a ranking; "amCharts lower on every signal", Chart.js' CDN lead and the Recharts tooling attribution are wrong | S-M16, A-M7, O | Accepted | Recomputed from `adoption.json` and `httparchive.json`: amCharts 4,475 origins against uPlot 29; Chart.js 5.5× Chartist on jsDelivr | New `adoption/ranks.mjs`; section 1.3 rewritten as a chosen sample with each channel's own top ten; CanvasJS and Google Charts rows added; causal wording removed |
| 2 | The D3 large-data rows are invalid: y axis pinned at zero, data mostly negative | A-B2 | Accepted | Confirmed in `libs/d3.js` and the fixture | Adapter fixed (data extent, x axis redrawn while streaming); rerun. Remainder: other adapters were not checked for domain and window; the performance plan now requires it |
| 3 | The timing columns measure different amounts of work; uPlot's "0.1 ms per append" is only the synchronous part | A-B3, S-M14, S-B6 | Accepted | uPlot defers its commit; the harness timed only the call | Probe now records browser-reported main-thread task time for draw and per update, with a no-chart floor row. All 15 configurations rerun. uPlot: about 1 ms per update. Remainder: the producer is still frame-paced, not on an independent clock |
| 4 | Default against tuned changes the reader's task; causes are not isolated; node-per-point does not show SVG is slow | A-M6, S-M14, O-M15 | Accepted | Compared the default and tuned adapters line by line | D8–D10 rewritten; caveats listed under the table. Remainder: no single-option runs; Nivo's canvas component untested |
| 5 | The time-zone probe fed instants and concluded about dates; the quoted Chart.js tooltip had no artifact | S-M17, A-M8, O-B1, O-m4 | Accepted | New `dates` task in three zones | With date strings, 7 of 10 keep the day; with instants, 6 shift, correctly. Chart.js tooltip read through its API and saved. R3 and the summary rewritten; the finding is narrower |
| 6 | Authored choices presented as library defaults (uPlot bars, D3 dirty); "360 markers"; "never reported" too strong; uPlot also plots the string | S-M18, A-M12, O-m3 | Accepted | Screenshots and adapters | "Authored" label throughout; four one-bad-value fixtures added and run; R5 rewritten (nine plot the string); 353 values |
| 7 | The keyboard and accessibility scoreboard counts tooltips as announcements and misnames roles | S-M19, A-M9, O-M1, O-m6 | Accepted | `results.json` keyboard records | Rows split into "reaches a live region" and "shown visually"; `application` role recorded; Highcharts and MUI X corrected to "tooltip only"; Plotly's stops described exactly. Remainder: arrows are still tried only from the first stop |
| 8 | Highcharts was given its accessibility module and no other library its equivalent; the ECharts import claim was wrong for the full build | O-M2, A-M9 | Accepted | Ran Highcharts without the module, ECharts with `aria.enabled`, MUI X with `title` | New section 4.3. MUI X's title label lands on a `role="none"` element; ECharts' description reads raw timestamps |
| 9 | Motion, resize and dark probes can misclassify | A-M11, S-M19, O-M6, O-m4 | Partly | Resize measured the first graphic (a 14 px legend icon) | Resize now measures the widest graphic, rerun; a light-only-page probe added (Highcharts follows the device, not the page); motion claims narrowed to the bar entry transition. Not done: frame-sequence capture, motion on update, viewport-level screenshots |
| 10 | The palette scorer dropped repeated colors; Plotly's closest pair was misnamed; thresholds rest on a thin search | S-M20, A-M10, O-M16 | Accepted | Rescored with repeats | ApexCharts and Recharts now score zero; pair corrected to orange and green; the 0.10 threshold is marked provisional. Not done: scoring at line width, hue coverage, one palette for both schemes |
| 11 | Bundle sizes and line counts are not like for like | S-M21, A-M22 | Partly | `sizes.mjs` | Relabelled KiB and caveated. Not re-measured with modular imports or separate CSS |
| 12 | The Recharts donut "no labels" was a timing artifact | O-m5 | Accepted | Labels present at 4 s | Corrected |
| 13 | Provenance: results merged across runs, no run ids, `npm install` in the instructions | S-m2, A-m23 | Partly | – | A `_runs` log records every invocation; timeouts are recorded as "no result within"; the deleted spot-check script is restored and saves `spot-checks.json`. Not done: run ids and hashes per result. The first-pass results for nine libraries predate the run log |
| 14 | No customization comparison; no matched developer-task study | S, A, O | Not done | – | Stated plainly in sections 2 and 5. A study with outside developers is rejected (below) |
| 15 | AG Charts and Observable Plot were not probed, yet the report said "nobody" | O | Partly | – | Claims scoped to "among these ten"; the closing paragraph names both as the next to probe. Not probed |
| 16 | ApexCharts' license wording was too blunt | A-m23 | Partly | Not re-read | Softened; marked as not verified |

### Product specification

| # | Finding | Raised by | Verdict | What changed |
|---|---|---|---|---|
| 17 | A simplified drawing cannot supply the exact values promised to readers | S-B1, A-B4 | Accepted | The normalized data is the authority for values, table, keyboard and summary (principle, F5, A4; plan 2.1) |
| 18 | Four vertices per pixel cannot preserve every gap and isolated point; two different triggers | S-B2, A-B4, O-m2 | Accepted | F5 restated per pixel column and per run of valid samples, with what counts as a visible gap; one trigger; stacked areas on cumulative sums |
| 19 | F4 tests the wrong temporal type and contradicts its own default | S-M1, A-M8, O-B1 | Accepted | Three temporal types, four fixture variants, a hint when instants look like dates, the zone always visible; the default is decided |
| 20 | Zero, percent, author bounds and stacks had incompatible rules | S-M2, A-M19, O-M13, O-m13 | Accepted | F7 precedence; percent only when declared and only above half scale; `zero: false` removed |
| 21 | Severity allowed silent production failures | S-M3, O-M7, A-M18 | Accepted | Diagnostic registry (3.5); reader-facing note (F12); errors and warnings print in every build; `strict` throws on warnings too |
| 22 | A misspelled field, absent rows and unsorted rows drew wrong charts silently | O-M3, O-M4 | Accepted | AX101, AX102, AX105, F11, `missing`, a distinct mark for a missing bar |
| 23 | Numeric strings were dropped although back ends send counts as strings | O-M8 | Accepted, modified | A whole column of plain decimal strings is parsed with a hint; a mixed column is not; `parse: 'number'` makes it explicit |
| 24 | One formatter cannot serve compact ticks and exact readouts; "own precision" undefined | S-M4, O-m7 | Accepted | F6 |
| 25 | "All text fits" had no feasible failure state; canvas measurement disagrees with DOM text | S-M5, A-M21, O-M14, O-M10, O-m9 | Accepted | L1 restated, rotation before truncation, labels kept distinct, visible note; L3 clamps; L8 fallback; tests in real browsers with spacing overrides and late fonts |
| 26 | Color rules contradicted each other and ignored the real background; color alone on dense lines | S-M6, A-M10, O-B2, O | Accepted | F9 fixed; a non-color cue on the marks in every mode; separators between filled marks; runtime contrast check (AX141); `colors` by series name replaces `palette` |
| 27 | Donut, scatter and references lacked their own rules | S-M7, A-M20, O-m7 | Accepted | Type matrix (3.6); F8 cases |
| 28 | The tooltip criterion did not cover sparse series or small viewports | S-M8, O-m7 | Accepted | I1 |
| 29 | The keyboard budget contradicted the markup; no single-pointer zoom; no pause; English-only strings; unannounced states; unnamed minimal chart; table problems | S-B5, S-M9, A-M20, O-B2, O-M5, O-M9, O-M12, O-m10 | Accepted | A1, A2, A4, A7, A10, I3, I4, I6, L7; the pattern spike moves to M1 with a third candidate |
| 30 | Passing every criterion would not have met WCAG 2.2 AA | O-B2, S-M9 | Accepted | The criteria above; A9 lists each success criterion with its test; scope stated as component-level evidence |
| 31 | Budgets mixed units, had no basis, and conflicted across documents | S-B6, A-B1, A-M13, S-M13, O-m14 | Accepted | Section 5: provisional, each with workload, metric and statistic; the ratio to uPlot is no longer a gate; P7 redefined; the headline no longer promises a million points |
| 32 | Dark mode: follow the page, repaint on theme change | O-M6 | Accepted | L4, backed by the new probe |
| 33 | Several thresholds had no stated basis | O-m9 | Partly | Marked provisional (L5, A5) or replaced (A7, A4) |
| 34 | Agent-facing gaps: unknown options, `validate()`, text-only insertion, selector not found, `'use client'` | O-m11 | Accepted | DX3, DX8, DX12; the API sketch. Nested field paths deferred |
| 35 | No supported-browser or host contract; no upgrade test | S | Accepted | Section 2.3; DX9 |

### TypeScript plan

| # | Finding | Raised by | Verdict | What changed |
|---|---|---|---|---|
| 36 | The public types did not compile and left the data model ambiguous | S-B3, A-M18 | Accepted | `docs/api/axylo.d.ts` and `examples.ts`, type-checked with TypeScript 7.0.2; seven mistakes verified to fail |
| 37 | Updates, streaming and zoom had no shared contract | S-B4, O-M11 | Accepted | Section 1.5 |
| 38 | React behavior undefined on ordinary prop changes | S-M10, O-M11 | Accepted | Section 1.7; prototype in M3 |
| 39 | Caching on identity is neither correct nor fast | S-M11, A | Accepted | Invalidation table (2.2) |
| 40 | Milestones scheduled prerequisites after the outcomes needing them; the release rule named a probe that cannot run it | S-M12, S-B6, A-B1, O-M9 | Accepted | Benchmark harness and compiled declarations in M0; vertical slice, both spikes and teardown in M1; type-specific tests move to M5; the acceptance matrix is the gate |
| 41 | Wrong cross-references | S-m1, A-m23, O-m1 | Accepted | Fixed; the acceptance-matrix checker is to fail CI on stale ids |
| 42 | CSS delivery under a strict policy unspecified | O, S-M21 | Partly | Stated as settled by the M7 test with real headers; the mechanism is not chosen |

### Performance plan

| # | Finding | Raised by | Verdict | What changed |
|---|---|---|---|---|
| 43 | The replacement metrics could not establish the budgets (stable canvas hash, Event Timing for pointer moves, long-frame entries for one-frame budgets) | S-M15, A-M5 | Accepted | Section 3.1 rewritten around a start, a verifiable end and one statistic per workload |
| 44 | The statistics could reward noise and hide regressions | S-M22, A-M14 | Accepted | Balanced randomized blocks; run-level analysis; a noise distribution; three outcomes; screening separated from confirmation; drift against the last release |
| 45 | Memory numbers from different instruments were treated as one | S-M13, A-M15 | Accepted | Four separate numbers, baselines, leak slope |
| 46 | Workloads under-represent dashboards; the browser matrix overclaimed | A-M16, S-M22, O | Accepted | Mixed page, busy page, keyboard and table workloads, gappy and irregular data; runnable combinations enumerated; WebKit not called Safari |
| 47 | Shipping rules could pass an imperceptible gain | A-M17 | Accepted | Lower bound of the interval must clear a declared minimum; absolute savings |
| 48 | The Rust gate misread a failed experiment and left loading undefined | S-M23, A-M17 | Accepted | The arithmetic is a precondition; loading and failure cases; fallback judged among eligible charts; nothing before 1.0 |

## Decisions the reviewers asked to reopen

| Decision | S | A | O | Outcome |
|---|---|---|---|---|
| Canvas marks with DOM text | Reopen | Reopen | Reopen | Reopened. Decided in M1 by building both mark renderers on one scene and measuring |
| Five chart types in 1.0 | Start with line and bar | Stage types by evidence | Fine, if a compact variant exists | Scatter made conditional. The compact variant and the final scope are the owner's decision |
| Label fitting as an absolute invariant | Overturn | Overturn | Reorder remedies | Overturned as stated; replaced by "nothing overlaps, nothing disappears untold" |
| One data shape; one update method | Overturn the wording | Overturn the wording | Keep | Reworded: one logical table in three forms; three methods under one contract |
| Budgets relative to uPlot | Overturn the ratio gate | Overturn as universal | Keep | Ratio removed as a gate; uPlot is still measured and published alongside |
| Identity memoization | Overturn | Reopen | – | Replaced by explicit invalidation |
| Instant default zone | Reopen | Reopen | Reopen | Decided: the viewer's zone, with the zone always visible and a hint when instants look like dates |
| Numeric strings not plotted | – | – | Overturn for whole columns | Changed |
| Production diagnostics silent | Reopen delivery | – | Overturn | Changed |
| React adapter in 1.0 | Reopen the coupling | Keep conditional | Keep | Kept; prototyped early |
| Zero runtime dependencies | Keep provisionally | Reopen | – | Kept provisionally |
| Diagnostics, accessibility in core, no entry animation, MIT, CSS theming | Keep | Keep | Keep | Kept |

## Rejected

| Proposal | Raised by | Why |
|---|---|---|
| Test with screen-reader users before claiming usability; a study with outside developers; design partners | S-M9, A, O (as a stated limit) | A one-person project with no participants. The limit is stated in the spec (3.7) and will be stated in the conformance table. Developer rehearsal and agent rehearsal are used and labelled as rehearsal |
| Collect chart sizes and device profiles from beta deployments | A | No telemetry in a chart library; sizes come from the spec and from issue reports |
| Switch to horizontal bars automatically | O-M14 | It changes what the chart says; Axylo suggests it and tells the reader what is hidden |
| Replace the ten-line first-chart criterion | A-M22 | Kept as a floor; DX12 adds a test of getting it right |
| Lollipop marks when a bar axis excludes zero | O-m13 | The option was removed instead |
| Nested field paths in 1.0 | O-m11 | Deferred; flatten rows first |

## Not verified by the author

- Reviewers' statements marked "from memory" were applied where they matched the author's own understanding and are still unverified here: what database drivers return for dates and counts; several WCAG 2.2 details (2.2.2, 2.5.1, 2.5.7, 3.1.2, 4.1.3); how screen readers treat a focusable `div`; `measureText` ignoring CSS spacing; which stylesheet mechanisms a strict Content Security Policy allows.
- License terms and prices were read once and not re-read.
- No screen reader, Firefox or Safari has been run by anyone at any point.

## Suggested next review

Revision 2 changed more than it kept. A second pass, by reviewers that did not write it, should check at least: that each "Accepted" row above was actually carried out as described; the new probes (`dates`, one-bad-value, light-only, main-thread time) for the same kinds of adapter unfairness the first pass found; and the API sketch against the commit contract.

## Owner decisions after the review, 2026-11-18

| Question | Decision | Carried into |
|---|---|---|
| Is scatter in 1.0? | Yes, unconditionally | Spec 2.1; plan M5 |
| A compact variant for KPI tiles and sparklines in 1.0? | Yes | Spec 2.1, 3.7 (C1–C5), P8; API sketch (`compact`); plan M5 |
| Canvas or SVG paths for marks? | Stays open; decided by the M1 comparison | Spec 8; plan 2.3 and M1 |

Model assignment set by the owner for the implementation: code by Claude Opus 5.5 (effort high) and Codex `gpt-6.2-sol` (effort xhigh); design, review and other reasoning-heavy work by Claude Fable 5.2 (medium), Claude Opus 5.5 (xhigh), Codex `gpt-6.2-astra` (xhigh) and Codex `gpt-6.2-sol` (max). Requested and observed model and effort are recorded per work package in `STATUS.md`.
