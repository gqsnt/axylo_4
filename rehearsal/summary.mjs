import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultRecords, models, readRecords, summarize } from './protocol.mjs';

const { values } = parseArgs({ options: { records: { type: 'string', default: defaultRecords } } });
const records = await readRecords(resolve(values.records));
const summary = summarize(records);

console.log('agent rehearsal: these prompts, these models, Chrome; not user evidence');
const headings = ['Agent', 'Task', 'Pass', 'Counted', 'Fail', 'Timeout', 'Void', 'Infrastructure'];
const rows = summary.rows.map(row => [row.agent, row.task, row.pass, row.attempts, row.fail, row.timeout, row.void, row.infrastructure].map(String));
const widths = headings.map((heading, i) => Math.max(heading.length, ...rows.map(row => row[i].length)));
for (const row of [headings, ...rows]) console.log(row.map((value, i) => value.padEnd(widths[i])).join('  ').trimEnd());
for (const [agent, requested] of Object.entries(models)) {
  const observed = [...new Set(records.filter(run => run.agent === agent).map(run => run.observed?.model).filter(Boolean))];
  console.log(`${agent} requested ${requested}; observed ${observed.join(', ') || 'none'}.`);
}
for (const run of records.filter(run => run.reason)) {
  console.log(`${run.name}: ${run.status ?? 'incomplete'} — ${run.reason}${run.replaces ? ' (replaces ' + run.replaces + ')' : ''}`);
}
console.log('Every cell 3 of 3: ' + (summary.rows.every(row => row.complete) ? 'yes' : 'no'));
if (!summary.comparable) console.log('The records are incomplete, legacy, or mix rehearsal inputs, graders, CLI or browser versions, or observed models.');
console.log('Release rehearsal rule met: ' + (summary.pass ? 'yes' : 'no'));
