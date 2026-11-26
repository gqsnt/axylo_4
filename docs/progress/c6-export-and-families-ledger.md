# Campaign 6 Ledger — Export (`axylo/export`) & Admitted Family (`axylo/finance`)

**Branch:** `feat/c6-export-and-families` (branched from C5-sealed `e1d6d44`)  
**Status:** Sealed & Verified (`C6.1` Export → `C6.3` Council + `axylo/finance` → `C6.4` Hygiene & Cross-Provider Review; `C6.2` React/Vue/Svelte adapters explicitly parked until release per ratified owner decisions)

---

## Architecture Council Decision (`C6.3`)

- **Unanimous Multi-Provider Council (`sol-6.2-medium` OpenAI + `neon-4-medium` Google):**
  - **ADMITTED:** **`axylo/finance`** — OHLC / candlestick + optional synchronized volume panel over Axylo's existing `AlignedFrame` with zero contract edits to `packages/axylo/src/public.ts` or `core/contracts.ts`.
  - **EXPLICITLY DEFERRED:** **`axylo/spatial`** (Cartesian heatmap / bubble) — bubble requires per-point size columns & radii on `PointMark`; heatmap requires 2D matrix frames, sequential/diverging color-bar legends, and 2D keyboard grid stepping. Deferred cleanly to preserve zero-contract-edit hygiene and focus C6.3 on one complete family.

---

## Summary of Delivered Capabilities

1. **Opt-In `axylo/export` (`C6.1`, `packages/axylo/src/export.ts`):**
   - `exportSvg(target, options?)`: selects the plot surface SVG (`.axylo-scene`), resolves all CSS custom properties (`var(--axylo-...)`) into concrete SVG presentation attributes, strips renderer background rects for a single resolved background, keeps mark/label coordinates unified under `viewBox`, preserves parent-rotated `.axylo-text` labels as concrete `<text>` elements, and embeds `<title>`/`<desc>` metadata.
   - `exportPng(target, options?)` & `exportPngDataUrl(target, options?)`: offscreen canvas rasterization at requested DPR scale (verified at 2× `1200×600` in real Chrome).
   - `exportCsv(source, options?)` & `parseCsv(text, delimiter?)`: RFC 4180 CSV serialization & round-trip parser supporting `TableModel`, mounted `<table>` DOM targets (preserving significant whitespace), and `Data<Row>` (Node/SSR safe), quoting lone empty cells and handling trailing CRLF cleanly.
2. **Opt-In `axylo/finance` (`C6.3`, `packages/axylo/src/finance.ts` + `finance/{core,render}.ts`):**
   - `candlestick(target, options)` & DOM-free `validateCandlestick(options)` with transactional `strict` `update()` rollback and `WeakMap`-backed per-frame validation flags surviving presentation updates.
   - `AX180` (invalid OHLC envelope `high < max(open, close)` / `low > min(open, close)`) and `AX181` (negative volume) diagnostics with offending row indexes and clean gap omission (no bridging/clamping) while preserving raw values in the accessible table.
   - Colorblind-safe hollow-up (non-strikethrough upper/lower wicks), filled-down, and horizontal-doji encoding in `O(N)` batched `PathMark`/`RectMark` buffers, dedicated lower 22% volume pane (even with explicit `yAxis.domain`), shared `Formatters` across tooltip/table/keyboard/summary, and binary-searched `pageForX()`.

---

## Verified Size & Regression Ledger (vs Clean C3-Sealed `b097f1a`)

| Entry | `b097f1a` gz9 | C6 Sealed gz9 | Delta vs `b097f1a` | Cap / Guard |
|---|---:|---:|---:|---|
| `line` (`examples/first-chart/npm.ts`) | 135,293 B | **135,241 B** | **−52 B** | `<= +0 B` PASS |
| `everything` (`export * from 'axylo'`) | 158,096 B | **158,084 B** | **−12 B** | `<= +0 B` PASS |
| `axylo/static` `line` | 120,729 B | **120,675 B** | **−54 B** | `<= +0 B` PASS |
| `axylo/static` `everything` | 140,988 B | **140,961 B** | **−27 B** | `<= +0 B` PASS |
| `axylo.iife.min.js` | 158,425 B | **158,372 B** | **−53 B** | `<= +0 B` PASS |
| `axylo/export` standalone | — | **<= 3,500 B** (~3.2 KiB) | — | PASS |
| `axylo/finance` standalone | — | **<= 127,000 B** (~118 KiB) | — | PASS |
| Bare imports (`ignoreAnnotations: true`) | 0 B | **0 B** | **0 B** | `=== 0 B` PASS (all 8 entries) |
