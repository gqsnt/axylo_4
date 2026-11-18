# Stability and releases

After this page you know what Axylo promises between releases, which browsers and tools it supports, under what licence it ships, and what is not in 1.0.

## Status

This documentation describes Axylo 1.0, which has not been released. The library in this repository is a pre-release (package version 0.0.0) and has not been published to npm. Until 1.0 is tagged, anything may change.

## Versions

Axylo follows semantic versioning:

| Release | May contain |
|---|---|
| Patch (1.0.1) | Fixes that do not change documented behaviour, except to make it match the documentation. |
| Minor (1.1.0) | New options, chart features and diagnostics, and deprecations. Nothing documented stops working. |
| Major (2.0.0) | Removals and other breaking changes, at most one major version a year. |

**Deprecation.** A deprecated API keeps working for at least one minor release and at least six months, and its documentation says what to use instead. The documented examples of the previous release must still compile and run against each release candidate.

**What the promise covers.** The functions and types exported by `axylo` (declared in `packages/axylo/src/public.ts`), the diagnostic codes and their levels, the CSS custom properties documented on [Theming](theming.md), and the keys of `messages`. Match diagnostics on `code`; their messages are written for people.

**What it does not cover.** The chart's internal DOM structure and class names, the custom properties listed as internal, the roles the plot uses to talk to assistive technology (chosen without screen-reader rehearsal, and changeable in a minor release if rehearsal shows a better pattern), and the exact pixels of the drawing.

## Supported environments

These are the targets of 1.0 (spec section 2.3). What has been verified so far is listed after the table.

| Dimension | 1.0 target |
|---|---|
| Browsers | The current and previous major versions of Chrome, Edge and Firefox, and of Safari on macOS and iOS. |
| TypeScript | 5.4 and later. Plain JavaScript is fully supported; types are an aid, not a requirement. |
| Frameworks | None needed. No adapter ships in 1.0; the library is called from any framework's mount and unmount hooks. |
| Node | Importing `axylo` touches no DOM, and `validate()` runs there. Charts themselves need a browser. |
| Text direction | Left-to-right pages. Right-to-left text renders, but the layout is not mirrored. |
| Transformed ancestors | A chart inside a translated or scaled element (any positive scale, uniform or not) is exact. Inside a rotated, skewed or mirrored element it draws, but pointing and tooltip placement are wrong: not supported in 1.0. |
| Built-in text | English. Reader-facing messages are replaceable through `messages`; diagnostics keep their English wording. |

Tested so far, on Linux: the library's acceptance tests in Chrome and in Playwright's builds of Firefox and WebKit (Playwright's WebKit, not Safari), and the distribution tests in Chrome (they install the packed package, also under a Content Security Policy). Safari itself, Edge, Windows, macOS and phones have not been tested. No screen-reader rehearsal was done for 1.0. What the acceptance checker recorded for this revision is on the [conformance page](conformance.md); see also [Accessibility](accessibility.md#what-has-and-has-not-been-verified).

## Known limits

These are known in 1.0 and not fixed in it. Each says what you would see.

- **Closed shadow roots.** In a chart inside a closed shadow root, Escape can be taken by another chart on the page instead of this one. When the chart sits behind a slot inside a closed root, the wrapper around that slot can cut off its tooltip.
- **A dense ring of scatter points.** Thousands of points packed in a ring just outside the distance at which points count as being at the same place (half a pixel) can make hovering over that spot slow.
- **A formatter that fails only sometimes.** A formatter that throws for a value on one call and returns text on another can leave [AX160](diagnostics.md#ax160) reported beside a label that reads normally.
- **CSS aimed at the plot's own column.** The readout strip is measured outside the plot's column, so CSS that applies only inside that column (a container query on it, for example) is not taken into account. A small plot can then show no readout although the strip would fit.
- **A hold that starts early.** When only the tooltip's size or position changes while the pointer rests on a datum, the rest already spent counts towards the new one, so the hold can begin before a quarter of a second has passed.
- **One language for the focused point.** The plot's value text is marked with one language, even when the messages it is built from are not all in the same language (some translated, others built in).
- **Patterns in compact bar charts.** Neighbouring series always differ by fill pattern, but series further apart can share one, since there are four, and then differ by colour only.
- **Very small numbers.** On an axis of values around 1e-43 or smaller, ticks can be missing or not match their labels.
- **The end labels of a scatter chart's x axis.** That axis ends on a drawn tick at each end (spec F7) and reserves no extra room for the labels there, so long tick labels are wrapped or rotated to fit rather than left out. On a narrow plot the axis can take a coarser, wider range so that its ends are ticks.

## Size and memory

The size targets of 1.0, set by the owner after measuring the built library: 116 KiB gzipped for a page that uses everything, and 98 KiB for a page that uses only `line`, the stylesheet included. They are not a release gate yet. The last measurement (`npm run size`, which measures the packed files the way a bundler would):

[table: sizes](../../../bench/size-latest.json)

Memory: once a chart opened on typed columns has been appended to, Axylo keeps its own exact copy of x and y and one state byte per point, 17 bytes per point against the 16 of your two `Float64Array` columns. The memory budget of 1.0 is therefore 1.1 times the size of your two columns, for 1,000,000 points, with no upward trend over 1,000 cycles of create and destroy. This documentation shows no memory measurement. A chart that is never appended to reads typed columns in place where it can (see [what Axylo reads, keeps and copies](data.md#what-axylo-reads-keeps-and-copies)).

## Licence

MIT, for everything: zoom, accessibility and every chart type included. There is no commercial edition and no feature behind a licence key. The library has no runtime dependencies; third-party notices, if any, are checked at each release.

## What is not in 1.0

Not planned for 1.0, with the reason it can wait:

| Not in 1.0 | Why it can wait |
|---|---|
| More chart types (histogram first, then heatmap, box plot, candlestick, radar, treemap, sankey, gauge, maps) | Each must pass the same acceptance criteria as the five types in 1.0. |
| Log and other non-linear scales | They need their own rules for zero and negative values. |
| A second y axis | Often misleading; it needs a design that keeps the zero baseline honest. |
| Annotations beyond reference lines and bands | Placing free text interacts with label fitting. |
| Linked charts (shared cursor, brush) | Needs a small coordination API. |
| Export to PNG, SVG or CSV, and print styling | CSV from the table view comes first. |
| Server-side rendering to SVG | The drawing model makes it possible later. |
| Right-to-left layout mirroring | Stated as a limit in 1.0. |
| Quarters and ISO weeks as calendar periods | Treat them as ordered categories in 1.0. |
| Nested field paths (`'user.country'`) | Flatten rows before passing them. |
| Framework adapters (React, Vue, Svelte, Angular) and a custom element | Thin wrappers over the same handle; until then a chart is created and destroyed from the framework's own hooks (see [Getting started](getting-started.md#using-axylo-in-a-framework)). |
| A plugin or custom-mark API | Waits until two real uses show its shape. |
| Translations of built-in text | `messages` makes reader-facing ones possible; only English ships. |
| Workers, WebGL or WebGPU | Decided from measurements. |

Not the audience for 1.0: analysts exploring data in notebooks, designers building bespoke graphics, and teams that need maps, financial charts or network diagrams.
