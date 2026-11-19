<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Checked by the coordinator: full rehearsal suite run with Chrome. Saved by the coordinator. -->

The rehearsal audit now allows existing and missing paths anywhere inside an attempt’s own run directory. Paths into the repository, real home, and other attempts still void the attempt, including through symlinks. Reading either runner-created login link voids the attempt with a distinct “read the linked login” finding. No public contract changes were needed.

The full saved Claude transcript now audits with **no findings**. I added the recorded Bash call as a regression fixture and tested the forbidden paths and both login links.

I restored the saved answer with the matching packed package and ran `grade.mjs` as documented. It exited **2** because the execution sandbox blocked a Chrome startup socket operation. The browser grade remains unverified. The staged docs were the only hash mismatch, and the saved answer imports only Axylo.

`npx --no-install vitest run --root rehearsal --exclude '**/*.browser.test.mjs'`

```text
 Test Files  2 passed (2)
      Tests  64 passed (64)
   Start at  09:18:30
   Duration  2.71s (tests 88%, import 11%, transform 1%)
```