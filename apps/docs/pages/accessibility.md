# Accessibility

After this page you know what an Axylo chart exposes to assistive technology, to the keyboard and to readers with low vision, high-contrast settings or a colour-vision deficiency; which keys do what; how values are read with a pointer; what you as the author must supply; and what has and has not been verified.

These features are on by default: there is no module to import and no option to turn on.

## What the chart provides

| For | What the chart provides |
|---|---|
| Assistive technology | The figure is a group with an accessible name (`title`, or the heading named by `labelledBy`, or a generated name) and a description: the generated summary of type, series, x range with its time zone, value range, each series' minimum, maximum and last value, and anything left out. A compact chart is an image with the same name and description. The plot is one native range input whose value text describes the point in focus: its x, the value of each visible series with its unit, and its position ("Point 4 of 120"). Changes of state (loading, empty, error) are written once to a polite live region. "View as table" opens the data as an HTML table with a caption, column headers with units, and row headers. |
| Keyboard | Up to two tab stops while the table is closed: the plot, and the toolbar when the chart has controls. A compact chart has none. Every point is reachable in order, the series can be switched, the ends are one key away, and Tab leaves the chart. The focus indicator is at least 2 px wide, in the focus colour, which meets 3:1 on the default backgrounds; it always shows while you use the keyboard in the plot, and it may also show after a click. |
| Low vision | Text is HTML at 12 px or more by default, with 4.5:1 contrast for text and 3:1 for marks, axes and focus indicators in the default colours. Text follows browser zoom and the page's text-spacing settings. Labels never overlap; when one cannot be shown, the chart says so. The tooltip is placed against the marks it describes, not at the pointer, and does not cover them, a control or the focus ring; in a small plot its content is written in a strip under the plot instead (see [Reading values with a pointer](#reading-values-with-a-pointer)). |
| Colour-vision deficiency | Eight colours chosen to stay apart under simulated protanopia, deuteranopia and tritanopia, and never colour alone: lines and areas carry marker shapes, repeated in the legend and tooltip; bars by position and order, named in the legend and tooltip, and also by fill pattern past the eighth series and between neighbours in a compact chart, which has no legend; adjacent fills are separated by background. |
| High contrast | In forced-colours mode the chart uses system colours, and lines also differ by dash; so they do under `prefers-contrast: more`. |
| Reduced motion | Nothing is animated on first render. Under `prefers-reduced-motion: reduce` nothing transitions at all. |
| Touch and a single pointer | Every control is at least 24 × 24 px. Everything a drag does can be done with single clicks or taps: Zoom in and out, Pan left and right, and Select range for choosing a range with two clicks. A one-finger drag scrolls the page. |

The legend entries of a line, area, bar or scatter chart are toggle buttons with a pressed state; a hidden series keeps its full-contrast text, struck through. A chart with one series has no legend entries. A donut's legend lists every slice, each with a button that selects that slice (the chart fires `select`), without a pressed state.

## The keyboard map

The plot is a single native range input laid over the chart. Its keys:

| Key | In the plot |
|---|---|
| Left, Right | Previous or next x, with every visible series there. Scatter: the previous or next point in x, then y order. Donut: the previous or next slice. |
| Home, End | The first or last point. |
| Page Up, Page Down | Forward or back by one tenth of the number of points, rounded down, and at least one. |
| Up, Down | Narrow to one series and move to the previous or next series. Donut: the next or previous slice. |
| Escape | One thing per press, in this order: end a drag; release Select range; close the tooltip or end a pin: the datum on show stays closed until the pointer has reached a different datum, and nothing else opens at once (after Escape from a held tooltip, the datum under the pointer stays closed too); return from one series to all. When none of these applies, the key is left to the page, so a dialog around the chart closes only on an Escape the chart did not use. |
| Enter, Space | Select the point: the chart fires its `select` event. |
| `+`, `-`, `0` | Zoom in, zoom out, show everything (date, time and number x). |
| Shift with Left or Right | Pan the zoomed view. |
| Wheel | Zoom, only while the plot has focus and never with Ctrl or Meta held. |

The toolbar holds the controls that apply to the chart: legend toggles, Zoom in, Select range, Zoom out, Pan left, Pan right, Reset zoom, Pause, View as table. It is one tab stop. Inside it the arrow keys move between controls, Home and End go to the first and last, and Enter or Space presses the control. The open table adds the table's scroll region to the tab order, and, when there are more than 100 rows, its pager (previous page, next page and a "Jump to" field). The plot's accessible description gives a short version of this map.

With several charts on a page, an Escape belongs to the chart that has focus or, when focus is in none of them, to the one that showed something last; one press is used by one chart at most.

This pattern was chosen by reasoning and by inspecting the browsers' accessibility trees, not by testing with screen readers; see [decision 0001](../../../docs/decisions/0001-plot-interaction-pattern.md) and [decision 0004](../../../docs/decisions/0004-tooltip-and-focused-text.md).

## Reading values with a pointer

Pointing anywhere in the plot shows what is there, by the chart type's rule: on line and area charts the nearest x, on bars the band under the pointer, on scatter charts the nearest point within 24 px, on a donut the slice under the pointer. What is shown depends on the room the plot has:

