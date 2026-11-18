# Third-party notices

The published packages `axylo` and `@axylo/react` contain no third-party code. Every file they ship is
built from this repository's own source (`packages/axylo/src`, `packages/react/src`), released under the
MIT license in each package's `LICENSE` file.

| Package | Runtime dependencies | Peer dependencies (installed by the application, not shipped) | Third-party code in the published files |
|---|---|---|---|
| `axylo` | none | none | none |
| `@axylo/react` | none | `axylo`, `react` | none |

How this is checked, by `tests/dist/licence.test.ts` on the packed tarballs:

- neither `package.json` declares `dependencies`, `optionalDependencies` or `bundleDependencies`;
- the shipped JavaScript imports nothing, except `react` and `axylo` from the React adapter;
- building each package's entry with the release build's settings reads only files under that package's
  own `src` directory, so no `node_modules` code is compiled into the bundles (the build drops comments,
  so a licence header in the output could not show bundled code; the input list can);
- no file under `packages/*/src` carries a licence or copyright header from elsewhere.

The tools that build and test the packages (TypeScript, esbuild, Vitest, Playwright, fast-check, axe-core,
React for the adapter's tests) are development dependencies under their own licenses. None of their code
is in the published files.

If a release ever includes third-party code, its name, version, license and copyright notice go in this
file, and the file is added to the published `files` of the package that ships it.
