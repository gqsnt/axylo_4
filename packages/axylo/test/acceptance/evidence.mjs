// Regenerates EVIDENCE.json beside this file from a real run of this directory, so the acceptance checker
// (acceptance/check.mjs) can credit titles its source scan cannot vouch for. Run:
//
//   npx vitest run packages/axylo/test/acceptance --reporter=json --outputFile=<scratch>/run.json
//   node packages/axylo/test/acceptance/evidence.mjs <scratch>/run.json
//
// Every test that ran (passed or failed, not skipped) gets an entry { criterion, type, file, title } and, for
// a compact test, `compactKinds`: the compact kinds it really exercises. Entries already in the file are kept
// as they are, in place (their criterion was sometimes chosen by hand: a test can be evidence for several
// criteria); entries whose test no longer runs are removed; tests with no entry are appended, the criterion
// and type read from the title's first two words. A new compact test must be listed in COMPACT_KINDS below,
// read from the test's code (which kinds its loop or fixture really uses), never guessed from its title: the
// script stops with the title when one is missing.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../../..');
const target = path.join(import.meta.dirname, 'EVIDENCE.json');

const ALL = ['line', 'area', 'bar'];
/** Compact kinds per compact title, read from each test. */
const COMPACT_KINDS = {
  // production.test.ts: one chart of the named kind.
  'F3 compact line: an error prints once in a production build and the chart shows its error state': ['line'],
  'F3 compact line: in production a code prints once per page across two charts': ['line'],
  'F3 compact line: in production a hint is delivered to onDiagnostic and not printed': ['line'],
  'F3 compact area: an error prints once in a production build and the chart shows its error state': ['area'],
  'F3 compact area: in production a code prints once per page across two charts': ['area'],
  'F3 compact area: in production a hint is delivered to onDiagnostic and not printed': ['area'],
  'F3 compact bar: an error prints once in a production build and the chart shows its error state': ['bar'],
  'F3 compact bar: in production a code prints once per page across two charts': ['bar'],
  'F3 compact bar: in production a hint is delivered to onDiagnostic and not printed': ['bar'],
  // dx-diagnostics.test.ts: `for (const kind of compactKinds(type))`, all three for compact.
  'F3 compact: a hint does not throw under strict (it is reported and the chart draws)': ALL,
  'F3 compact: a row getter that throws while the chart reads its data is AX199, an error delivered once, and the chart shows its error state': ALL,
  "F3 compact: field and row indexes of an unreadable x and of a duplicate x name the caller's rows": ALL,
  // f-missing-values.test.ts: one kind per test.
  'F2 compact: line draws an absent step on a regular instant axis as a gap, through the controller': ['line'],
  'F2 compact: area draws an absent step on a regular instant axis as a gap, through the controller': ['area'],
  'F2 compact: bar draws an absent step on a regular instant axis as a gap, through the controller': ['bar'],
  // f-time.test.ts: `for (const kind of compactKinds(type))`.
  'F4 compact: mixing wall-clock times and instants with no calendar date is never silent: the minority rows are reported and not drawn': ALL,
  // f-domains.test.ts.
  'F1 compact: horizontal bars include zero and every bar starts at the zero baseline': ['bar'],
  "F7 compact: a stacked area's automatic domain ends at the first tick at or beyond the stack totals (no ticks drawn: the same domain as the full chart)": ['area'],
  "F7 compact: a stacked bar's automatic domain ends at the first tick at or beyond the stack totals (no ticks drawn: the same domain as the full chart)": ['bar'],
  'F7 compact: a compact line has the same value domain as the full chart, though it draws no ticks': ['line'],
  'F7 compact: a compact area has the same value domain as the full chart, though it draws no ticks': ['area'],
  'F7 compact: a compact bar has the same value domain as the full chart, though it draws no ticks': ['bar'],
};

const runFile = process.argv[2];
if (!runFile) throw new Error('usage: node evidence.mjs <vitest JSON report of packages/axylo/test/acceptance>');
const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
const ran = new Map();
for (const result of run.testResults) {
  const file = path.relative(root, result.name).split(path.sep).join('/');
  for (const test of result.assertionResults) {
    if (['skipped', 'pending', 'todo'].includes(test.status)) continue;
    const title = [...test.ancestorTitles, test.title].join(' ');
    ran.set(`${file}\u0000${title}`, { file, title });
  }
}

const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
const kept = existing.filter(entry => ran.has(`${entry.file}\u0000${entry.title}`));
const listed = new Set(kept.map(entry => `${entry.file}\u0000${entry.title}`));
const added = [];
for (const [key, { file, title }] of ran) {
  if (listed.has(key)) continue;
  const [criterion, second] = title.split(/[ :]+/);
  const type = second === 'compact' ? 'compact' : second;
  if (!['line', 'area', 'bar', 'scatter', 'donut', 'compact'].includes(type)) throw new Error(`no chart type in the title: ${title}`);
  const entry = { criterion, type, file, title };
  if (type === 'compact') {
    const kinds = COMPACT_KINDS[title];
    if (!kinds) throw new Error(`compact test without its kinds in COMPACT_KINDS (read them from the test): ${title}`);
    entry.compactKinds = kinds;
  }
  added.push(entry);
}
added.sort((a, b) => a.criterion.localeCompare(b.criterion) || a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
const entries = [...kept, ...added];
fs.writeFileSync(target, '[\n' + entries.map(entry => '  ' + JSON.stringify(entry)).join(',\n') + '\n]\n');
console.log(`EVIDENCE.json: ${entries.length} entries (${new Set(entries.map(e => e.title)).size} titles); ${existing.length - kept.length} removed, ${added.length} added`);
