# Draft the release notes for Axylo's first release

You are the writer and analyst. Read-only: edit nothing; your final message is the deliverable, a Markdown file the coordinator will save as `CHANGELOG.md` at the repository root after checking it. Repository: /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library). Read `AGENTS.md`, `README.md` if present, `docs/02-product-spec.md`, `apps/docs/pages/getting-started.md`, `apps/docs/pages/stability.md` (including "Known limits"), `apps/docs/pages/conformance.md`, `packages/axylo/package.json`, `packages/axylo/src/public.ts` (the public API), and `git log --oneline` for what was built.

Write release notes for a reader who is deciding whether to use the library:

- A heading `## [Unreleased]` (the owner has not chosen the version number yet; the package is `0.0.0`; write "first release" in the text and leave the number to the owner).
- **What it is**, in two or three sentences, from the spec's own framing (not marketing).
- **What is in it**: the chart kinds and the compact variant; data forms; the three kinds of time; updates, streaming with pause, zoom (where it applies); diagnostics (how many codes; error, warning, hint); the reader's surfaces (name, summary, table, keyboard, tooltip and readout modes); theming and the page's colour scheme; the two mark renderers (SVG by default; canvas is an internal switch, not public: check `public.ts` and say only what is public); packaging (npm ESM with types, a script-tag build, CSS, no runtime dependencies, sizes against the targets as measured in `bench/size-latest.json`).
- **Evidence**, each as the docs state it, with its limits: the acceptance checker and matrix (say what is recorded and what is not: the release check does not pass yet, many criteria have documented gaps; do not give numbers you cannot read from `acceptance/report.md` or `STATUS.md`); browsers (Chrome; Firefox and WebKit through Playwright, WebKit is not Safari; nothing on Windows or macOS); the agent rehearsal (the record on `stability.md`); no screen-reader rehearsal (the owner's decision); performance budgets not yet measured (state it as pending, do not guess).
- **Known limits**: link to the stability page's list rather than copying it; name the three a user is most likely to meet.
- **Not in this release**: framework adapters (React, Vue, Svelte are planned later), category-axis zoom, streaming as an opt-in import (the size plan), anything the spec defers.

Plain, short, factual; every claim checkable against a file. Keep "measured" apart from "planned". No emoji.