| Plot | What pointing shows |
|---|---|
| At least 240 × 140 px | A floating tooltip. |
| Narrower than 240 px or shorter than 140 px | The same content, written as running text ("x: series value; series value; +2 more") in a strip of two lines reserved under the plot. The strip covers nothing, and nothing covers it. |
| So small that the strip would leave the plot under 80 px high | No readout. The datum is highlighted; its values are in the plot's keyboard reading and in the table. |

The choice is made by layout, when the chart is laid out, never by the pointer.

**Where the tooltip goes.** It is placed against the marks of the datum it describes, never at the pointer: above them first, then below, then to the right or the left (for horizontal bars: right, left, above, below); a donut's tooltip goes in its hole first, when it fits there. It stays inside the plot, the viewport and any container that clips the chart, and covers neither those marks, a control nor the focus ring; rows that do not fit are counted in "+N more". Only when not even one row fits anywhere may it partly cover the marks, never a control or the focus ring, and the table still has every value.

**Long text.** A value that fits stays on one line with its unit; a longer one wraps inside the tooltip, which is never wider or taller than the visible part of the plot. However long the text, the tooltip shows its heading and at least one row, cut if they must be; it is left out only when every place for it would cover a control or the focus ring. In the strip, entries wrap within its two lines, and when not even one fits, the x and one row are cut to one line with an ellipsis. Its "+N more" is shown whole or the strip is not shown.

**It never takes the pointer.** The pointer passes through a tooltip to the plot, so the readout follows every move and a click lands on the plot. To reach the tooltip, rest the pointer on the datum for a quarter of a second: the datum is then held while the pointer travels towards its tooltip and while it is over it. Leaving that path picks again at once; a pointer that moves without resting is never held. A click always acts on what is under the pointer, whatever is held.

**A click or tap pins.** It selects the datum under the pointer (the `select` event) and pins its tooltip, or its strip. Pinned, the content takes the pointer and is exposed to assistive technology: each row is a button of at least 24 × 24 px that selects that series' value, and "+N more" becomes a button that shows the next rows. The rows are outside the tab order; from the keyboard, the plot's Up and Down reach the same series. The pin ends with Escape, a click elsewhere, a drag or pinch, or when its datum leaves the view. With `tooltip: false`, or in a plot with no readout, nothing is pinned; a click still selects. While Select range is pressed, a click sets an end of the zoom range instead, and neither pins nor selects ([zoom](updating.md#zoom)).

## What you must supply

Axylo can describe the data; only you know what it means.

- **A meaningful name.** Give every chart a `title`, or, when the card around it already has a visible heading, `labelledBy` with that heading's id. A generated name ("Line chart of sessions by day") is a fallback and raises [AX140](diagnostics.md#ax140). A title can be hidden visually with `title: { text, visible: false }`, and its heading level set with `level` (2 to 6, default 3) to fit your page's outline.
- **Series names.** For wide rows, give each field a `label`; for long rows, the series field's values are the names. They are part of every point's value text.
- **Units.** Set `unit` (and `label`) on value fields, so that "412" is "412 ms".
- **Context.** `description` adds what the data cannot say ("The spike on 12 March was the payment provider outage.") to the generated summary. It never removes the time zone or the statement of values left out.
- **The page's structure.** Headings, landmarks and the order of content around the chart are yours.
- **A pause for streaming compact tiles.** A full chart fed by `append` has its own Pause control. A compact chart has no toolbar, so it has none: if your tiles stream, give the reader a control of your own that stops appending, and append what arrived meanwhile on resume (WCAG 2.2.2).
- **Text in other languages.** Every message the chart shows the reader can be replaced through `messages`; see the [translated example](options.md#messages). Diagnostics for developers keep their English wording. When the page's language is not English, the built-in English text is marked `lang="en"`.

[example: a11y-card](../examples/a11y-card.html)

## What has and has not been verified

Automated checks establish structure: names, roles, focus order, contrast and text. They do not establish that a person using a screen reader understands a chart.

- **Automated checks** are the library's acceptance tests, run in Chrome on Linux and in Playwright's builds of Firefox and WebKit. WebKit results are Playwright's WebKit, not Safari. What the acceptance checker recorded for the revision of this site is on the [conformance page](conformance.md).
- **No screen-reader rehearsal was done for 1.0.** No screen reader has been run against these charts, so nothing in this documentation says what a screen reader speaks. The plot's pattern ([decision 0001](../../../docs/decisions/0001-plot-interaction-pattern.md)) and the rules for the tooltip and the focused point's text ([decision 0004](../../../docs/decisions/0004-tooltip-and-focused-text.md)) are untried with a screen reader and with a screen magnifier.
- **No usability testing with disabled people.** Axylo is built by one person with no access to study participants, and no claim of usability testing with disabled users is made.
- **Not run at all:** Safari itself (macOS and iOS), Edge, Windows, macOS, and phones.
- **Limits of 1.0:** right-to-left text renders, but the layout is not mirrored. A chart inside a rotated, skewed or mirrored element draws, but pointing and tooltip placement are wrong there; inside a translated or scaled element (any positive scale) they are exact. Built-in text ships in English only.

## Conformance

The [conformance table](conformance.md) lists the WCAG 2.2 success criteria the specification cites, what Axylo does for each, and what the acceptance checker recorded for them when this site was built.
