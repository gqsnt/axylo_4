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

**What the promise covers.** The functions and types exported by `axylo` and `@axylo/react` (the declarations in `packages/axylo/src/public.ts`), the diagnostic codes and their levels, the CSS custom properties documented on [Theming](theming.md), and the keys of `messages`. Match diagnostics on `code`; messages are written for people.

**What it does not cover.** The chart's internal DOM structure and class names, the custom properties listed as internal, the roles the plot uses to talk to assistive technology (chosen without screen-reader rehearsal, and changeable in a minor release if rehearsal shows a better pattern), and the exact pixels of the drawing.

## Supported environments

| Dimension | 1.0 |
|---|---|
| Browsers | The current and previous major versions of Chrome, Edge, Firefox and Safari, on macOS and iOS. |
| TypeScript | 5.4 and later. Plain JavaScript is fully supported; types are an aid, not a requirement. |
| React | 18 and 19, through `@axylo/react`. |
| Node | Importing `axylo` touches no DOM, and `validate()` runs there. Charts themselves need a browser. |
| Text direction | Left-to-right pages. Right-to-left text renders, but the layout is not mirrored. |
| Built-in text | English, replaceable through `messages`. |

Verified so far: Chrome on Linux desktop only. Firefox, Safari, Edge, Windows, macOS and phones have not been tested yet; see [Accessibility](accessibility.md#limits).

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
| Vue, Svelte and Angular adapters, a custom element | Thin wrappers over the same handle. |
| A plugin or custom-mark API | Waits until two real uses show its shape. |
| Translations of built-in text | `messages` makes them possible; only English ships. |
| Workers, WebGL or WebGPU | Decided from measurements. |

Not the audience for 1.0: analysts exploring data in notebooks, designers building bespoke graphics, and teams that need maps, financial charts or network diagrams.
