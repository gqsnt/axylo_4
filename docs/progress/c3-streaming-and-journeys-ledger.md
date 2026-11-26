# Campaign 3 Ledger — Streaming Isolation (`axylo/static`, `axylo/stream`) & Product Journey Polish

**Branch:** `feat/c3-streaming-isolation`  
**Base (`C2` sealed):** `e147b17` (`docs(c2): record Campaign 2 hub consolidation ledger`)  
**Code HEAD:** `70e7430` (`fix(c3.3): preserve donut slice handoff across epoch reconciliation`)  
**Date:** `2026-11-26`  
**Contract boundary:** `git diff e147b17..70e7430 -- packages/axylo/src/core/contracts.ts packages/axylo/src/public.ts` is **empty (0 lines)** — 100% legacy root compatibility preserved.

---

## 1. Cycle Summary & Commits

| Cycle | Commit(s) | Scope | Cross-Provider Sign-Off |
|---|---|---|---|
| **C3.1** | `6ad9937`, `380bbcd` | Added opt-in `axylo/static` (`dist/static.{js,dev.js,d.ts}`) and `axylo/stream` (`dist/stream.{js,dev.js,d.ts}`); split `data/labels.ts` out of `data/store-window.ts`; added `X_STATIC` compositions across all 6 `kinds/*.ts` + `StaticChartController` (`StaticChart<Row, Opts>` omits `append` statically and throws a clear runtime error if called); fixed strict `NodeNext` `.js` declaration extensions and added `NodeNext` (`skipLibCheck: false`) dist checks in `tests/dist/subpaths.test.ts` (9/9). | OpenAI `sol-6.2-medium`: **`Verdict: Merge`** |
| **C3.2** | `4bdbddd` | Sharded responsive/touch (`opus-5.5-high`, `F-RESP-1..7`) and accessibility (`sol-6.2-medium`, `F-A11Y-1..6`) journey audit recorded in `docs/progress/c3-2-journey-audit.md`; closed `histogram-resize-test` and `histogram-theme-test` PERS gaps in `packages/axylo/test/browser/chart/histogram.browser.test.ts` (3/3 Chrome) and `acceptance/journeys.json` (owned gaps **19 → 17**, histogram test-backed **8/11 → 10/11**). | Multi-provider audit (`opus-5.5-high` + `sol-6.2-medium`) |
| **C3.3** | `1656872`, `0b76622`, `de9ecc4`, `70e7430` | Closed prioritized `C3.2` findings: `F-A11Y-1` (blank `title` / empty `labelledBy` fallback + `AX140`), `F-A11Y-2` (all-zero donut slice-list focus & slice identity handoff to slider/table, including simultaneous `legend: false` and epoch changes with tracked pointer), `F-A11Y-3` (all-omitted explicit-bin histogram omits false "See table" referral; compact dirty error retains omission sentence with mixed-language `<span lang="en">` runs on foreign-language pages), `F-A11Y-4` (multipage passive table refresh preserves unchanged `<tr>` & cell DOM identity), `F-RESP-3` (1 s touch tap threshold), `F-RESP-4` (touch re-tap dismisses pinned tooltip while mouse still re-pins), and `F-RESP-6` (`24×16` compact lower-bound zero-Tab-stop / non-capturing pointer regression). | Anthropic `opus-5.5-high` build + OpenAI `sol-6.2-medium` iterative review (`axylo_c3_3_review` → `axylo_c3_3_signoff` → `axylo_c3_3_signoff2`: **`Verdict: Merge`**) |

---

## 2. Packed Download Size (`npm run size`, `esbuild 0.28.2`, gzip level 9)

Measured on sealed `70e7430` (`axylo-0.0.0.tgz`, 16 files, 1,544,338 B):

