# Code review: Axylo scale and format modules

You are an independent reviewer from a different provider than the author of this code. Read-only: do not create, edit or delete files. Put everything in your final message.

Under review: `packages/axylo/src/scale/**` and `packages/axylo/src/format/**`, with their tests in `packages/axylo/test/scale/**` and `packages/axylo/test/format/**`. They were written to this brief: scales and nice ticks (linear, band, time in an IANA zone using only `Intl`), the value-axis domain rules of spec F1 and F7, and number and date formatting per spec F4 and F6. Context: `AGENTS.md`, `packages/axylo/src/core/contracts.ts`, `docs/02-product-spec.md` (F1, F4, F6, F7, section 3.5 codes AX110 and AX160).

You may run `npm run typecheck` and `npx vitest run packages/axylo/test/scale packages/axylo/test/format` and small read-only Node experiments (for example `node -e` with `Intl`) to check behavior. Do not write files.

Find defects, in this order of importance:
1. **Wrong results.** Time-zone arithmetic at daylight-saving gaps and folds, zones with unusual offsets or historical changes, dates before 1970 and far in the future, month and year boundaries, leap years; tick sets that contain a value outside the domain, duplicates, or labels that repeat for different values; floating-point steps (0.1 + 0.2 class errors) in ticks and labels; the domain rules (zero inclusion, percent and ratio full scale only when the maximum is at least half of full scale, constant, all-negative and empty data, author domains); number formatting (negative zero, very large and very small magnitudes, non-finite input, the six-significant-digit rule), percent and ratio handling, units.
2. **Spec mismatches** against F1, F4, F6, F7.
3. **Tests that do not test.** Expected values that were evidently copied from the implementation, assertions that cannot fail, properties with generators too narrow to find the bugs they claim to exclude, missing cases from the list above.
4. **Performance traps** on hot paths (tick generation is called on every layout; formatters on every tooltip): per-call construction of `Intl` objects, quadratic loops, unbounded tick counts for wide domains.
5. **Contract or isolation problems**: DOM access, imports from other modules, mutation of inputs.

For each finding give: severity (B blocks, M major, m minor), file and line, a concrete input that shows the problem and the wrong output you observed or expect (say which), and the fix. Label what you ran and observed apart from what you infer. At most 15 findings, most severe first. No praise. End with one line per area you checked and found sound.
