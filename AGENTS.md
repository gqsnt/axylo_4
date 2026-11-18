# Working in this repository

Axylo is a browser charting library. The product is specified in `docs/02-product-spec.md`; the build plan is `docs/03-plan-typescript-release.md`. Read the sections your task names before writing code.

## Rules for every change

- **Contracts are fixed.** `packages/axylo/src/core/contracts.ts` and `packages/axylo/src/public.ts` are the interfaces between modules. Do not edit them. If your work needs a change there, stop that part, finish what you can, and describe the exact change you need in your report.
- **Stay in your files.** Each task lists the directories it owns. Do not create, edit or delete anything else, including configuration and other modules. Several agents work in this checkout at the same time.
- **No runtime dependencies.** Use the platform (`Intl`, typed arrays). Dev dependencies already installed: TypeScript, Vitest, fast-check, esbuild, Playwright (system Chrome), axe-core. The network is not available; do not try to install anything.
- **No DOM at import time.** A module that needs the DOM takes it as a parameter or touches it inside a function. Pure stages (data, scales, formatting, layout, scene) must run in Node.
- **Hot paths use typed arrays.** No object per data point, no array of arrays per data point, no copying of large columns that the contracts say are borrowed.
- **Never guess silently.** Anything that cannot be drawn as given is reported through the `DiagnosticSink` with the code from spec section 3.5.
- **Tests come from the spec.** Expected values are derived from the specification and the fixture data, never by running the implementation and pasting its output. Use fast-check property tests for invariants ("for any data …"). A test you cannot make pass is reported as failing; do not weaken it or change its expected value.
- **TypeScript strict, no `any`** in exported signatures. `__DEV__` is a build-time boolean (true in tests).
- **Comments say why**, not what. Names are plain words.
- **Do not commit.** The coordinator commits.

## Commands

```bash
npm run typecheck      # tsc over the library, its tests, and the API examples in docs/api
npm test               # unit and property tests (Node)
npm run build          # packages/axylo/dist
npm run test:browser   # browser tests against the built bundle, in system Chrome
```

## Your report

End with a short report: what you built (files), what you verified and how (paste the last lines of the test run), what is not done or not verified, any contract change you need, and any place where the spec was ambiguous and what you assumed. Keep "ran and saw" apart from "expect".
