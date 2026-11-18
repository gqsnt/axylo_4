# Accessibility

After this page you know what an Axylo chart exposes to assistive technology, to the keyboard and to readers with low vision, high-contrast settings or a colour-vision deficiency; which keys do what; what you as the author must supply; and what has and has not been verified.

These features are on by default: there is no module to import and no option to turn on.

## What the chart provides

| For | What the chart provides |
|---|---|
| Assistive technology | The figure is a group with an accessible name (`title`, or the heading named by `labelledBy`, or a generated name) and a description: the generated summary of type, series, x range with its time zone, value range, each series' minimum, maximum and last value, and anything left out. A compact chart is an image with the same name and description. The plot is one native range input whose value text describes the point in focus: its x, the value of each visible series with its unit, and its position ("Point 4 of 120"). Changes of state (loading, empty, error) are written once to a polite live region. "View as table" opens the data as an HTML table with a caption, column headers with units, and row headers. |
| Keyboard | Up to two tab stops while the table is closed: the plot, and the toolbar when the chart has controls. A compact chart has none. Every point is reachable in order, the series can be switched, the ends are one key away, and Tab leaves the chart. The focus indicator is at least 2 px wide, in the focus colour, which meets 3:1 on the default backgrounds. |
| Low vision | Text is HTML at 12 px or more by default, with 4.5:1 contrast for text and 3:1 for marks, axes and focus indicators in the default colours. Text follows browser zoom and the page's text-spacing settings. Labels never overlap; when one cannot be shown, the chart says so. The tooltip is placed against the marks it describes, never over the focused mark or a control, and lets the pointer pass through; Escape closes it. In a plot narrower than 240 px or shorter than 140 px, its content is written in a two-line strip reserved under the plot instead. |
| Colour-vision deficiency | Eight colours chosen to stay apart under simulated protanopia, deuteranopia and tritanopia, and never colour alone: lines and areas carry marker shapes, bars past the eighth series fill patterns, repeated in the legend and tooltip; adjacent fills are separated by background. |
| High contrast | In forced-colours mode the chart uses system colours, and lines also differ by dash; so they do under `prefers-contrast: more`. |
| Reduced motion | Nothing is animated on first render. Under `prefers-reduced-motion: reduce` nothing transitions at all. |
| Touch and a single pointer | Every control is at least 24 × 24 px. Zoom works by single clicks on buttons as well as by dragging. A one-finger drag scrolls the page. |

The legend entries of a line, area, bar or scatter chart are toggle buttons with a pressed state; a hidden series keeps its full-contrast text, struck through. A chart with one series has no legend entries. A donut's legend lists every slice, each with a button that selects that slice (the chart fires `select`), without a pressed state.

## The keyboard map

The plot is a single native range input laid over the chart. Its keys:

| Key | In the plot |
|---|---|
| Left, Right | Previous or next x, with every visible series there. Scatter: the previous or next point in x, then y order. Donut: the previous or next slice. |
| Home, End | The first or last point. |
| Page Up, Page Down | Forward or back by one tenth of the number of points, rounded down, and at least one. |
| Up, Down | Narrow to one series and move to the previous or next series. Donut: the next or previous slice. |
| Escape | Close the tooltip; it stays closed until the point changes. Pressed again, return from one series to all. Otherwise left to the page, so a chart in a dialog does not swallow it. |
| Enter, Space | Select the point: the chart fires its `select` event. |
| `+`, `-`, `0` | Zoom in, zoom out, show everything (date, time and number x). |
| Shift with Left or Right | Pan the zoomed view. |
| Wheel | Zoom, only while the plot has focus and never with Ctrl or Meta held. |

The toolbar holds the controls that apply to the chart: legend toggles, Zoom in, Zoom out, Pan left, Pan right, Reset zoom, Pause, View as table. It is one tab stop. Inside it the arrow keys move between controls, Home and End go to the first and last, and Enter or Space presses the control. The open table adds the table's scroll region to the tab order, and, when there are more than 100 rows, its pager (previous page, next page and a "Jump to" field). The plot's accessible description gives a short version of this map.

Pointer: on line and area charts the nearest x is picked, on bars the band under the pointer, on scatter charts the nearest point within 24 px, on a donut the slice under the pointer. A click or tap pins the tooltip, whose rows then become buttons that select a series; Escape or a click elsewhere unpins it.

This pattern was chosen by reasoning and by inspecting Chrome's accessibility tree, not by testing with screen readers; see [decision 0001](../../../docs/decisions/0001-plot-interaction-pattern.md) and [decision 0004](../../../docs/decisions/0004-tooltip-and-focused-text.md).

## What you must supply

Axylo can describe the data; only you know what it means.

- **A meaningful name.** Give every chart a `title`, or, when the card around it already has a visible heading, `labelledBy` with that heading's id. A generated name ("Line chart of sessions by day") is a fallback and raises [AX140](diagnostics.md#ax140). A title can be hidden visually with `title: { text, visible: false }`, and its heading level set with `level` (2 to 6, default 3) to fit your page's outline.
- **Series names.** For wide rows, give each field a `label`; for long rows, the series field's values are the names. They are part of every point's value text.
- **Units.** Set `unit` (and `label`) on value fields, so that "412" is "412 ms".
- **Context.** `description` adds what the data cannot say ("The spike on 12 March was the payment provider outage.") to the generated summary. It never removes the time zone or the statement of values left out.
- **The page's structure.** Headings, landmarks and the order of content around the chart are yours.
- **Text in other languages.** Every message the chart shows the reader can be replaced through `messages`; see the [translated example](options.md#messages). Diagnostics for developers keep their English wording. When the page's language is not English, the built-in English text is marked `lang="en"`.

[example: a11y-card](../examples/a11y-card.html)

## What has and has not been verified

The specification's own terms (section 3.8): automated checks establish structure (names, roles, focus order, contrast, text); they do not establish that a screen-reader user finds a chart understandable. The only evidence planned for that in 1.0 is a rehearsal by the developer on five screen-reader and browser pairs, recorded as rehearsal. Axylo is built by one person with no access to study participants, so no claim of usability testing with disabled users is made.

As of this documentation:

- **Verified, automatically, in desktop Chrome only:** the names, descriptions, roles, value text, focus order and contrast the chart exposes, and axe-core checks, by the library's acceptance tests.
- **Not yet done:** the developer's rehearsal. No screen reader has been run against these charts, so nothing on this site says what a screen reader speaks. The plot's pattern ([decision 0001](../../../docs/decisions/0001-plot-interaction-pattern.md)) and the rules for the tooltip and the focused point's text ([decision 0004](../../../docs/decisions/0004-tooltip-and-focused-text.md)) are unrehearsed.
- **Not verified:** Firefox, Safari (macOS and iOS), Edge, Windows, macOS, and phones.
- Right-to-left text renders, but the layout is not mirrored. Built-in text ships in English only.

## Conformance

The WCAG 2.2 AA conformance table is produced separately, from test evidence: see [Conformance table](conformance.md).
