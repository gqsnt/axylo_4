# Changelog

<!-- Draft by Codex gpt-6.2-astra (observed, effort xhigh), checked by the coordinator against public.ts, the spec's registry (29 codes), bench/size-latest.json and the stability page. The version number and the release date are the owner's to set. -->

## [Unreleased]

Axylo’s first release is a framework-neutral, MIT-licensed TypeScript library for everyday charts in web apps and dashboards. It uses the underlying data for exact values, keyboard navigation and tables, and tells readers when values were omitted or changed. [Product specification](docs/02-product-spec.md)

### What’s included

- **Charts.** Line, area, bar, scatter and donut. Areas can be stacked. Bars can be grouped or stacked, horizontal or vertical. Line, area and bar also have a compact variant for sparklines and tiles, with just the marks, an accessible name and a text summary. [Public API](packages/axylo/src/public.ts)
- **Data and time.** Pass long rows (one row per x and series), wide rows (one field per series), or typed columns. Calendar dates stay the same in every time zone. Instants display in the chosen zone, defaulting to the viewer’s. Wall-clock times without an offset display as written. [Data guide](apps/docs/pages/data.md)
- **Updates and streaming.** `update()` changes data or options. `append()` adds rows and can limit how many distinct x values are kept. On a full chart, Pause freezes the view while rows continue to arrive. Streaming compact tiles need a page-level pause control. Full line, area, bar and scatter charts support zoom and pan along date, time and numeric x axes. [Updating, streaming and zoom](apps/docs/pages/updating.md)
- **Reading values.** Full charts provide an accessible name, a generated summary, arrow-key navigation and a paginated HTML table. Pointing shows a tooltip beside the mark. Smaller plots use a two-line readout below the plot. When even that strip cannot fit, pointing highlights the datum and its value remains available by keyboard and in the table. [Accessibility guide](apps/docs/pages/accessibility.md)
- **Diagnostics.** There are 29 stable codes covering errors, warnings and hints. Errors and warnings print once per code per page in every build. Hints print only in development. Data diagnostics identify the field and affected rows where applicable. `validate()` runs the input checks in Node. [Diagnostics](apps/docs/pages/diagnostics.md)
- **Theming and rendering.** Charts inherit the page’s font, text colour and light or dark scheme. CSS custom properties control styling, and `colors` can pin a colour to a series name. SVG is the sole mark renderer. The internal Canvas renderer and its switch were removed for 1.0. [Theming](apps/docs/pages/theming.md) · [Renderer decision](docs/decisions/0002-mark-renderer.md)
- **Package and size.** The unpublished `axylo` npm package includes ES modules, TypeScript declarations, a script-tag build and CSS, with no runtime dependencies. The packed production bundles, including styles, totalled **113.08 KiB gzipped** for all exports and **94.73 KiB** for line only. The targets are 116 KiB and 98 KiB, respectively. Removing Canvas marks, the switch and their styles saved 2,462 bytes and 1,628 bytes in matched builds. [Size measurements](bench/size-latest.json) · [Renderer decision](docs/decisions/0002-mark-renderer.md)

### Evidence

The release check is on hold under the owner’s performance stop rule. On the sealed SVG-only candidate, first render took **27.40 ms** against 10 ms. The create–destroy benchmark measured median heap growth of **1.169% and 1.168%** against the plan’s 1% limit. The other measured budgets were met, including compact charts at **70.74 ms and 68.38 ms** against 80 ms. [Performance results](bench/results/budgets-2026-11-21.md) · [First-render profiles](bench/results/p1-investigation-2026-11-22.md)

The acceptance matrix links each chart type to its evidence and gaps. The checked-in report gives static coverage. The local run records and the generated conformance page show verification for the revision actually run. [Matrix](acceptance/matrix.json) · [Acceptance report](acceptance/report.md) · [Verification status](STATUS.md)

Acceptance tests ran on Linux in Chrome and Playwright’s builds of Firefox and WebKit. Packed-package browser tests ran in Chrome. Safari itself, Edge, phones, Windows and macOS remain untested. The owner chose to omit screen-reader rehearsal. Automated checks cover structure, focus and text. Whole-page WCAG conformance and usability with a screen reader remain unverified. [Tested environments](apps/docs/pages/stability.md#supported-environments) · [Conformance](apps/docs/pages/conformance.md)

On candidate `1e93128`, Codex CLI and Claude Code each passed three uncoached attempts on four fixed line and bar tasks. After transcript re-audit, all **24 of 24** passed the reader checks in Chrome 158 on both inputs in the Los Angeles and Tokyo time zones. Docs-only access was requested and audited, without filesystem enforcement. The result covers those tasks and gives no estimate of general success or human usability. [Agent rehearsal](apps/docs/pages/stability.md#agent-rehearsal)

### Known limits

On narrow scatter charts, long x-axis end labels can wrap or rotate and the range can widen. Non-neighbouring series in compact bars can share a fill pattern. CSS scoped to the plot’s column can cause a small chart to omit a readout that would fit. [Full list of known limits](apps/docs/pages/stability.md#known-limits)

### Not in this release

Framework adapters for React, Vue and Svelte are planned for later. Category-axis zoom and two-axis scatter zoom are outside this release. Streaming is built in today. A separate opt-in streaming import is planned to reduce bundle size. [Getting started](apps/docs/pages/getting-started.md#using-axylo-in-a-framework) · [Product specification](docs/02-product-spec.md)

Other deferred work includes additional chart types, non-linear scales, a second y axis, annotations beyond reference lines and bands, linked charts, export and print styling, and server-side SVG. The plan also defers right-to-left layout mirroring, quarter and ISO-week periods, nested field paths, built-in translations, a custom element, plugin and custom-mark APIs, workers, WebGL, WebGPU and Rust. [Deferred scope](docs/03-plan-typescript-release.md#6-what-waits-until-after-10)
