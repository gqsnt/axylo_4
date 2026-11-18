# Accessibility

After this page you know what a reader using a screen reader, a keyboard, magnification, high contrast or with a colour-vision deficiency gets from an Axylo chart, which keys do what, what you as the author must supply, and what has not been verified.

Accessibility is on by default and cannot be forgotten: there is no module to import and no option to turn on.

## What each reader gets

| Reader | What the chart provides |
|---|---|
| Screen reader | The chart is a named group (or, when compact, a named image) with a generated summary: chart type, series, the x range with its time zone, the value range, each series' minimum, maximum and last value, and any values left out. The plot is one native slider-like control whose value text reads the point in focus: its x, every visible series' value with its unit, and "Point 4 of 120". "View as table" opens the data as an HTML table with a caption, column headers with units, and row headers. Changes of state (loading, empty, error) are announced once, politely; arriving data is not announced. |
| Keyboard | Two tab stops while the table is closed: the plot and the toolbar. Every point is reachable in order, the series can be switched, the ends are one key away, and Tab always leaves the chart. The focus indicator is at least 2 px and 3:1. |
| Low vision | Text is real HTML at 12 px or more, with 4.5:1 contrast; marks, axes and focus indicators 3:1. Text follows browser zoom and user text-spacing settings. Labels never overlap; when one cannot be shown, the chart says so. The tooltip can be hovered, stays inside the window, and Escape closes it. |
| Colour-vision deficiency | Eight colours kept apart under simulated protanopia, deuteranopia and tritanopia, and never colour alone: each line has its own marker shape, repeated in the legend and tooltip; adjacent fills are separated by background. |
| High contrast | Forced-colours mode uses system colours, and lines also differ by dash; so they do under `prefers-contrast: more`. |
| Reduced motion | Nothing is animated on first render. Under `prefers-reduced-motion: reduce` nothing transitions at all. |
| Touch and single pointer | Every control is at least 24 × 24 px. Zoom works by single clicks on buttons as well as by dragging. A one-finger drag scrolls the page. |

The legend entries are toggle buttons with a pressed state. When a series is hidden, its entry keeps full-contrast text, struck through.

## The keyboard map

The plot is a single native range input laid over the chart. Its keys:

| Key | In the plot |
|---|---|
| Left, Right | Previous or next x, reading every visible series there. Scatter: the previous or next point in x, then y order. Donut: the previous or next slice. |
| Home, End | The first or last point. |
| Page Up, Page Down | A larger step. |
| Up, Down | Narrow to one series and move to the previous or next series. Donut: the next or previous slice. |
| Escape | Close the tooltip; pressed again, return from one series to all. Otherwise left to the page, so a chart in a dialog does not swallow it. |
| Enter, Space | Select the point: the chart fires its `select` event. |
| `+`, `-`, `0` | Zoom in, zoom out, show everything (date, time and number x). |
| Shift with Left or Right | Pan the zoomed view. |
| Wheel | Zoom, only while the plot has focus and never with Ctrl or Meta held. |

The toolbar (legend toggles, Zoom in, Zoom out, Pan left, Pan right, Reset zoom, Pause, View as table; each appears when it applies) is one tab stop. Inside it the arrow keys move between controls, Home and End go to the first and last, and Enter or Space presses the control. The open table adds the table's scroll region and its pager (previous page, next page and a "Jump to" field) to the tab order.

This pattern was chosen by reasoning and by inspecting Chrome's accessibility tree, not by testing with screen readers; see [decision 0001](../../../docs/decisions/0001-plot-interaction-pattern.md) and the limits below. The plot's accessible description gives a short version of this map.

## What you must supply

Axylo can describe the data; only you know what it means.

- **A meaningful name.** Give every chart a `title`, or, when the card around it already has a visible heading, `labelledBy` with that heading's id. A generated name ("Line chart of sessions by day") is a fallback and raises [AX140](diagnostics.md#ax140). A title can be hidden visually with `title: { text, visible: false }`, and its heading level set with `level` (2 to 6, default 3) to fit your page's outline.
- **Series names.** For wide rows, give each field a `label`; for long rows, the series field's values are the names. They are read for every point.
- **Units.** Set `unit` (and `label`) on value fields, so "412" is read as "412 ms".
- **Context.** `description` adds what the data cannot say ("The spike on 12 March was the payment provider outage.") to the generated summary. It never removes the time zone or the statement of values left out.
- **The page's structure.** Headings, landmarks and the order of content around the chart are yours.
- **Text in other languages.** Every built-in string can be replaced through `messages`. When the page's language is not English, built-in English text is marked `lang="en"`.

[example: a11y-card](../examples/a11y-card.html)

## Limits

Automated checks establish structure: names, roles, focus order, contrast and text. They do not establish that a screen-reader user finds a chart understandable. The only evidence planned for that in 1.0 is a rehearsal by the developer on five screen-reader and browser pairs, recorded as rehearsal. Axylo is built by one person with no access to study participants, so no claim of usability testing with disabled users is made.

As of this documentation:

- No screen reader has been run against these charts yet. The plot's pattern ([decision 0001](../../../docs/decisions/0001-plot-interaction-pattern.md)) and the rules for the tooltip and the focused point's text ([decision 0004](../../../docs/decisions/0004-tooltip-and-focused-text.md)) are unrehearsed.
- Only Chrome on desktop has been tested. Firefox, Safari (macOS and iOS) and phones have not been verified.
- The tooltip's placement, the pan buttons, zoom on category axes and the table's overlay are being finished, and may differ from this page until they are.
- Right-to-left text renders, but the layout is not mirrored.
- Built-in text ships in English only; other languages go through `messages`.

## Conformance

The WCAG 2.2 AA conformance table is produced separately, from test evidence: see [Conformance table](conformance.md).
