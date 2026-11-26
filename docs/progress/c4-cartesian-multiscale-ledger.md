# Campaign 4 Ledger — Opt-In Cartesian Multi-Scale & Log-Scale Composition (`axylo/cartesian`)

**Branch:** `feat/c4-cartesian-multiscale` (branched from C3-sealed `b097f1a`)  
**Status:** Sealed & Verified (C4.1 RFC → C4.2 Scale/Layout → C4.3 Composition/Marks/Chrome E2E → C4.4 Consolidation, Hygiene & Cross-Provider Sign-Off)

---

## Summary of Delivered Capabilities

1. **RFC & Architecture (`C4.1`, `09705ce`):**
   - Multi-provider `plan-council` (`neon-4-medium` + `opus-5.5-high`) and iterative OpenAI `sol-6.2-medium` semantic audit (`Verdict: Approve RFC` in `axylo_c4_1_rfc_signoff3`).
   - Documented in `docs/rfcs/c4-1-cartesian-multiscale.md`; zero changes to `packages/axylo/src/public.ts` and strictly type-only 6-hunk additive diff to `packages/axylo/src/core/contracts.ts`.
2. **Overflow-Safe Logarithmic Scale & Per-Axis Layout (`C4.2`, `f9973e9`):**
   - Implemented `packages/axylo/src/scale/log.ts` (`logScale`, `niceLogDomain`, `logTickCandidates`) with construction-time `log1p`/`expm1` branch selection (zero mid-domain discontinuity, overflow-safe up to 600 decades), strict sub-decade snapping, and guaranteed `>= 2` tick candidates.
   - Implemented single projection authority (`packages/axylo/src/cartesian/scale-ref.ts`), per-axis domain calculation (`cartesian/axes.ts`), and dual-axis responsive layout (`cartesian/layout.ts`) enforcing `L9` right-axis collapse when fitted `plot.width < 360 px` with `AX175` presentation diagnostic and automatic clear upon resize back `>= 360 px`.
3. **Opt-In `axylo/cartesian` Entry Point (`C4.3`, `2903398`):**
   - Exported `cartesian()`, `validateCartesian()`, `LinearAxisId`, `WidenAxes`, and strict TypeScript constraints (compile-time & runtime `AX173` rejection of `bar`/`area` on `'log'` axes) via `./cartesian` (`dist/cartesian.{js,dev.js,d.ts}`) with strict `NodeNext` + `Bundler` declarations.
   - Deterministic mixed-layer paint order (`bar` → `area` → `line`), grouped + stacked bars & stacked areas, exact datum/tooltip/keyboard/table parity (preserving raw nonpositive log values in the table with `" (not plotted — log)"` and `AX171`), and strict-CSP packed real-Chrome integration (`tests/dist/cartesian.browser.test.ts`).
4. **Hygiene, Performance & Cross-Provider Review Fixes (`C4.4`, `c9e0616` + polish commit):**
   - Shared `O(N)` zero-allocation bar geometry (`packages/axylo/src/cartesian/bar-geom.ts`) consumed by both `cartesian/scene.ts` and `cartesian/lookup.ts`, with exact-containment priority on stacked bar edges.
   - Transactional rollback on strict `update()` rejection in `packages/axylo/src/cartesian.ts`.
   - Strict finite-number reference identity matching in `cartesian/view.ts`, data-only `AX172` positivity checks in `cartesian/axes.ts`, and live `aria-describedby` summary refresh across `wide → narrow → wide` `L9` transitions via `ReaderParts.stateKey`.

---

## Verified Size & Regression Ledger (vs Clean C3-Sealed `b097f1a`)

| Entry | `b097f1a` gz9 | C4 Sealed gz9 | Delta | Cap / Guard |
|---|---:|---:|---:|---|
| `line` (`examples/first-chart/npm.ts`) | 135,293 B | **135,241 B** | **−52 B** | `<= +0 B` PASS |
| `everything` (`export * from 'axylo'`) | 158,096 B | **158,084 B** | **−12 B** | `<= +0 B` PASS |
| `axylo/static` `line` | 120,729 B | **120,675 B** | **−54 B** | `<= +0 B` PASS |
| `axylo/static` `everything` | 140,988 B | **140,961 B** | **−27 B** | `<= +0 B` PASS |
| `axylo.iife.min.js` | 158,425 B | **158,372 B** | **−53 B** | `<= +0 B` PASS |
| `axylo/cartesian` standalone | — | **121,084 B** | — | `<= 127,000 B` PASS |
| Bare import (`ignoreAnnotations: true`) | 0 B | **0 B** | **0 B** | `=== 0 B` PASS (`axylo`, `/static`, `/stream`, `/cartesian`) |

---

## Verification Matrix

- `npm run typecheck` (`packages/axylo`, `docs/api`, `tests/dist`): **PASS**
- `npm run build && npm run size`: **PASS** (all 5 legacy caps `<= b097f1a`)
- `tests/dist/subpaths.test.ts`: **12/12 PASS** (exact-byte legacy caps, `0 B` bare imports, `Bundler` & `NodeNext` declarations, Node no-DOM import)
- `tests/dist/cartesian.browser.test.ts` (packed real Chrome, strict CSP): **PASS** (`wide → narrow → wide` `AX175` + live summary refresh, nonpositive log table row, `update()`, strict rollback)
- `node acceptance/run.mjs unit`: **2,078/2,078 PASS**
- `node acceptance/run.mjs dist-browser`: **27/27 PASS**
- `node acceptance/check.mjs --pers`: **EXIT 0** (0 regressions, owned gaps unchanged at 17)
- `packages/axylo/src/public.ts`: **0 lines modified**
