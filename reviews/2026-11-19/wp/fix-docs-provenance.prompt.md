# Fix: the docs conformance page refuses recorded results that the command-line checker accepts

You are working in /home/canarit/projects/axylo (Axylo, a TypeScript browser charting library). Read `AGENTS.md`, `acceptance/README.md` and `apps/docs/lib/conformance.mjs` first. You may edit only `apps/docs/**`. If the fix needs a change in `acceptance/provenance.mjs` or `acceptance/check.mjs`, do not make it: describe the exact change in your report. Other agents work in this checkout (one is editing `acceptance/titles.mjs` and `acceptance/check.mjs` right now). You cannot commit (`.git` is read-only for you); the coordinator commits. Do not install anything; the network is off. Do not run `npm run build` (it rewrites `packages/axylo/dist`, which is shared).

## The defect

Six results were recorded with provenance at commit 1e38333 (`acceptance/results/{unit,browser,browser-firefox,browser-webkit,dist,dist-browser}.json`, each with a `*.provenance.json` sidecar). From the same tree, `node acceptance/check.mjs --release --results <those six files>` accepts them all (94 cells pass). But `node apps/docs/build.mjs` built the conformance page (`apps/docs/dist/conformance.html`) with all six listed as "No: provenance does not match the working tree" and every verdict "not recorded for this revision". The tree has since gained one commit that changes only `STATUS.md`; that alone makes both readings "does not match" now, so to reproduce, first compare what the command-line checker and the docs reader say for the same files at the same moment.

Hypothesis (not confirmed): the docs build changes what the provenance fingerprint covers before `apps/docs/lib/conformance.mjs` calls `check()` (it packs and installs the library into `apps/docs/.cache`, writes `apps/docs/dist`), or it passes the checker a different root or a different set of files. Find out.

## What to do

1. Reproduce with a test in `apps/docs/test/` that builds a tiny result set with a sidecar for the current tree (the way `acceptance/test/check.test.mjs` builds fixtures; read it), then runs the docs reader the way the build does, and expects the reader to count it exactly as `check()` does when called directly. It must fail today for the reason you found.
2. Fix it in `apps/docs/**` (the least change: for example read the checker before the build touches anything, or exclude the build's own outputs from what the fingerprint covers if that is where the difference comes from, which would be a change to describe for `acceptance/provenance.mjs`). The reader's guard must stay as strict as it is: a result whose provenance really does not match must still read "not recorded".
3. Run `npx vitest run --config apps/docs/vitest.config.ts` (Node only; the browser configuration needs the shared build) and report the last lines.

## Report (your final message)

The cause (file and line), the change, the test, any change needed outside `apps/docs` (exact), and the last lines of the run. Keep what you ran and saw apart from what you expect.
