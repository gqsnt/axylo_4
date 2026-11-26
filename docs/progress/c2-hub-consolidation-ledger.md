# Campaign C2 — Hub Consolidation & C3 Streaming Seam Ledger

**Branch:** `feat/c2-hub-consolidation` (`2026-11-26`)
**Base:** `1867673` (`C1` sealed)
**Status:** **GRADUATED** — both hubs materially shrunk, zero `kinds/* → dom/interaction.ts` edges, zero runtime or type-only cycles across all C2 modules, combined gzip-9 delta well under `+307 B`, zero contract edits, and both cross-provider reviews returned **`Verdict: Merge`**.

## 1. Hub Shrinkage

| Hub | Before (`C1.2`) | After (`C2.3`) | LOC Delta | Minified JS Delta (`everything`) |
|---|---:|---:|---:|---:|
| `packages/axylo/src/core/controller.ts` | 3,211 LOC | **1,790 LOC** | **−1,421 LOC (−44.3%)** | `49,017 B → 28,418 B` (−42.0%) |
| `packages/axylo/src/dom/interaction.ts` | 1,769 LOC | **1,322 LOC** | **−447 LOC (−25.3%)** | `40,593 B → 29,700 B` (−26.8%) |
| **Combined Hubs** | **4,980 LOC** | **3,112 LOC** | **−1,868 LOC (−37.5%)** | **−31,492 B** |

### Extracted Modules
- **C2.2 (`f0b5617`, `dom/` & `kinds/`):** `dom/interaction-types.ts`, `dom/bar-swatch.ts`, `dom/slice-list.ts`, `dom/interaction-controls.ts`, `dom/table-jump.ts`, `dom/interaction-a11y.ts`, `dom/interaction-nav.ts`; swatch factories (`areaSwatch`, `lineSwatch`, `pointSwatch`) moved to `dom/swatch.ts`; all 6 `kinds/*.ts` decoupled from `dom/interaction.ts`; `dom/bar-swatch.ts` and `dom/slice-list.ts` added to `OWNED` in `tests/dist/tree-shaking.test.ts`; eliminated pre-existing `core/axes → core/composition → dom/interaction → core/axes` type cycle.
- **C2.3 (`d0c3db8` + cycle cleanup, `core/`):** `core/controller-types.ts` (type-only leaf with `StreamSessionHandle`), `core/frame-state.ts`, `core/controller-wrappers.ts`, `core/controller-stream.ts` (`StreamSession` + `StreamFactory` + `openStreamSession`), `core/controller-helpers.ts`; added internal `staticControllerFor` seam with `0 B` `StreamSession` reachability for `C3.1`.

## 2. Packed Tarball Size Delta (`C1.2` `ccb5698` → `C2` Sealed, Cap `≤ +307 B`)

| Entry | `C1.2` gz9 | `C2` gz9 | Delta | Status |
|---|---:|---:|---:|---|
| `line only` | 134,868 B | **134,859 B** | **−9 B** | PASS (smaller!) |
| `everything` | 157,656 B | **157,726 B** | **+70 B** | PASS (`≤ +307 B`) |
| `area only` | 137,587 B | **137,550 B** | **−37 B** | PASS |
| `bar only` | 130,893 B | **130,813 B** | **−80 B** | PASS |
| `histogram only` | 114,240 B | **114,138 B** | **−102 B** | PASS |
| `scatter only` | 122,494 B | **122,421 B** | **−73 B** | PASS |
| `donut only` | 93,947 B | **94,049 B** | **+102 B** | PASS |
| `validate only` | 26,487 B | **26,471 B** | **−16 B** | PASS |
| `bare import (import 'axylo')` | 0 B min | **0 B min** | **0 B** | PASS (`ignoreAnnotations: true`) |

## 3. Verification & Cross-Provider Sign-Off

- **Static DAG & edges:** `C2_CYCLES = 0` (both runtime AND type-only across all C2 modules), `KINDS_TO_INTERACTION = []` (0 edges), `contracts.ts` & `public.ts` untouched.
- **Verification gates:**
  - `npm run typecheck` — PASS
  - `npm run build` + `npm run size` — PASS
  - `node --test acceptance/test/*.test.mjs` — **60/60 PASS** (1 expected skip)
  - `tests/dist/instrumentation.test.ts` (7/7) + `tests/dist/node.test.ts` — PASS
  - `node acceptance/run.mjs unit` — **2,036/2,036 PASS** (0 failed)
  - `node acceptance/run.mjs dist-browser` — **26/26 PASS** (0 failed)
  - Core Chrome suites (`split-seams`, `final-hold`, `interaction`, `histogram`, `render`, `a2-keyboard`, `a4-table`) — **134/134 PASS** (`66.65s`)
- **Cross-provider reviews:**
  - **OpenAI `sol-6.2-medium`** on `C2.2` (`f0b5617`): **`Verdict: Merge`**
  - **Anthropic `opus-5.5-medium`** on `C2.3` (`d0c3db8`): **`Verdict: Merge`** (non-blocking type-only cycle note resolved immediately and verified at `0` cycles).
