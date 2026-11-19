<!-- Author: Codex, requested gpt-6.2-sol xhigh; observed gpt-6.2-sol, effort xhigh. workspace-write. Reviewed and verified by the coordinator on a fresh build: browser SVG 1010 passed, canvas 319, tests/dist 90 + 26, docs browser 172; sizes 115.48 / 96.32 KiB on the packed files. Saved by the coordinator. -->

**Everything is 118,252 B gzipped (115.48 KiB)**, down 650 B and 532 B under the DX7 target. Line only is **98,627 B (96.32 KiB)**, down 877 B and 1,725 B under its target.

| Cut, measured in order | Everything | Line only |
|---|---:|---:|
| Centralized the legacy keyboard-instruction fallback in `dom/interaction.ts` | −5 B | +3 B |
| Shared the chart-type message map across `messages/index.ts`, `core/controller.ts`, `reader/index.ts`, and `dom/interaction.ts` | −51 B | −28 B |
| Gated test counters in `lookup/{point-order,scatter,scatter-grid}.ts` to development and benchmark builds | −21 B | −7 B |
| Moved validation imports ahead of chart construction in `index.ts` | −573 B | −845 B |
| **Before → after** | **118,902 → 118,252 B** | **99,504 → 98,627 B** |

Legacy `plotInstructions` overrides stay whole, and explicitly supplied new instructions still apply. I3 requires Shift+arrow panning to work. The Node and browser tests also assert the full instruction text, so I kept the panning sentence. The import-order savings depend on the bundle contents and may move with future edits.

The private release build reproduced both baselines using esbuild minification and gzip level 9. It passed the Node import and tree-shaking checks. I removed the scratch directory. Tests and contracts were untouched, and no contract change is needed.

`npm run typecheck` exited 0. Its last line was:

```text
> tsc -p packages/axylo --noEmit && tsc -p docs/api && tsc -p tests/dist
```

`npx vitest run` exited 0:

```text
 Test Files  77 passed (77)
      Tests  1854 passed (1854)
   Start at  08:52:31
   Duration  20.39s (tests 81%, transform 12%, import 7%)
```

Browser verification is pending. With freshly built bundles, the coordinator should run `npm run test:browser` for plot descriptions, keyboard interaction, scatter picking, and accessibility, and `npm run test:dist:browser` for packed text and build flavours.