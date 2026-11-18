# Release acceptance

From the repository root

```sh
node --test acceptance/test/*.test.mjs
node acceptance/check.mjs
mkdir -p acceptance/results
env -u AXYLO_BROWSER timeout 120 npx vitest run --reporter=json --outputFile=acceptance/results/unit.json
node acceptance/check.mjs --results acceptance/results/unit.json
node acceptance/check.mjs --release --results acceptance/results/unit.json
```

Supply any number of Vitest JSON reports after `--results`, including browser reports collected on a machine that can run them. The checker prints the table and rewrites [report.md](report.md). Structural errors always exit 1. With `--release`, any `fail` or `no evidence` also exits 1. Review the other open statuses before tagging a release.

| Status | Meaning |
|---|---|
| pass | Every required test has a passing assertion result. |
| fail | At least one required test failed in a supplied report. |
| no evidence | The criterion applies and has no qualifying evidence. Weak checks appear in the gap list. |
| not run | Required results are absent or skipped, or a provisional budget has no matching measurement. |
| cannot be verified here | A required environment or rehearsal is unavailable, or an archived measurement has no frozen limit to compare against. The report links measured history without a verdict. |
| not applicable | The criterion does not apply to this type. The cell gives the reason. |

Firefox, Safari/WebKit, native phone behavior, screen-reader rehearsal and hardware GPU rasterisation cannot be verified here. The cited benchmark records use software rasterisation and measure main-thread work. Hardware rasterisation has no pass/fail budget of its own in spec §5.

## Add a row

Use the ID and short wording from the spec. Section 3.6 cells use `T-<rule>-<chart type>`. Add an `appliesTo` list and give a `notApplicable` reason for every excluded type. Negative type-matrix cells such as “No” zoom are applicable checks of absence. The compact column covers the variant defined in §3.7.

Read each test body and file it under the chart type it actually exercises. An `evidence` item takes a repository-relative `file` and a `kind` of `unit`, `property`, `browser`, `benchmark`, `document` or `manual rehearsal`. For tests use the exact Vitest `title` or a `prefix` of a `describe` title when the entire suite is needed. Add a `reason` to each `weak` item. Benchmark entries take a `workload` and optional `history` paths. Use `cannotVerify` for environmental limits and `pending` for provisional work, with reasons by type.

The source scanner checks conventional registrations and simple parameterized titles without importing tests. Its limits are documented in [titles.mjs](titles.mjs). A failed assertion takes precedence across reports. Documents, manual notes and provisional benchmark measurements require review outside the Vitest result join.