| Entry | `C2` (`e147b17`) gz9 | `C3.1` (`380bbcd`) gz9 | `C3` Final (`70e7430`) gz9 | Delta vs `C2` | Notes |
|---|---:|---:|---:|---:|---|
| `line only` (`examples/first-chart/npm.ts`) | `134,859 B` | `134,852 B` | **`135,293 B`** | `+434 B` | `C3.1` root tax was **`−7 B` (`0 B` tax)**; `+441 B` is `C3.3` a11y/touch fixes |
| `everything` (`export * from 'axylo'`) | `157,726 B` | `157,718 B` | **`158,096 B`** | `+370 B` | `C3.1` root tax was **`−8 B` (`0 B` tax)**; `+378 B` is `C3.3` a11y/touch fixes |
| `line only` (`axylo/static`) | — | `120,309 B` | **`120,729 B`** | **`−14,564 B` (−10.8% vs root)** | **0 B** from `controller-stream.ts` & `data/store*.ts` |
| `everything` (`axylo/static`) | — | `140,603 B` | **`140,988 B`** | **`−17,108 B` (−10.8% vs root)** | **0 B** from `controller-stream.ts` & `data/store*.ts` |
| `histogram only` | `114,132 B` | `114,125 B` | **`114,588 B`** | `+456 B` | Standalone histogram consumer |
| `donut only` | — | — | **`94,476 B`** | — | Standalone donut consumer |
| `validate only` | `26,473 B` | `26,473 B` | **`26,477 B`** | `+4 B` | Standalone validation consumer |
| `bare import` (`import 'axylo'`, `axylo/static`, `axylo/stream`) | `0 B` raw | `0 B` raw | **`0 B` raw** | `0 B` | Verified under `ignoreAnnotations: true` |

---

## 3. Verification Evidence (`70e7430`)

| Gate | Command | Result |
|---|---|---|
| Typecheck (package + docs/api + dist) | `npm run typecheck` | **PASS** (0 errors) |
| Production build & pack | `npm run build && npm run size` | **PASS** (13 dist artifacts + `axylo-0.0.0.tgz`) |
| Acceptance checker & PERS unit tests | `node --test acceptance/test/*.test.mjs` | **60 / 60 PASS** (1 skipped: missing optional `browser.json`) |
| Dist & Subpath checks (incl. strict `NodeNext`) | `npx vitest run --config tests/dist/vitest.config.ts tests/dist/{subpaths,instrumentation,node,side-effects,package-contents,types}.test.ts` | **44 / 44 PASS** |
| Full Node unit suite | `node acceptance/run.mjs unit` | **2,061 / 2,061 PASS** (0 failed) |
| Packed consumer Chrome browser suite | `node acceptance/run.mjs dist-browser` | **26 / 26 PASS** (0 failed) |
| Targeted real-Chrome a11y/touch suites | `AXYLO_BROWSER=1 npx vitest run packages/axylo/test/browser/chart/c3-journeys.browser.test.ts packages/axylo/test/browser/acceptance/a1-names.browser.test.ts packages/axylo/test/browser/acceptance/compact.browser.test.ts packages/axylo/test/browser/chart/final-verify.browser.test.ts` | **120 / 120 PASS** (incl. `c3-journeys.browser.test.ts` 6/6) |
| Live PERS 12-journey gate | `node acceptance/check.mjs --pers` | **EXIT 0** (0 fail, 0 stale, 17 owned gaps down from 19) |

### Known Non-Blocking / Pre-Existing Items
- Manual assistive-technology screen-reader runs (`NVDA/Chrome`, `VoiceOver/Safari`, Windows native forced-colors, and real phone touch hardware) remain explicitly tracked as owned manual gaps in `acceptance/journeys.json` (protocol documented in `docs/progress/c3-2-journey-audit.md`).
- Pre-existing unrelated repo test quirks unchanged by Campaign 3: `tests/dist/isolation.test.ts:52` (workspace symlinked `node_modules`), `tests/dist/tree-shaking.test.ts:138` (`view/stack.ts` already omitted from `line`/`histogram`), and 2 `apps/docs/test/theme.browser.test.ts` painted-color checks.
