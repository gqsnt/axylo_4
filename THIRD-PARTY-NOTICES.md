# Third-party notices

The published package `axylo` contains no third-party code. Every file it ships is built from this
repository's own source (`packages/axylo/src`) or is the package's own metadata, released under the MIT
license in the package's `LICENSE` file.

| Package | Runtime dependencies | Peer dependencies | Third-party code in the published files |
|---|---|---|---|
| `axylo` | none | none | none |

## Release inventory

Every file of the published tarball, where it comes from and under which license. `tests/dist/licence.test.ts`
compares this table with the packed tarball and fails on any file that is missing here or listed here but
not shipped. A third-party file would be listed with its origin as `third-party: <name> <version>`, its
license, and its notice under "Notices" below.

| Package | File | Origin | License |
|---|---|---|---|
| `axylo` | `package.json` | package metadata | MIT |
| `axylo` | `README.md` | package metadata | MIT |
| `axylo` | `LICENSE` | package metadata | MIT |
| `axylo` | `dist/axylo.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/axylo.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/axylo.iife.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/axylo.iife.min.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/axylo.css` | generated from `packages/axylo/src/theme/css.ts` through `packages/axylo/src/theme/minify.ts` | MIT |
| `axylo` | `dist/index.d.ts` | emitted from `packages/axylo/src/index.ts` | MIT |
| `axylo` | `dist/public.d.ts` | emitted from `packages/axylo/src/public.ts` | MIT |
| `axylo` | `dist/static.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/static.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/static.d.ts` | emitted from `packages/axylo/src/static.ts` | MIT |
| `axylo` | `dist/stream.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/stream.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/stream.d.ts` | emitted from `packages/axylo/src/stream.ts` | MIT |
| `axylo` | `dist/cartesian.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/cartesian.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/cartesian.d.ts` | emitted from `packages/axylo/src/cartesian.ts` | MIT |
| `axylo` | `dist/stats.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/stats.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/stats.d.ts` | emitted from `packages/axylo/src/stats.ts` | MIT |
| `axylo` | `dist/sync.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/sync.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/sync.d.ts` | emitted from `packages/axylo/src/sync.ts` | MIT |
| `axylo` | `dist/export.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/export.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/export.d.ts` | emitted from `packages/axylo/src/export.ts` | MIT |
| `axylo` | `dist/finance.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/finance.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/finance.d.ts` | emitted from `packages/axylo/src/finance.ts` | MIT |
| `axylo` | `dist/spatial.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/spatial.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/spatial.d.ts` | emitted from `packages/axylo/src/spatial.ts` | MIT |
| `axylo` | `dist/hierarchy.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/hierarchy.dev.js` | built from `packages/axylo/src` | MIT |
| `axylo` | `dist/hierarchy.d.ts` | emitted from `packages/axylo/src/hierarchy.ts` | MIT |

How the origins are checked, by `tests/dist/licence.test.ts` on the packed tarball:

- the `package.json` declares no `dependencies`, `optionalDependencies`, `bundleDependencies` or `peerDependencies`;
- the shipped JavaScript imports nothing;
- "built from": bundling the package's entry with the release build's settings reads only files under the
  package's own `src` directory, so no `node_modules` code is compiled into the bundles;
- "generated from": the shipped stylesheet is the string that module exports, byte for byte;
- "emitted from": the declaration's source file exists;
- any licence or copyright header found in a shipped file, or in a source file under `packages/*/src`, must
  be quoted under "Notices" below; none is today.

What these checks cannot see: third-party code copied into `packages/*/src` without any header. Such code
would be listed as this repository's own; keeping it out is a review matter.

The tools that build and test the package (TypeScript, esbuild, Vitest, Playwright, fast-check, axe-core,
and the consumer bundlers Rollup and webpack with their plugins and loaders) are development dependencies
under their own licenses. None of their code is in the published files.

## Notices

None.
