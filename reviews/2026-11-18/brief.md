# Review brief: Axylo design documents

You are an independent reviewer. Your job is to find what is wrong, weak or missing, and to propose specific improvements. Agreement is not useful; a claim you checked and found correct needs one line at most.

## What is under review

Axylo is a planned browser charting library for everyday charts in web apps and dashboards. No library code exists yet. Four documents and their evidence were written in one session by one author and have not been reviewed:

| File | Contents |
|---|---|
| `docs/01-landscape.md` | Adoption evidence and a same-task comparison of ten charting libraries |
| `docs/02-product-spec.md` | Product definition, first-release scope, acceptance criteria |
| `docs/03-plan-typescript-release.md` | Public API, architecture, milestones for a TypeScript 1.0 |
| `docs/04-plan-performance.md` | Performance measurement and improvement plan, and the bar for a Rust experiment |
| `research/` | Evidence: `adoption/*.json`, `harness/src/` (the code each library was given), `harness/probe.mjs` (how it was probed), `harness/results.json`, `harness/palette.json`, `harness/sizes.json`, `harness/perf.log`, `harness/shots/*.png`, `palette/` |

Ignore `research/harness/node_modules` and `research/harness/dist`.

The original request the documents answer:

> Design Axylo from scratch. The first release is for everyday charts in web apps and dashboards. Highcharts, Chart.js, and uPlot give a sense of the use cases.
> Phase 1: research the current state of browser charting; identify ten of the most widely used libraries with dated adoption evidence and the limits of that data; compare them on the same representative tasks (default look and communication, accessible exploration and interaction, developer creation, update, customization, maintenance), making clear what was verified firsthand; then write the product specification with concrete acceptance criteria for reader and developer experience, including accessibility and faithful representation of data, and explain which findings drove the decisions.
> Phase 2: plan a usable first release entirely in TypeScript: public API, architecture, milestones with testable outcomes, examples, documentation, and what can wait.
> Phase 3: plan continuous performance work: measuring real browser workloads, comparing with relevant libraries, finding bottlenecks, testing hypotheses, catching regressions, what makes a gain worth shipping; where a measured bottleneck could justify a Rust experiment and the evidence needed to adopt it.

## What to do

1. **Audit the evidence.** For claims in `01-landscape.md`, check them against the data and harness code. Look for: numbers that do not match the JSON; conclusions the probe cannot support; comparisons that are unfair to a library (wrong or unidiomatic configuration, a default misread, a harness bug presented as a library flaw); findings stated more strongly than the method allows; selection or framing bias.
2. **Challenge the decisions.** For the decisions in `02-product-spec.md` section 6 and the architecture in `03-plan-typescript-release.md`, state the strongest counter-argument, say whether it defeats the decision, and say what evidence would settle it.
3. **Test the criteria and plans.** Find acceptance criteria that are untestable, ambiguous, mutually inconsistent, infeasible, or missing; budgets with no basis; milestones whose outcomes do not prove what they claim; contradictions between the four documents; risks nobody listed; places where the plans do not answer the original request.
4. **Propose improvements.** For each problem, give the specific change: replacement wording, a changed threshold with its reason, an added criterion, a reordered milestone, an extra probe to run.

Your assigned deep dive is given at the end of this brief. Cover everything, and spend the most effort there.

## Rules

- Read-only. Do not create, edit or delete any file. Put everything in your final message.
- Keep three things apart and label them: **Observed** (you read it in a file here; cite the path and the line or key), **Inferred** (your reasoning), **From memory** (your knowledge of a library or standard, not checked here; give the version or date you believe it applies to).
- If you could not check something, say so. Do not fill gaps with plausible detail.
- The library versions tested are from November 2026 and may be newer than what you know. Where your knowledge of a library conflicts with the harness result, say so and say which you would trust and why; do not assume the harness is wrong or right.
- No praise, no summary of the documents.

## Output format

```
## Findings
### <B|M|m><n>. <one-line statement of the problem>     (B = blocks building on this, M = major, m = minor)
- Where: <file, section or criterion ID>
- Evidence: <Observed / Inferred / From memory, with citation>
- Change: <the specific change you propose>

## Decisions I would overturn or reopen
<decision, counter-argument, what would settle it>

## Missing from the documents
<gaps against the original request or against good practice>

## What I could not verify
```

Order findings by severity, most severe first.
