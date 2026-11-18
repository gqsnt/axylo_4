# Decision 0004: where the tooltip goes, and when the focused point's text changes

Status: decided by the coordinator on 2026-11-18 after the second review of the interaction layer (`reviews/2026-11-18/impl/wp/core3.interaction.review.md`, new findings 3 and 4). Not rehearsed with a screen reader or a screen magnifier; both parts need that before they are called verified.

## 1. The tooltip is offset across the direction of reading, not along it

**Problem.** WCAG 1.4.13 requires content shown on hover to be hoverable: the pointer must be able to move onto it without it disappearing. Spec I1 requires the readout to name the datum nearest the pointer on every move. On a line chart the whole plot is the picking surface, so a tooltip placed beside the pointer is entered by ordinary left-to-right reading: the plot stops receiving moves and the readout stalls on the old datum. The first fix (12 px, then 22 px of clearance) made the outcome depend on pointer speed: a single move longer than the clearance still lands on the tooltip.

**Rule.**

1. A chart is read along its position axis (x for line, area, scatter and vertical bars; y for horizontal bars). The tooltip is placed on the other side of the pointer **across** that axis: above the pointer for a horizontal position axis (below when there is no room above), to the right for a vertical one (left when there is no room). Along the position axis it is centred on the active mark and shifted only as far as needed to stay inside the plot and every clipping ancestor.
2. It keeps a clearance from the pointer and from the active mark, so moving along the position axis never enters it, at any speed. Moving straight toward it does not change the nearest datum (the position along the axis is unchanged), so the pointer reaches it with the same content showing: that is what makes it hoverable.
3. While the pointer is on the tooltip, the datum is held. Leaving it back into the plot resumes picking; leaving it elsewhere closes it after the usual delay. Escape dismisses it without moving the pointer.
4. When neither side across the axis has room (short tiles, compact layouts), the fixed readout under the plot is used instead. The readout has reserved space: it never covers the controls and is never pointer-transparent over them.
5. Donut and other two-dimensional picks have no reading axis: the tooltip goes outside the ring toward the nearer edge of the plot, or to the fixed readout when it does not fit.
6. A pinned tooltip (click, tap or keyboard) follows the same placement and stays until dismissed or until its datum leaves the displayed frame.

Rejected: making the tooltip transparent to the pointer (fails "hoverable"); a larger clearance alone (still speed-dependent); always using the fixed readout (loses the association between the readout and the mark on large plots, which is the main use of a tooltip).

## 2. The focused point's text changes only for a reason the reader would name

**Problem.** The plot's keyboard proxy is a native range whose value text describes the focused point, ending with its position ("Point 4 of 120"). While data streams in, the count changes on every append, so the text of a focused control changes without the reader acting. Spec A7 forbids unrequested announcements; whether a given screen reader speaks such a change cannot be tested here.

**Rule.** The range's bounds and numeric value are always kept true to the displayed frame, silently. Its value text is rewritten only when:

1. the reader moves (a key, an assistive adjustment, a pointer or touch selection that takes focus),
2. the focused datum's own values change (the same x and series now read differently),
3. the focused datum leaves the frame (the text must then say where focus went), or
4. the plot regains focus.

An append that only changes the count or the ordinal of an unchanged datum does not rewrite the text. The position in the text can therefore be out of date until the next of the four events; it is recomputed then.

To check with a screen reader when one is available (added to decision 0001's list): idle appends with the plot focused are silent; an eviction of the focused point is spoken once; an increment immediately after an append lands on the expected neighbour and reads the current count.
