# Distribution tests

What a user installs, tested from the packed tarballs rather than the source tree (plan M7; spec DX1, DX7,
DX8, DX10, DX11).

## Running

```bash
npm run build                                              # packages/*/dist
npx vitest run --config tests/dist/vitest.config.ts        # Node tests
AXYLO_BROWSER=1 npx vitest run --config tests/dist/vitest.config.ts   # browser tests, system Chrome
node scripts/size.mjs            # sizes table, bench/size-latest.json; add --check to fail on a target
```

The config's global setup runs `scripts/pack.mjs --no-build` first: `npm pack` for `packages/axylo` and
`packages/react` into `.packed/`, then each tarball unpacked into the fixtures' `node_modules`. Set
`AXYLO_DIST_BUILD=1` to run the root build first; `node scripts/pack.mjs` alone builds by default. No
registry and no network are used. `react`, `react-dom` and their types are linked into the React fixture
from the root `node_modules`; `axylo` and `@axylo/react` are never linked, so a fixture reaches them only
through the packed files and their `exports`.

Generated, git-ignored: `.packed/`, `.out/`, `fixtures/*/node_modules/`, `fixtures/*/example/` (copies of
`examples/first-chart`), `fixtures/*/.out/`.

## What each file proves

| File | Proves |
|---|---|
| `isolation.test.ts` | The fixtures' packages are unpacked directories, not links; Node (with and without `--conditions=development`) and esbuild resolve `axylo`, `axylo/axylo.css` and `@axylo/react`, including the adapter's own import of `axylo`, to files under the fixture, never under `packages/`. |
| `package-contents.test.ts` | Every path in `exports` (each condition), `types`/`main`/`module` and `files` is in the tarball; the tarball holds nothing beyond those entries, the declarations their `types` import, the two script-tag files, `package.json`, `README.md` and `LICENSE`; no source, tests, source maps or build state; declarations import only peer dependencies. |
| `types.test.ts` | `tsc` (strict, `skipLibCheck: false`) type-checks a consumer of every export and the first-chart snippet in each fixture, with `@ts-expect-error` mistakes from DX3 failing as they should, and the compiler read the declarations from the fixture only. |
| `conditions.test.ts` | The `development` condition and the default are different files, in Node and esbuild; neither refers to `__DEV__`; text that only `if (__DEV__)` code contributes (found from the source, see the file's comment) is in the development file and absent from the production file. |
| `side-effects.test.ts` | Importing either package and using nothing bundles to 0 bytes; `sideEffects` marks only the stylesheet, and `import 'axylo/axylo.css'` survives bundling. |
| `node.test.ts` | DX8 in plain Node: importing `axylo` (both conditions) needs no DOM globals and adds none; `validate()` reports the Phase 1 `dirty` fixture as spec 3.5 says; `@axylo/react` server-renders each component to its empty container. |
| `licence.test.ts` | DX11: MIT in both `package.json` files and shipped `LICENSE` files; no runtime dependencies; shipped JavaScript imports only `react` and `axylo` (adapter) or nothing (core); bundling each package's source as the release build does reads only its own `src`; no copied licence headers in source or shipped files; `THIRD-PARTY-NOTICES.md` covers both packages. |
| `snippets.test.ts` | DX1, static: each `examples/first-chart` file is at most ten non-blank lines, passes only data, fields and the title, and is copied verbatim into its fixture and its package README. |
| `first-chart.browser.test.ts` | DX1 in Chrome: the npm snippet (bundled with esbuild, production and development conditions), the script-tag snippet (CDN URLs answered from the packed files) and the React snippet (StrictMode, and hydration of server markup) each draw a named figure with series marks, with no console error or warning; without the title the chart still draws and raises only AX140; importing the package leaves the document untouched; the AX104 hint prints in the development flavour only. |
| `csp.browser.test.ts` | DX8 in Chrome: pages served with a real `Content-Security-Policy` header (the policy is in the file) draw all five types and the compact variant, open tooltips and tables, from the script-tag files and from bundled modules, with the stylesheet adopted at run time and linked by the page: no violation event, no report, no console error, no element created from markup-like labels and formatter output, and a missing target throws naming its selector. A negative control shows the instruments catch an HTML insertion. |
| `scripts/size.mjs` | DX7: minified and gzipped bytes of consumer bundles built from the fixtures, against the provisional targets, with a per-module breakdown. |

## What they cannot show

- Other browsers: only system Chrome runs here. Firefox and Safari (spec: real Safari is checked by hand at M8) are not covered.
- A real registry install: the tarballs are unpacked by `scripts/pack.mjs`, not installed by `npm install`, so lifecycle scripts, dependency resolution and `npm publish` itself are not exercised. Version `0.0.0` is never published.
- Other bundlers: only esbuild builds the consumer bundles. webpack and Rollup are not installed; Vite and rolldown are present only as Vitest's own dependencies and are not used as consumer bundlers here. The `sideEffects` declaration for the stylesheet follows webpack's documented rule for CSS imports, which esbuild does not enforce, so its effect in webpack is not tested.
- DX10 beyond the first chart: the other documentation examples are not rendered from the packed files by these tests.
- Windows and macOS: `scripts/pack.mjs` uses junctions on Windows and runs `npm.cmd` through the shell; neither has been run there.
