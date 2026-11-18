# Decision 0001: how the plot is exposed to keyboards and screen readers

Status: working choice, **not rehearsed with any screen reader**. The plan (M1) called for three candidate patterns to be rehearsed on five screen-reader and browser pairs before choosing. No screen reader can be run in the environment this was built in, so the choice below was made by reasoning and by inspecting Chrome's accessibility tree, and it must be rehearsed by the owner before it is relied on. If rehearsal contradicts it, the plot's roles are internal and can change without touching the public API.

## Candidates

| Pattern | For | Against |
|---|---|---|
| A. `role="application"` on the plot, arrow keys handled in script, point text sent to a live region | Used by Recharts and ApexCharts. Full control of keys. | Screen-reader authors discourage `application`; a live region is a second, slower channel; touch screen readers have no arrow keys, so points cannot be reached by swiping. |
| B. A roving focusable proxy element per point (or one moved around), each with its own label | Each point is a real element with a name. | One element per point does not scale to 100,000 points; a single moved proxy re-announces its role on every move in some readers (from memory, not verified). |
| C. One native `<input type="range">` laid over the plot, its value the position along x, its `aria-valuetext` the point's text | A native control: desktop readers enter focus mode on it by themselves, arrow keys, Home, End and Page keys work without script, and a change of value text is read without a live region. Touch screen readers expose a native range as an adjustable element, so swiping up and down moves through points (from memory for VoiceOver on iOS and TalkBack; not verified here). One element whatever the number of points. | It is announced as a slider, which is not what a chart is; mitigated by `aria-roledescription` and a label that says what moving it does. Up and Down natively do the same as Right and Left. |

## Choice: C

One visually transparent native range input covers the plot. It is the plot's single tab stop.

- **Value**: the ordinal of the current x among the visible x positions (for scatter: among visible points in x then y order; for donut: slice order), from `Lookup.ordinal` and `Lookup.count`.
- **Value text**: by default everything at that x, like the pointer tooltip: the x, then each visible series with its value, then "point 4 of 120". After the reader narrows to one series (Up or Down on a keyboard), only that series is read. Escape returns to all series.
- **Keys**: Left and Right move along x (native). Home, End, Page Up and Page Down native. Up and Down are intercepted to change the series in focus. `+`, `-`, `0` and Shift+arrows zoom and pan. Enter or Space selects (fires `select`). Escape: closes the tooltip first, then leaves single-series mode; otherwise it is not consumed, so a chart inside a dialog does not swallow it.
- **Touch screen readers**: swiping up or down on the adjustable element moves along x and reads every series at that x; the table is one control away in the toolbar.
- **Everything else** (legend toggles, zoom buttons, pause, table) is ordinary buttons in one toolbar with roving focus: the chart's second and last tab stop while the table is closed.

## What has to be checked by rehearsal

1. NVDA with Chrome and with Firefox: focus mode is entered on the range without a keystroke; each arrow press reads the new value text once; Up and Down are passed through and the series change is read.
2. VoiceOver with Safari on macOS: the same, and the role description is read sensibly.
3. VoiceOver on iOS and TalkBack with Chrome: the element is reachable by touch exploration at the plot's position; swipe up and down move by one point and read it; the toolbar and table are reachable by swiping right.
4. That a long value text (eight series) is not cut off, and that streaming data does not make the reader speak unless the reader moves.
