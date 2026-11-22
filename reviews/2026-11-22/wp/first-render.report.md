# First-render and renderer removal review

Separate read-only same-provider Codex review. Requested model `gpt-6.1-sol`, effort `xhigh`. Observed model `gpt-6.1-sol`, effort `xhigh` in the session rollout (`01a201ae-2cb7-7370-8a76-357c47002a5a`).

1. **P2 — Historical comparisons now require bypassing the harness guard.** [bench/build.mjs:105](/home/canarit/projects/axylo/bench/build.mjs:105) compiles library capabilities into adapter code and omits the Canvas adapter. In-memory compilation confirmed that identical adapter sources produce different bytes across the Canvas-removal boundary. [bench/run.mjs:301](/home/canarit/projects/axylo/bench/run.mjs:301) therefore rejects an old/new comparison even when both use the same harness sources. The suggested `--allow-harness-difference` bypass disables the broader protection against confounded measurements. Keep adapters capability-independent, or validate narrowly defined capability differences explicitly. Original sealed-artifact replay remains available.

2. **P2 — The frozen renderer contract was changed unnecessarily.** [contracts.ts:565](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:565) narrows renderer/element types and removes the theme argument from both drawing methods, contrary to `AGENTS.md`. This breaks compatibility with modules implementing or calling the agreed interface. SVG-only shipping can retain that interface, ignoring unused arguments. Restore the frozen contract; no contract change is necessary. `public.ts` is unchanged.

3. **P3 — The investigation overstates source provenance.** [p1-investigation-2026-11-22.md:3](/home/canarit/projects/axylo/bench/results/p1-investigation-2026-11-22.md:3) describes committed-source snapshots, but its SVG-only row uses an uncommitted snapshot based on `bb2826ac`. Identify that exception and its artifact/source hash so readers can reproduce the measured code.

The SVG-only implementation follows decision 0002. Static tracing found no additional regression in accessibility structure, focused-text updates, diagnostic delivery, live theme paints, author color overrides, or cleanup. Controller checks passed for UTC, explicit non-UTC, local/default time, invalid-zone fallback, basic teardown, and floating/strip/none resize transitions.

I read the investigation after reviewing the code. All 15 history rows matched stored medians, load ranges and pair counts. Recomputing six first-chart profiles reproduced the stage table and `viewerTimeZone` attribution. These support investigation, not isolated feature costs or guaranteed optimization savings. The adapter fixes UTC, so improvements cannot establish local-zone performance. The artifact matching current sources has an interrupted P1 run; current budget compliance remains unverified.

Verification was read-only:

- `npm run typecheck` exited successfully.
- Two Node test files reported:
  ```text
  ℹ pass 2
  ℹ fail 0
  ```
- In-memory checks ended with:
  ```text
  PASS: 5 in-memory time-zone/controller checks; teardown canceled pending work.
  PASS: 5 readout modes across float/strip/none and responsive strip-height transitions.
  ```

Actual stylesheet-dependent placement, painted light/dark behavior, author CSS transitions, accessibility-tree behavior and DOM teardown were reviewed statically. Browser execution was blocked by Playwright’s temporary-directory `EROFS` failure. No files were changed or build outputs written.
