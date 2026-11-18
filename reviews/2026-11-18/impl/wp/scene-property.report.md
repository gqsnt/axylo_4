<!-- Author: Codex gpt-6.2-sol, effort xhigh (observed in the session rollout, thread 01a1edfc-485f-79c1-b773-76baf3c87d44). -->

Commit `11fe315` exposed a stale test expectation. F7 says references have no effect on compact charts. The property still expected the x-reference band to extend the domain to −2, so it failed when the domain correctly started at 0. [Product spec F7](/home/canarit/projects/axylo/docs/02-product-spec.md:100)

I updated the property to compare compact domains with and without references, using the original generator and geometry checks. A fixed regression test confirms that the all-null compact line builds without throwing and returns an empty scene with the 1 × 1 px clip. The fix is test-only. [scene.test.ts](/home/canarit/projects/axylo/packages/axylo/test/scene/scene.test.ts:159)

`npm run typecheck` passed. Browser rendering was outside this run. The requested Vitest command ended with:

```text
 Test Files  21 passed (21)
      Tests  600 passed (600)
   Start at  10:29:32
   Duration  18.55s (tests 85%, transform 10%, import 5%)
```