# Release acceptance

From the repository root

```sh
node --test acceptance/test/*.test.mjs
mkdir -p acceptance/results
env -u AXYLO_BROWSER timeout 400 npx vitest run --reporter=json --outputFile=acceptance/results/unit.json
node acceptance/check.mjs --results acceptance/results/unit.json
```

Append any available coordinator reports to `--results`. Omit reports that are absent. The checker prints the table with each cell's result sources and regenerates [report.md](report.md). With no arguments, it checks citations and reports static coverage plus any cited packed size measurement.

| Result | Vitest configuration |
|---|---|
| `unit.json` | Root configuration in Node |
| `browser.json` | Root configuration with `AXYLO_BROWSER=1` |
| `dist.json` | `tests/dist/vitest.config.ts` in Node |
| `dist-browser.json` | `tests/dist/vitest.config.ts` with `AXYLO_BROWSER=1` |

Use `--roots <directory>…` when a report uses paths relative to a directory other than the repository root. For example, `--roots tests/dist packages/react` also resolves paths relative to those two directories. Paths that match more than one cited source are errors. Absolute paths from an archived checkout can use their full repository-relative suffix.

Structural errors exit 1. With `--release`, any `fail`, `weak` or `no evidence` cell also exits 1. The report identifies pending workloads and verification that requires another environment.

| Status | Meaning |
|---|---|
| pass | The required assertions passed and any measured targets were met. |
| fail | A required assertion failed or a measured target was exceeded. A failure takes precedence when results differ. |
| weak | Partial evidence exists and leaves a documented gap. A passing result for a cited test can coexist with a weak cell. |
| no evidence | The criterion applies and has no relevant evidence. |
| not run | Required assertions are missing or skipped, or the cell is waiting for a valid measurement. |
| cannot be verified here | The criterion requires an environment or rehearsal outside the supplied runs. |
| not applicable | The criterion does not apply to the chart type. The matrix records the reason. |

## Review and cite evidence

Use the spec ID and short wording. Section 3.6 cells use `T-<rule>-<chart type>`. Give every excluded chart type a `notApplicable` reason. Negative type-matrix rules such as donut zoom check absence. Compact covers line, area and bar variants where the rule applies.

Read the assertion and its fixture before citing it. Use `evidence` for the checks needed for a cell, `gaps` for the specific unverified part when those checks are collectively partial, and `weak` for supporting citations with their own `reason`. Use `cannotVerify` for environmental limits and `pending` for work awaiting a valid run.

Each citation specifies a repository-relative `file` and a `kind` of `unit`, `property`, `browser`, `size`, `benchmark`, `document` or `manual rehearsal`. For a test, give its exact Vitest `title` or a `prefix` of a `describe` title when all registered cases are required. For a generated title the source scanner cannot expand, include its source template as `registration`. Give the exact `ancestors` path when suite names are generated or a repeated title must be scoped to a particular suite. The checker verifies the source registration and joins only matching assertion identities.

A `size` citation names the budgeted `entries` in the packed size artifact and compares exact gzip bytes to the recorded targets. Historical benchmarks carry a `workload` and optional `history`. Documents, manual rehearsals and provisional benchmark workloads need review outside the Vitest result join.
