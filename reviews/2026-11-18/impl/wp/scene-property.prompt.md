# Work package: a scene property test fails

Read `AGENTS.md`. You own `packages/axylo/src/scene/**`, `src/view/**`, `src/data/**`, `src/reader/**` and their tests. Nothing else; do not commit. Other agents are editing `apps/docs`, `bench` and the palette files.

`packages/axylo/test/scene/scene.test.ts`, "keeps generated geometry finite and clipped across independent chart states", fails on the current tree (and on commit 2727a30):

```
Error: Property failed after 1 tests
{ seed: 536, path: "0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:1:1:1", endOnFailure: true }
Counterexample: [{"kind":"line","rows":[[null,null],…8 rows of nulls…],"width":1,"height":1,"dpr":1,"stacked":false,"horizontal":false,"compact":true,"dense":false,"long":false,"category":false,…
Caused by: AssertionError: expected 0 to be less than or equal to -2
```

It passed at commit ed230af. The commits since that touched your modules are 93311fa (donut minimum arc; scatter tie) and 11fe315 (compact charts ignore `reference` and tick formats), both yours. Find which one introduced it (`git stash` is not available to you; compare by reading the diffs with `git show`, or copy the old file versions into a scratch directory under `packages/axylo/test/scene/.scratch/` and delete it when done), state the cause, and fix the library or, only if the property's own expectation is wrong for a case the spec defines otherwise (for example it assumes a reference always widens a compact chart's domain, which the spec no longer says: `docs/02-product-spec.md` F7 and section 3.7), correct the property with a comment citing the spec sentence. Do not narrow the generator to avoid the counterexample. A compact chart of all nulls in a 1 × 1 px plot must produce finite, clipped geometry and no exception.

Run `timeout 300 npx vitest run packages/axylo/test/scene packages/axylo/test/view packages/axylo/test/acceptance`. Report the cause, the fix, and the last lines of the run.
