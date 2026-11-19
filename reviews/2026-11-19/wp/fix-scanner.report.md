<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh (session rollout turn_context). workspace-write. Reviewed by the coordinator (Claude Opus 5.5 high, cross-provider): change read, checker tests rerun (42 pass), ancestors confirmed. Saved by the coordinator. -->

Fixed the scanner so `I2 legend toggles` is a top-level suite. The regex check in [acceptance/titles.mjs](/home/canarit/projects/axylo/acceptance/titles.mjs:31) treated the `/` after the TypeScript non-null assertion at [i1-pointer.browser.test.ts:489](/home/canarit/projects/axylo/packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts:489) as the start of a regex. It swallowed two closing parentheses and left the previous suite open. The scanner now distinguishes postfix `!` from prefix negation, including inside template interpolations.

[check.mjs](/home/canarit/projects/axylo/acceptance/check.mjs:476) now names the citation’s file and title or suite prefix when a passing report leaves it unmatched. It also exposes existing pending measurement reasons in `check()` output. Added tests for both diagnostics, a scanner fixture, and a comparison against all 121 pointer assertions. I verified that the comparison skips with a clear message when `browser.json` is absent.

I compared 4,671 recorded assertions across all 76 cited test files. Two files still have ancestor differences from separate scanner limitations. [scale.browser.test.ts](/home/canarit/projects/axylo/packages/axylo/test/browser/chart/scale.browser.test.ts:45) uses decimal loop values, and [tests/dist/node.test.ts](/home/canarit/projects/axylo/tests/dist/node.test.ts:19) uses `%j` suite titles. Another 442 recorded assertions had no static title match to compare.

**Release check.** All six reports had stale provenance before and after, so the strict command exited 1 both times with identical counts.

```text
- pass · 6
- fail · 0
- weak · 164
- no evidence · 0
- not run · 32
- not recorded for this revision · 106
- cannot be verified here · 11
- not applicable · 257
```

A diagnostic run using the same recorded assertions without their sidecars confirmed that all 18 affected cells moved to `pass`. Total `pass` rose from 94 to 112 and `not run` fell from 50 to 32.

**Checker tests.** Ran the requested commands with a temporary Node stdout workaround for the sandbox. The test run ended with:

```text
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```