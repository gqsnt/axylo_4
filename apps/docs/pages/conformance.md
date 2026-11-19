# Conformance table

After this page you know which WCAG 2.2 success criteria the specification cites, what Axylo does for each, what evidence was recorded for them when this site was built, why no test covers the other level A and AA criteria, and what that evidence cannot show.

This page is generated each time the site is built, from the specification's criterion rows and from the report of the acceptance checker. It says only what they record; where they record nothing, it says "not recorded". It is not a claim that a page using Axylo conforms: conformance belongs to a whole page, and the page is yours.

## What the evidence can and cannot show

On release candidate `1e93128`, Codex CLI `gpt-6.2-sol` and Claude Code `claude-opus-5-5` each passed three uncoached attempts on each of four fixed line and bar tasks. All 24 attempts passed after the transcript re-audit. In Chrome 158, each saved answer passed the reader checks without error diagnostics on both inputs in the Los Angeles and Tokyo time zones. This agent rehearsal gives no estimate of general success and provides no evidence of human or screen-reader usability or WCAG conformance. The prompt restricted agents to the published docs for guidance, and the audit checked recorded access. The filesystem did not enforce docs-only access.

- **Automated checks only.** The acceptance tests check structure: names, roles, focus order, contrast, sizes and text. They do not show that a person using a screen reader understands a chart.
- **No screen-reader rehearsal was done for 1.0.** No screen reader has been run against these charts, so nothing in this documentation says what a screen reader speaks.
- **No usability testing with disabled people.** Axylo is built by one person with no access to study participants, and no claim of usability testing with disabled users is made.
- **Engines, not browsers.** Browser results are recorded per engine: Chrome, and Firefox and WebKit as built by Playwright. WebKit results are Playwright's WebKit, not Safari. Nothing has been run on a phone.
- **Right-to-left pages.** Right-to-left text renders, but the chart's layout is not mirrored.
- **Transformed ancestors.** A chart inside a translated or scaled element is exact. Inside a rotated, skewed or mirrored element it draws, but pointing and tooltip placement are wrong; that is not supported in 1.0.

## What you must supply

Axylo can only describe what it is given. A chart needs a meaningful name (`title`, or `labelledBy` pointing at your heading), series names, units on value fields, and the page's own structure around it. A compact chart fed by `append` has no Pause control, since it has no toolbar: a page that streams into compact tiles must give the reader its own way to pause them (WCAG 2.2.2). [Accessibility](accessibility.md#what-you-must-supply) has the details.

## The criteria the specification cites

[table: conformance](../../../acceptance/check.mjs)
