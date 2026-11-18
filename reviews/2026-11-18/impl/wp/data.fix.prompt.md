You wrote the `data` and `diagnostics` modules of Axylo in this repository (brief: `reviews/2026-11-18/impl/wp/data.prompt.md`). An independent reviewer from another provider tried to break them and found 18 defects. Read `AGENTS.md` again, then the review at `reviews/2026-11-18/impl/wp/data.review.md`, then the updated registry in `docs/02-product-spec.md` section 3.5 (AX105 has a cap now; AX134 and AX152 are new) and criterion F11 (points sharing an x are ordinary data on scatter).

You own, as before, only: `packages/axylo/src/data/**`, `packages/axylo/src/diagnostics/**`, `packages/axylo/test/data/**`, `packages/axylo/test/diagnostics/**`.

**Compatibility while you work:** other agents are calling your modules' exported functions and types right now (`resolveOptions`, `normalize`, `AlignedStore`, `validateOptions`, `DiagnosticCollector`, `readerDisclosure`, `report`, `createDiagnostic`, and the parser in `data/x`). Do not rename or remove any exported function, parameter, type or result field. Additions must be optional.

For each finding: reproduce it with a failing test first, then fix it. Decisions already taken:

- **1.** Cap absent-step materialization per series: when a series would need more absent steps than twice its observations and more than 1,000, treat the series as irregular (SLOT_NO_ROW between observations, no inserted positions) and raise AX105 as a hint whose message says the series was too sparse to show its absent steps as gaps. Never allocate in proportion to the x range. The same cap applies in the streaming store.
- **2.** `type: 'date'` accepts `Date` objects, finite numbers (epoch milliseconds) and ISO strings with an offset, and maps each to its UTC calendar day at 00:00 UTC, `dateUnit` 'day'.
- **3.** Infer the x kind over the whole column, independent of row order: `Date` objects and offset ISO strings mean `time`; date strings mean `date`; offsetless date-times mean `wall`; numbers mean `number`; a column is `category` only when at least half of its non-missing values fit none of those. Values that do not fit the chosen kind raise AX107.
- **4.** A space between date and time is accepted wherever `T` is.
- **5.** A `wall` axis gets step inference and gaps like `time`, with plain UTC arithmetic.
- **6.** An unknown `timeZone` raises AX152 (warning, effect 'none', field `x.timeZone` or the field name), and the environment's zone is used. Canonicalize the zone through `Intl` ('utc' → 'UTC'). `validateOptions` must never throw for bad input.
- **7.** `type`, `scale`, `missing` and `parse` values outside their literal sets raise AX150 naming the option and the closest valid value, and the default is used.
- **8, 9.** The store must stay bounded under `keep`: unplaceable rows, diagnostics for evicted rows, series whose window holds no observation, and categories no retained slot references are all dropped as the window moves. Diagnostics reflect what is currently retained. One-row appends at a shared x must not copy the window each time.
- **10.** The field-existence check (AX101) also runs on the first non-empty batch appended to a chart that started empty, and whenever every row of a batch lacks a field.
- **11.** Before allocating an aligned frame, when series × x positions exceeds 20,000,000 raise AX134 (error, effect 'chart-error') and return an empty frame.
- **12.** Every key of the public `Messages` interface is a valid key of `messages`. Keep the list as a typed constant that fails to compile when the interface gains a key (`satisfies Record<keyof Messages, true>`).
- **13.** The reader's disclosure counts each omitted slot or point once. Do not run value checks for rows already omitted because of their x, series name or label. AX105 has effect 'none' in every case.
- **14.** Leave the import of `scale/zone` as it is.
- **15.** Deduplicate example rows; format positions in messages according to the x kind (a date, not epoch milliseconds); name the series in AX105 and AX108; every message ends with what is drawn, as the registry's last column says; suggest a closest name only when the edit distance is at most a third of the name's length.
- **16.** Gap positions on number axes are canonical: computed from the step so two series missing the same step share one slot.
- **17.** `missing: 'zero'` applies to the donut too.
- **18.** Widen the tests as the reviewer lists, remove the expectation copied from output (`rows: [2, 2]`), and make the million-point timing test meaningful (warm up, median of several runs, bound of 100 ms).
- **Also:** on scatter, points that share an x (or both coordinates) are ordinary data: no AX108, the series stays drawable, and all points are kept in x then y order.

Run `npm run typecheck` and `npm test` from the repository root. Other agents are mid-change elsewhere; failures in files you do not own are not yours.

Report per finding: reproduced (yes/no), fixed (yes/no), the test that covers it, and anything you disagree with and why. Paste the last lines of the test run.
