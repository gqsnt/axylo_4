<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Checked by the coordinator: checker tests and docs unit tests rerun. Correction by the coordinator: the A3 cells already carry the owner's waiver (granted 2026-11-18, kept in every matrix revision since) and the checker honours it (check.mjs line 523); they block today only because their cited results are stale. Only DX9 needs a new owner decision. Saved by the coordinator. -->

Implemented the owner’s 2026-11-19 “Documented gaps” gate. Release mode accepts a weak cell only when it names the gap and every cited result passes for the current revision. Pending measurements block release, and owner waivers still apply to eligible `not run` and `cannot be verified here` cells. Ordinary mode keeps its existing verdicts. No contract changes or waivers were added. [Checker](/home/canarit/projects/axylo/acceptance/check.mjs) · [Acceptance README](/home/canarit/projects/axylo/acceptance/README.md#release-gate-and-statuses) · [M8 release plan](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:361)

DX12 now cites the accepted `1e93128` rehearsal documents as evidence of the recorded run. Its gaps require repeating the rehearsal on the release commit and describe the limits of the four line and bar tasks. The regenerated report lists all six DX12 cells and `I6/compact` under “Released with documented gaps.” The docs conformance table displays the verdict and gap text for WCAG-linked rows. DX12 has no WCAG mapping, so its new verdict appears in the acceptance report. [Matrix](/home/canarit/projects/axylo/acceptance/matrix.json:14088) · [Acceptance report](/home/canarit/projects/axylo/acceptance/report.md#released-with-documented-gaps) · [Docs conformance](/home/canarit/projects/axylo/apps/docs/lib/conformance.mjs)

## Release blockers

The release check exited **1**, with **306 blocking cells**. All six result files from `1e38333` had stale provenance. A diagnostic read of temporary copies without sidecars found no additional failures or missing cited results.

| Reason | Cells |
|---|---|
| Pending measurement · 26 | `DX5`, `P3`, `P7` for all six chart types. `P1`, `P2`, `P5` for line. `P4` for line, area, bar, scatter. `P8` for compact. `DX5` shares P7’s heap-trend measurement. |
| Cannot be verified here · 11 | `A3` for line, area, bar, scatter, donut needs an owner’s waiver because screen-reader speech and swipe reachability were outside the 1.0 rehearsal. `DX9` for all six needs a waiver because there is no prior release or release history to verify the upgrade and stability policy against. |
| Weak without a gap · 0 | None. |
| Other · 269 | Stale cited results, listed below. |

| Chart types | Criteria blocked by stale results |
|---|---|
| All six | `F2`, `F3`, `F6`, `A1`, `A5`, `L2`, `L7`, `L4`, `A6`, `I4`, `A7`, `I5`, `A8`, `A10`, `A9`, `DX1`, `DX2`, `DX3`, `DX4`, `DX6`, `DX7`, `DX8`, `DX10`, `DX11` |
| Line, area, bar, scatter, donut | `L1`, `F12`, `A2`, `A4`, `L8`, `L3`, `I1`, `I6`, `L6` |
| Line, area, bar, scatter, compact | `F4`, `F11`, `F7`, `F9` |
| Line, area, bar, scatter | `I2`, `I3` |
| Area, bar, compact | `F1`, `F10` |
| Line, area, compact | `F5` |
| Line, area | `L5` |
| Compact | `C4`, `C1`, `C2`, `C3`, `C5` |
| Donut | `F8` |
| Each of line, area, bar, scatter, donut | `T-dense-<type>`, `T-keyboard-<type>`, `T-pointer-<type>`, `T-tooltip-<type>`, `T-zoom-<type>`, `T-limit-<type>`, `T-reference-<type>` |

## Verification

`node --test acceptance/test/*.test.mjs` passed both files. A second run with `--test-isolation=none` confirmed all 44 individual tests. `npx vitest run --config apps/docs/vitest.config.ts` passed all 245 Node tests. `git diff --check` passed. No build, browser suite, benchmark, or release-commit rehearsal ran.

```text
ℹ pass 44
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 451.92787
```

```text
 Test Files  5 passed (5)
      Tests  245 passed (245)
   Start at  10:29:08
   Duration  908ms (tests 43%, import 28%, transform 26%, worker 2%)
```

```text
- pass · 6
- fail · 0
- weak · 170
- no evidence · 0
- not run · 26
- not recorded for this revision · 106
- cannot be verified here · 11
- not applicable · 257
```