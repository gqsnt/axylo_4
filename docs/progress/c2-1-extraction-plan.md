# Cycle C2.1 — State Ownership, Micro-Measurement & Extraction Blueprint

**Base Commit:** `1867673` (`C1` sealed) → Branch `feat/c2-hub-consolidation` (`2026-11-26`)
**Council Inputs:** Anthropic `opus-5.5-high` (`ts_state_writer`), Google `neon-4-high` (`bundle_cutter` with in-memory esbuild gzip-9 measurements), OpenAI `sol-6.2-medium` (`perf_investigator_deep` critique).

## 1. Hub Baselines Entering C2

- `packages/axylo/src/dom/interaction.ts`: **1,769 LOC** (90 `#private` fields, 118 `#private` methods; `38,360 B` min in `line`, `40,593 B` min in `everything`)
- `packages/axylo/src/core/controller.ts`: **3,211 LOC** (58 `#private` fields, 70 `#private` methods; `49,001 B` min in `line`, `49,017 B` min in `everything`)
- Packed tarball baselines (`bench/size-latest.json`): `line only` **134,868 B** gz9 (`131.71 KiB`), `everything` **157,656 B** gz9 (`153.96 KiB`)
- **C2 Cumulative Budget:** `≤ +307 B` gz9 per capped row (`≤ 135,175 B` / `≤ 157,963 B`), target `≤ 0 B`.

## 2. Empirical Micro-Measurements (Read-Only In-Memory `esbuild`, `PRODUCTION`, gzip-9)

| Experiment | `line` min Δ | `line` gz9 Δ | `everything` min Δ | `everything` gz9 Δ | Finding |
|---|---:|---:|---:|---:|---|
| Promote 15 hot `#private` fields to public `_...` | `+2,863 B` | **`+398 B`** | `+2,863 B` | **`+406 B`** | Rejected — blows the entire C2 budget. All `#private` state remains class-owned. |
| Extract `swatch` + `bar-swatch` + `slice-list` (shared `showsSlices`) | `-24 B` | **`-17 B`** | `+43 B` | `+100 B` | Approved — eliminates all 6 `kinds/* → dom/interaction.ts` edges; isolates `scene/bars.ts` & `dom/slice-list.ts`. |
| Extract `core/frame-state.ts` imported **FIRST** in `controller.ts` | `+3 B` | **`+184 B`** | `+3 B` | **`+196 B`** | LZ77 32 KiB window penalty from moving field names away from `ChartController`. |
| Extract `core/frame-state.ts` imported **LAST** in `controller.ts` | `+3 B` | **`+11 B`** | `+3 B` | **`+31 B`** | **−173 B / −165 B gz9 recovery** solely from placing extracted sibling imports last. |

## 3. Ratified Disjoint Wave Split

- **Wave C2.2 (`dom/` + `kinds/` + `core/composition.ts` line 15 type import):**
  - New: `dom/interaction-types.ts`, `dom/bar-swatch.ts`, `dom/slice-list.ts`, `dom/interaction-controls.ts`, `dom/table-jump.ts`, `dom/interaction-a11y.ts`, `dom/interaction-nav.ts`.
  - Edit: `dom/interaction.ts` (`1,769 → ~1,220 LOC`), `dom/swatch.ts`, `kinds/{line,area,bar,histogram,scatter,donut}.ts` (zero edges to `dom/interaction.ts`), `core/composition.ts` (type import only), 2 DOM test imports, `tests/dist/tree-shaking.test.ts` (`OWNED`).
- **Wave C2.3 (`core/controller.ts` + new `core/` modules):**
  - New: `core/controller-types.ts`, `core/frame-state.ts`, `core/controller-wrappers.ts`, `core/controller-stream.ts` (lazy `StreamSession` + `StreamFactory` seam for C3.1 `axylo/static` with 0 B root tax), `core/controller-helpers.ts`.
  - Edit: `core/controller.ts` (`3,211 → ~1,970 LOC`).
- **Mandatory Rules:** Zero `#private → public` promotions, extracted sibling imports placed **last** for LZ77 locality, zero top-level side effects under `ignoreAnnotations: true` (`import 'axylo'` = `0 B`), zero circular dependencies, and zero edits to `contracts.ts` or `public.ts`.
