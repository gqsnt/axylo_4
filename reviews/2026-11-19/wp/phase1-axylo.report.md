<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh (session rollout turn_context). workspace-write. Reviewed by the coordinator (Claude Opus 5.5 high, cross-provider): the adapter and the probe hooks read for fairness. Saved by the coordinator. -->

Axylo is wired into the Phase 1 harness alongside the original ten libraries. Vite and the size probe resolve `axylo` to the production ES module from `axylo-0.0.0.tgz`. The offline npm attempt returned `ENOTCACHED`, so `node packed-axylo.mjs` verifies the archive and unpacks it into `research/harness/vendor/axylo/`.

The tested archive was packed on 2026-11-18 at 21:10:31 UTC with integrity `sha512-LCn3nSF7J5rmBJmwBZbcAx6J2alUgEDGg6BQ44OmkziEpuzrFCX1qQ3CG9KMqgOAaPvKzh1LtfpRPM/FC2IfFQ==`. The refresh procedure is in the [research README](/home/canarit/projects/axylo/research/README.md).

**Files changed.** Added `packed-axylo.mjs` and `src/libs/axylo.js`. Updated the harness `.gitignore`, `package.json`, `vite.config.js`, `src/main.js`, `probe.mjs`, `montage.mjs`, `palette.mjs`, `spot-checks.mjs`, and `sizes.mjs`, plus `research/README.md` and `research/tables.mjs`. The existing public API covers all tasks.

### What each task needed beyond data

| Task | Configuration |
|---|---|
| `trend` | Title, explicit instant axis for epoch milliseconds, and a channel field in long rows so the shared y axis can be titled “Sessions”. |
| `dates` | Title and the same channel and y-axis bindings. Axylo infers calendar dates from the ISO strings. |
| `bars` | Title, category and value bindings, and the supplied “Satisfied (%)” axis title. Baseline and label fitting use defaults. |
| `parts` | Title, slice-label and value bindings, and the supplied “Share (%)” label. Legend and colors use defaults. |
| `dirty` | Title and category and value bindings. All four sentinels pass through unchanged. |
| `dirty-null` | Same bindings, with `null` passed through. |
| `dirty-nan` | Same bindings, with `NaN` passed through. |
| `dirty-string` | Same bindings, with `'40'` passed through as a string. |
| `dirty-undefined` | Same bindings, with `undefined` passed through. |
| `empty` | The trend configuration with zero rows and the built-in empty state. |
| `scale` | Title, instant axis and value binding over the existing fixture arrays. Dense-line simplification is automatic, and Axylo exposes no public rendering switch for a tuned run. |
| `stream` | The scale configuration plus `append(rows, { keep: 600 })`. |

I treated the percent labels as fixture text and kept default number formatting. The Axylo-specific probes read plot labels from HTML, capture keyboard point text from `aria-valuetext`, retain the tooltip’s time zone, open the table before inspecting it, and read the rendered donut slice fills in order. The reduced-motion source check scans the unpacked package.

### Verification

`npx vite build` produced the Axylo chunk. The final lines were:

```text
dist/assets/echarts-DehbJkAK.js                       1,116.53 kB │ gzip:   370.42 kB
dist/assets/plotly.min-V27pesPw.js                    4,651.94 kB │ gzip: 1,422.29 kB

✓ built in 3.25s
```

The size probe measured **105.9 KiB gzipped** for Axylo. All ten comparator rows matched a fresh run of the pre-change size script, although several values differ from the historical snapshot. Node checks verified fixture inputs for all 12 tasks, the expected packed-package diagnostics, and the 300 append calls with a 600-point window. `tables.mjs` printed the expected rows from a disposable copy with synthetic results. That copy was removed.

Chrome exited during startup with `setsockopt: Operation not permitted`. Browser measurements, screenshots, palette extraction, and the interactive spot checks are pending.

### Coordinator rerun

From the repository root, with the harness dependencies already installed:

```bash
cd research/harness
node packed-axylo.mjs
npx vite build
npx vite preview --port 4173 --strictPort
```

Leave preview running. In a second terminal, from the repository root:

```bash
cd research/harness
node probe.mjs
node probe.mjs dates sentinels lightonly
LIBS=highcharts-plain,echarts-aria node probe.mjs look a11y
LIBS=noop,chartjs-tuned,echarts-tuned,recharts-tuned,highcharts-tuned,plotly-tuned node probe.mjs perf
node montage.mjs trend bars parts dirty empty kbd dark resize lightonly
node palette.mjs
node spot-checks.mjs
node sizes.mjs
cd ../..
node research/tables.mjs
```