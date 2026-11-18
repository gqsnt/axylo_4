# Decision 0004: where the tooltip goes, and when the focused point's text changes

Status: decided by the coordinator on 2026-11-18 after the second review of the interaction layer (`reviews/2026-11-18/impl/wp/core3.interaction.review.md`, new findings 3 and 4). Not rehearsed with a screen reader or a screen magnifier; both parts need that before they are called verified.

## 1. The tooltip is anchored to the datum and never takes the pointer (revision 2)

Revision 1 (placed across the reading axis, offset from the pointer, interactive while hovered) was implemented three times and still failed the acceptance tests: because the tooltip's position followed the pointer it moved away when approached, because it took pointer events it stalled the readout or swallowed the click whenever a move landed on it, and it could cover controls and the focus ring. Revision 2 removes the causes instead of tuning distances.

**Problem.** WCAG 1.4.13 requires content shown on hover to stay when the pointer moves onto it. Spec I1 requires the readout to name the datum at the pointer on every move, the tooltip not to cover the active mark, to stay inside the viewport, and to fall back to a fixed readout when it cannot fit. On a line chart the whole plot picks, so anything that takes pointer events inside the plot blocks picking.

**Rules.**

1. **Position depends on the datum only.** For the datum on show, the tooltip is placed against the bounding box of that datum's active marks (all series at that x for line, area and bar; the point for scatter; the slice for donut), enlarged by the focus ring's width. The pointer's own position never enters the computation, so the tooltip does not move while the datum is unchanged, and it cannot run away from an approaching pointer.
2. **Candidates, in order:** above the box, below it, then to the right and to the left of it (for horizontal bars: right, left, above, below). Along the other axis it is centred on the box and shifted only as far as needed. A candidate is valid when the tooltip lies wholly inside the plot rectangle, inside the viewport and inside every clipping ancestor, and overlaps neither the box nor any control. The first valid candidate is used. For a donut the first candidate is the hole, when the tooltip fits inside it.
3. **A hovered tooltip never takes pointer events.** It is `pointer-events: none`. The plot keeps receiving every move, so picking never stalls at any speed, and a click goes to the plot and selects the datum under the pointer. Moving the pointer onto the tooltip therefore cannot hide it: on line, area and bar the tooltip stays for as long as the pointer's position along the reading axis still picks the same datum, which a straight approach across the reading axis does; on scatter and donut, while the pointer is inside the tooltip's rectangle the datum is held (computed from coordinates in the plot's own move handler, not by letting the tooltip take the event).
4. **Rows are not controls while hovered.** A hovered tooltip is text. Clicking or tapping the plot pins the tooltip for that datum; a pinned tooltip takes pointer events, stays until Escape, a click elsewhere, or its datum leaves the displayed frame, and its rows are buttons of at least 24 × 24 CSS px (WCAG 2.5.8) that select a series. Keyboard focus shows the same tooltip by the same placement; it is never over the focus ring because the box includes the ring.
5. **Readout mode is decided by layout, not by hover.** When the plot is narrower than 240 CSS px or shorter than 140 CSS px, the figure is in readout mode: a strip of two text lines is reserved under the plot in the layout, and the content that would be in the tooltip is written there as running text ("x: series value; series value; +N more"), wrapping to the two lines and ending in "+N more" when it does not fit. The strip is part of the figure's flow: it covers nothing and nothing covers it. In readout mode there is no floating tooltip. A pinned datum makes the strip's entries buttons of 24 px height.
6. **When no candidate is valid outside readout mode** (a tooltip taller than the room around a tall stack, for example), rows are dropped from the end and counted in "+N more" until a candidate is valid; if none is with one row, the tooltip is placed inside the plot at the candidate that overlaps the box least. This is the only case in which the active mark may be partly covered, and the table still has every value.
7. Escape dismisses a hovered or pinned tooltip without moving the pointer, until the pointer reaches a different datum.

Rejected: revision 1; an interactive hovered tooltip with a "safe triangle" (still ambiguous when the reading axis and the approach coincide); always using the readout (loses the association between the values and the mark on plots that have room).

What "can itself be hovered" (spec I1) means under this decision, for the tests: the pointer can be moved straight from the datum onto the tooltip's rectangle, and the tooltip is still shown, for the same datum, when the pointer is inside it. It does not mean the tooltip is the hit-test target.

## 2. The focused point's text changes only for a reason the reader would name

**Problem.** The plot's keyboard proxy is a native range whose value text describes the focused point, ending with its position ("Point 4 of 120"). While data streams in, the count changes on every append, so the text of a focused control changes without the reader acting. Spec A7 forbids unrequested announcements; whether a given screen reader speaks such a change cannot be tested here.

**Rule.** The range's bounds and numeric value are always kept true to the displayed frame, silently. Its value text is rewritten only when:

1. the reader moves (a key, an assistive adjustment, a pointer or touch selection that takes focus),
2. the focused datum's own values change (the same x and series now read differently),
3. the focused datum leaves the frame (the text must then say where focus went), or
4. the plot regains focus.

An append that only changes the count or the ordinal of an unchanged datum does not rewrite the text. The position in the text can therefore be out of date until the next of the four events; it is recomputed then.

To check with a screen reader when one is available (added to decision 0001's list): idle appends with the plot focused are silent; an eviction of the focused point is spoken once; an increment immediately after an append lands on the expected neighbour and reads the current count.
