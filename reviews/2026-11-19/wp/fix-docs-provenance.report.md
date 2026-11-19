<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh (session rollout turn_context). workspace-write. Reviewed by the coordinator (Claude Opus 5.5 high, cross-provider): change read, docs unit tests rerun (244 pass). Saved by the coordinator. -->

The docs build wrote files into `dist.tmp-<pid>` before reading conformance. Git’s `dist/` ignore rule missed that directory, so the build’s own files changed the fingerprint computed by [acceptance/provenance.mjs](/home/canarit/projects/axylo/acceptance/provenance.mjs:75). [The docs build](/home/canarit/projects/axylo/apps/docs/lib/site.mjs:106) now stages the site inside an ignored `dist/` directory on the output filesystem. No changes are needed outside `apps/docs`.

On the current checkout, both readers marked all six archived runs stale. The [regression test](/home/canarit/projects/axylo/apps/docs/test/conformance.test.ts:121) reproduced the original mismatch with a fresh Git fixture. Before the fix, `check()` accepted the result and the docs reader rejected it during staging. After the fix, both counted it, and a subsequent source edit still made the docs verdict `not recorded for this revision`.

Ran `npx vitest run --config apps/docs/vitest.config.ts`. The full site build and browser suite were not run.

```text
 Test Files  5 passed (5)
      Tests  244 passed (244)
   Start at  08:02:17
   Duration  1.29s (transform 57%, tests 26%, import 16%, worker 1%)
```