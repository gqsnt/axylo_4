<!-- Author: Claude Opus 5.5 (high), agent a5e106319fe97c022; saved by the coordinator -->

## Weekly series stacked beside a daily one: today's behaviour does not match my reading of the rows

On the days the weekly series has no row, today's code treats it as a missing component: zero height and "incomplete". Reading the contract with F2, F5 and F10, I think a no-row slot is not a missing component. I wrote the test to that reading and left it failing, as asked. No library code changed; nothing committed.

The test's data: days 0–14, a daily series D = 10 + day, a weekly series W = 100 on days 0, 7 and 14. As a control, D is an explicit null on day 7. Stack order is [W, D], so W is the bottom band.

### 1. What happens today
**In the frame.** W's slots on days 1–6 and 8–13 are `SLOT_NO_ROW`, not `SLOT_GAP`: the weekly series' own step is 7 days, so nothing it expects is absent. D on day 7 is `SLOT_NULL`.

**In the stack** (`view/stack.ts` `buildStack`). Every slot that is not a value, `SLOT_NO_ROW` included, adds zero to the stack and sets `incomplete` for that x. So 12 of the 15 days are marked incomplete.

**Area scene:**
- The fill uses those cumulative sums. W's band pinches to zero height on every day between its rows (drawn at the baseline, 200 px), and D's band sits directly on the baseline there.
- W's stroke, however, is joined across the absent rows at 100 (y 67 px on every day), per F5's join rule. The fill and the stroke of the same series disagree.

**Bar scene.** W gets 3 value bars and 12 "no data" marks at the baseline, one on each day it has no row. That is F2's missing-bar mark applied to a slot that has no row.

**Readout on day 3:**
- Tooltip total: "13 (incomplete)".
- W's row: "No observation".
- Table row header: "3 (incomplete)".

### 2. What the rows say, read together
- The contract's `SLOT_NO_ROW` means "no observation at this x and none was expected; neighbours may be joined across it". A missing value is something else: an explicit null (`SLOT_NULL`), a missing expected step (`SLOT_GAP`), an invalid value, an absent field.
- F5: a slot a series merely has no row for (weekly beside daily) "does not break its line". Stacked areas are simplified on their cumulative sums. Exact values always come from the data, not the drawing.
- F2: missing values are "never drawn as zero".
- F10: "A missing component is drawn with zero height and the stack is marked incomplete".

My reading: a no-row slot is not a missing value, so it is not a missing component. That gives:
- **No "incomplete"** at those x.
- **Total** is the sum of the components that have values: day 3 reads "13", with W's row "No observation".
- **Stacked area:** W's band stays joined across its absent rows, like its own stroke, instead of pinching to zero.
- **Stacked bar:** W has no bar there.
- **Explicit null:** stays a missing component, with zero height and "incomplete".

The spec does not settle this explicitly, so it is the owner's choice. Two consequences of the joined reading, both allowed by F5's "exact values from the data, not the drawing":
- The drawn top of a stacked area includes W's interpolated contribution on in-between days, while the readout's total does not.
- D's band sits on W's joined band on those days.

I did not assert whether a stacked or grouped bar should draw a "no data" mark at a no-row slot. F2 names that mark only for a missing bar, so it belongs in the same decision.

### 3. The test and its result
`packages/axylo/test/view/stack-no-row.test.ts` covers view, lookup, reader and scene, for stacked area and stacked bar. Result: 3 failed, 4 passed (7).

**Passing:**
- The frame's slot states (no row for W between its weeks, a null for D on day 7), for area and bar.
- The explicit-null control on day 7, for area and bar: incomplete, total "100 (incomplete)", table header "7 (incomplete)".

**Failing, kept failing as asked:**
- "a day W has no row for is not an incomplete stack…", for area and for bar. `stack.incomplete` is 1 on day 3 where the test expects 0. Behind it, the probe shows the total "13 (incomplete)" against the expected "13", and the table header "3 (incomplete)" against "3".
- "the weekly band stays joined across its absent rows…" (area). W's fill edge on day 1 is at the baseline (200 px) where the test expects the joined value 100 (66.7 px).

If the owner chooses today's behaviour instead (no-row is a missing component), the test is the place to flip: the three expectations become incomplete and pinched, and the code stays.

### Runs
- `npm run typecheck`: no errors, the new test file included.
- view, scene and reader tests: `Test Files  1 failed | 6 passed (7)`, `Tests  3 failed | 145 passed (148)`. The three failures are this test's.
