# Release acceptance

From the repository root, run the checker tests and record the four Vitest configurations.

```sh
node --test acceptance/test/*.test.mjs
node acceptance/run.mjs unit
node acceptance/run.mjs browser
node acceptance/run.mjs dist
node acceptance/run.mjs dist-browser
node acceptance/check.mjs --release --write --results \
  acceptance/results/unit.json acceptance/results/browser.json \
  acceptance/results/dist.json acceptance/results/dist-browser.json
```

Build the packages before the browser and distribution configurations. Each wrapper run writes Vitest JSON and a neighbouring `*.provenance.json` with the Git commit, dirty flag, tree fingerprint, result hash and hashes of every cited test file. The sidecar records a working-tree change during Vitest and the release checker rejects that run. The generated `acceptance/report.md` does not affect the fingerprint. Supply the result paths to the checker and keep their sidecars beside them. For a filtered run, use `--output` to keep the full configuration’s result intact.

The checker prints provenance, the matrix and the sources of each result. It writes [report.md](report.md) only with `--write`. Without results, it checks citations and shows static coverage and any cited packed size measurements. An omitted result leaves its assertions unverified. By default the checker can display historical reports, including archived absolute paths that carry a full repository-relative suffix.

Use `--roots <directory>…` for result paths relative to additional roots such as `tests/dist` or `packages/react`. Paths that match more than one cited file are structural errors.

Structural errors exit 1. In `--release` mode, results must have provenance that matches the working tree. Every cell must be `pass` or `not applicable`. An owner can explicitly waive a `not run` or `cannot be verified here` cell by adding `"waivers": { "<chart type>": { "reason": "…", "grantedBy": "…" } }` to its criterion. The waiver appears in the report and leaves the original status visible.

| Status | Meaning |
|---|---|
| pass | All cited assertions passed and measured targets were met. |
| fail | A cited assertion or suite failed, or a measured target was exceeded. |
| weak | Partial evidence leaves a documented gap. |
| no evidence | The criterion applies and has no relevant evidence. |
| not run | A cited assertion is missing or skipped, or the cell awaits a valid measurement. |
| cannot be verified here | The criterion requires an environment or rehearsal outside the supplied runs. |
| not applicable | The matrix records why the criterion does not apply. |

## Browser engines

The browser configuration runs on the engine `AXYLO_ENGINE` names: `chromium` (system Chrome, the default), `firefox` or `webkit` (Playwright's own builds; WebKit is the engine, not Safari). Each engine gets its own result file:

```sh
node acceptance/run.mjs browser                        # acceptance/results/browser.json
AXYLO_ENGINE=firefox node acceptance/run.mjs browser   # acceptance/results/browser-firefox.json
AXYLO_ENGINE=webkit node acceptance/run.mjs browser    # acceptance/results/browser-webkit.json
```

The harness records `meta.engine` and `meta.engineVersion` on every test, and the sidecar records the engine asked for and the version the results declare. The checker refuses a result file that mixes engines or disagrees with its sidecar. A browser citation takes an optional `engine` (default `chromium`) and is answered only by results of that engine; a pass on one engine never stands for another. A test that reported itself not run on an engine (`meta.notRun`) is `not run` with that reason. Results without engine records predate the switch and count as Chrome; in a run on another engine, a test without a record (the docs and distribution suites launch Chrome themselves) counts for no engine.

## Reading the checker from code

`check()` (acceptance/check.mjs) returns the Markdown `report` and `table`, and the same content as data: `rows` (per criterion its `id`, `statement` and, per chart type, `status`, `reasons` and `reports`, each with `file`, `label`, `source`, `results`, `engine`, `engineVersion` and `provenanceError`) and `runs`. `STATUSES` and `CHART_TYPES` are exported beside it. acceptance/provenance.mjs exports the configurations (`CONFIGS`, `CONFIGURATIONS`), `ENGINES`, `engineLabel()`, `defaultResultFile()` and `resultFiles()`, the default result file of every configuration and engine.

## Review and cite evidence

Use the spec ID and short wording. Section 3.6 cells use `T-<rule>-<chart type>`. Give every excluded chart type a `notApplicable` reason. Compact covers line, area and bar variants where the rule applies.

Use `evidence` for the checks a cell needs, `gaps` for the unverified part when those checks are incomplete, and `weak` for supporting citations with a specific `reason`. Use `limits` to describe the scope of a result, `cannotVerify` for environmental requirements outside the supplied runs, and `pending` for work awaiting a valid run.

Each citation specifies a repository-relative `file` and a `kind` of `unit`, `property`, `browser`, `size`, `benchmark`, `document` or `manual rehearsal`. A test citation gives its exact Vitest `title` or a `prefix` of a describe title when all reported cases are required. A generated title may include its source template as `registration`. Use `ancestors` to cite a specific suite when titles repeat. The checker refuses citations of `.fails`, `.todo` and `.skip` and requires every matching result to pass.

For a describe suite shared across chart types, add a chart-specific `casePrefix` and the expected number of distinct `cases`. The checker requires all statically known cases and the expected number of passing current registrations. A failed archived result within that scope still appears in the report. Release checks also require matching provenance.

A `size` citation names the budgeted `entries` in the packed size artifact. Historical benchmarks carry a `workload` and optional `history`. Documents, manual rehearsals and provisional benchmark workloads need separate review.

The archived four-configuration review includes [review notes](review.json) with the prior status baseline, failure causes and the browser helpers checked by negative controls.
