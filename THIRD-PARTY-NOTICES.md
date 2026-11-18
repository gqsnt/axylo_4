# Third-party notices

The published packages `axylo` and `@axylo/react` contain no third-party code. Every file they ship is
built from this repository's own source (`packages/axylo/src`, `packages/react/src`) or is the package's own
metadata, released under the MIT license in each package's `LICENSE` file.

| Package | Runtime dependencies | Peer dependencies (installed by the application, not shipped) | Third-party code in the published files |
|---|---|---|---|
| `axylo` | none | none | none |
| `@axylo/react` | none | `axylo`, `react` | none |

## Release inventory

Every file of each published tarball, where it comes from and under which license. `tests/dist/licence.test.ts`
compares this table with the packed tarballs and fails on any file that is missing here or listed here but
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
| `axylo` | `dist/axylo.css` | generated from `packages/axylo/src/theme/css.ts` | MIT |
| `axylo` | `dist/index.d.ts` | emitted from `packages/axylo/src/index.ts` | MIT |
| `axylo` | `dist/public.d.ts` | emitted from `packages/axylo/src/public.ts` | MIT |
| `@axylo/react` | `package.json` | package metadata | MIT |
| `@axylo/react` | `README.md` | package metadata | MIT |
| `@axylo/react` | `LICENSE` | package metadata | MIT |
| `@axylo/react` | `dist/index.js` | built from `packages/react/src` | MIT |
| `@axylo/react` | `dist/index.dev.js` | built from `packages/react/src` | MIT |
| `@axylo/react` | `dist/index.d.ts` | emitted from `packages/react/src/index.ts` | MIT |

How the origins are checked, by `tests/dist/licence.test.ts` on the packed tarballs:

- neither `package.json` declares `dependencies`, `optionalDependencies` or `bundleDependencies`;
- the shipped JavaScript imports nothing, except `react` and `axylo` from the React adapter;
- "built from": bundling the package's entry with the release build's settings reads only files under that
  package's own `src` directory, so no `node_modules` code is compiled into the bundles;
- "generated from": the shipped stylesheet is the string that module exports, byte for byte;
- "emitted from": the declaration's source file exists;
- any licence or copyright header found in a shipped file, or in a source file under `packages/*/src`, must
  be quoted under "Notices" below; none is today.

What these checks cannot see: third-party code copied into `packages/*/src` without any header. Such code
would be listed as this repository's own; keeping it out is a review matter.

The tools that build and test the packages (TypeScript, esbuild, Vitest, Playwright, fast-check, axe-core,
React for the adapter's tests) are development dependencies under their own licenses. None of their code
is in the published files.

## Notices

None.
