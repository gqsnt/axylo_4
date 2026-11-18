# Work package: correct the `seeTable` rule (follow-up to reader-fix-2)

Read `AGENTS.md`. You own `packages/axylo/src/reader/**`, `src/messages/**`, `src/diagnostics/**` and their tests under `packages/axylo/test/reader`, `test/messages`, `test/diagnostics`. Nothing else; do not commit. Your previous run's changes are in the working tree, uncommitted (report: `reviews/2026-11-18/impl/wp/reader-fix-2.report.md`).

The rule I gave you for `seeTable` was wrong, and the acceptance suite caught it: five A10 tests (`packages/axylo/test/acceptance/`, the "authored warning" cases) now fail because an author who overrides `valuesNotShown` with `'Ausgelassen: {count}.'` gets `Ausgelassen: 1. See table.`: English appended to a translated sentence. A10 is the language criterion; an override must be used exactly as the author wrote it.

New rule, replacing the append:

- `seeTable` is a **placeholder** available in the four templates. The defaults become `'Values not shown: {count}. {seeTable}'`, `'Values shown differently from the data: {count}. {seeTable}'`, `'Some labels hidden. {seeTable}'` and `'{series} could not be drawn. {seeTable}'`.
- When the reader model has a table, `{seeTable}` is filled with the `seeTable` message; when it has none, with the empty string, and whitespace left at the end of the sentence is trimmed. The rendered default text for a chart with a table stays exactly `Values not shown: 3. See table.`; for a chart without one, `Values not shown: 3.`
- An author's override is used as written. If it contains `{seeTable}` it is filled by the same rule; if it does not, nothing is appended.

Update your unit tests to this rule (the tests you wrote for the append rule encoded my mistake; replace them, and say which). Then run `timeout 300 npx vitest run packages/axylo/test/reader packages/axylo/test/messages packages/axylo/test/diagnostics packages/axylo/test/acceptance` and list which acceptance tests are red and why. The A10 cases and the three C5 compact cases must be green. Others belong to modules being changed by other agents right now (the controller, the data stores); do not chase them.

Report: what changed, the test names, the last lines of the run, and the one-sentence comment I should put on `seeTable` in `public.ts`.
