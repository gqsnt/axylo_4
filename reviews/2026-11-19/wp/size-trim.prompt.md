# Size: bring "everything" back under its 116 KiB target

You are working in /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library). Read `AGENTS.md`. You cannot commit; the coordinator commits. No network. Do not run `npm run build` (it rewrites the shared `packages/axylo/dist`); build privately into a directory inside the project you create and remove (see `scripts/build.mjs`: it exports `PRODUCTION`, `stylesheetPlugin()`; `scripts/size.mjs` shows how the packed consumer bundles are measured: esbuild minify, gzip level 9, the "everything" entry is `export * from 'axylo'`).

## Where it stands

Spec DX7 (`docs/02-product-spec.md`): 116 KiB gzipped for everything (118,784 bytes), 98 KiB for line only. Measured on the packed files at commit 4295681: everything 118,902 bytes (118 bytes over), line only 99,504 (97.17 KiB, under). The overage came with the last commit, which made the plot's keyboard instructions follow the chart (`git show 4295681 -- packages/axylo/src`): three new message defaults and `plotDescription()` in `packages/axylo/src/dom/interaction.ts`, including a "legacy override" branch.

## What to do

Recover at least 400 bytes gzipped on "everything" (margin for the next change), without changing any behaviour a test checks and without editing any test:
1. First look at what the last commit added: is the legacy-override logic in `plotDescription()` more than the rule needs ("an existing `plotInstructions` override stays whole": the smallest code that keeps that)? Is the new default text longer than it needs to be (the `zoomInstructions` default also describes Shift with arrows to pan, which the brief did not ask for; keep it only if the spec's I3 requires the description to mention panning, and say what you decided)?
2. Then behaviour-neutral cuts from `reviews/2026-11-18/impl/wp/size2.analysis.md` that are not yet done (read it and `reviews/2026-11-18/impl/wp/size-cuts-a.report.md`, `size-cuts-dom.report.md` for what is done). Property mangling is not to be done.
3. Measure before and after with the release settings, "everything" and "line only", and report the numbers.

Run `npm run typecheck`, the whole Node suite (`npx vitest run`), and say which browser suites the coordinator must run (you cannot launch Chrome). Report (final message): each cut and its measured saving, the totals, the last lines of each run.
