# Review: the browser acceptance suite and the distribution tests

You are an independent reviewer from a different provider than the author of these tests. Read-only: do not create, edit or delete files. Put everything in your final message. You cannot launch a browser in this sandbox; review by reading, and run Node-only pieces where it helps (the helpers `packages/axylo/test/browser/acceptance/vision.ts` and `text.ts` are pure). Say for each finding whether you ran something or reasoned it out.

Under review, both written by Claude Opus 5.5:
- `packages/axylo/test/browser/acceptance/**` (commit 13b2f63; 457 tests; report `reviews/2026-11-18/impl/wp/acceptance-browser.report.md`).
- `tests/dist/**`, `examples/first-chart/**`, `scripts/pack.mjs`, `scripts/size.mjs`, package metadata (commit bf8fabf; 101 tests; report `reviews/2026-11-18/impl/wp/dist.report.md`).

These tests are the release gate: `docs/03-plan-typescript-release.md` line 7 says 1.0 is done when every cell of the acceptance matrix passes, and the matrix will cite these tests as evidence. A test that passes while the criterion is unmet is worse than no test. The criteria are in `docs/02-product-spec.md` (sections 3.2–3.4, 3.6, 3.7, 4); rules for tests are in `AGENTS.md` (expected values from the spec and hand-written fixtures, never from the implementation's output).

For the acceptance suite, most important first:

1. **For each criterion (L1–L8, I1–I6, A1–A10 except A3 and A9, F12, F8, F2 rendered, C1–C5, type-matrix cells): does the set of tests establish it for each chart type it claims?** Read the spec sentence, then the test bodies. Report: criteria where a clause of the sentence is never asserted; tests whose assertion is weaker than the title; tests that would pass with the feature removed (state the mutation); expected values that look copied from output or computed by re-implementing the library's own logic in the test (an oracle that shares the bug); loops over chart types where the expected value does not actually depend on the type; `waitForFunction` or retries that can turn a failure into a pass or a timeout into a skip.
2. **Accessibility evidence.** Which assertions read Chrome's computed accessibility tree, and which read DOM attributes while claiming to test what assistive technology gets? Are the axe runs excluding rules or regions? Is the colour-vision simulation in `vision.ts` correct (compare with your own knowledge of the Machado 2009 matrices and OKLab) and applied to rendered pixels or to declared colours? Is the grayscale marker test's criterion (overlap at most 85% of the union) defensible from the spec, or invented?
3. **Input realism.** Which tests dispatch synthetic events where real pointer, touch or keyboard input was required to exercise the code path?
4. **The "(reading: …)" choices** listed in the report's table of ambiguities: for each, is it the reading a chart reader would want, and does any reading quietly lower the bar (for example the 0.75 px separator coverage, the 300 ms settle, the 85% overlap)?
5. **The 14 failures in the author's run** (5 remain at commit 77213c0: C4 compact bar; L1 at 200% text for four types): is each a real product defect, or a test defect?

For the distribution tests:

6. **Isolation.** Can any fixture resolve `axylo` or `@axylo/react` through the workspace instead of the packed files, in Node, in esbuild, or in `tsc`? Is the tar extractor in `scripts/pack.mjs` correct for long paths, pax headers and symlinks (what does `npm pack` actually emit)?
7. **CSP.** Is the policy as strict as DX8 requires, are the response headers real, would a violation be observed (report-uri and the event) in every one of the 8 page variants, and does the negative control prove the instruments work? Does any page get its styles in a way the policy would have blocked without notice?
8. **Text is never HTML.** Which insertion points are covered and which are not (titles, series names, categories, units, tick formatter output, tooltip rows, table cells, messages overrides, the note, the summary, `aria-*` attributes)?
9. **Size measurement.** Does `scripts/size.mjs` measure what a consumer downloads (conditions, minifier settings, the CSS counted once, gzip level)? The reported 97.75 KiB for everything: reproduce it with your own esbuild call.
10. **Metadata changes** made by the test author (`files`, `sideEffects`): correct for npm, for bundlers, and for TypeScript's resolution of `exports` with `types`?

For each finding: severity (B a criterion is claimed without being tested, M major, m minor), file and line, the mutation or input that shows it, and the fix. At most 24 findings, most severe first. No praise. End with one line per area found sound, and a list of criteria you judge **not** established by these suites for at least one chart type.
