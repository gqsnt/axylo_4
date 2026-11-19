import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMain } from './files.mjs';
import { defaultRecords, models, readRecords, summarize } from './protocol.mjs';

export function formatSummary(records) {
  const summary = summarize(records);
  const lines = ['agent rehearsal: these prompts, these models, Chrome; not user evidence'];
  const headings = ['Agent', 'Task', 'Pass', 'Counted', 'Fail', 'Timeout', 'Void', 'Infrastructure', 'Rule met'];
  const countKeys = ['pass', 'attempts', 'fail', 'timeout', 'void', 'infrastructure'];
  const totals = countKeys.map(key => summary.rows.reduce((total, row) => total + row[key], 0));
  const rows = [
    ...summary.rows.map(row => [row.agent, row.task, ...countKeys.map(key => row[key]), row.meetsRule ? 'yes' : 'no']),
    ['Total', '', ...totals, ''],
  ].map(row => row.map(String));
  const widths = headings.map((heading, i) => Math.max(heading.length, ...rows.map(row => row[i].length)));
  for (const row of [headings, ...rows]) lines.push(row.map((value, i) => value.padEnd(widths[i])).join('  ').trimEnd());
  lines.push(`Re-audited records: ${records.filter(run => run.history?.length).length}.`);
  for (const [agent, requested] of Object.entries(models)) {
    const observed = [...new Set(records.filter(run => run.agent === agent).map(run => run.observed?.model).filter(Boolean))];
    lines.push(`${agent} requested ${requested}; observed ${observed.join(', ') || 'none'}.`);
  }
  for (const run of records.filter(run => run.reason || (run.status && run.status !== 'pass'))) {
    const reason = run.reason ? ' — ' + run.reason : '';
    const replacement = run.replaces ? ' (replaces ' + run.replaces + ')' : '';
    lines.push(`${run.name}: ${run.status ?? 'incomplete'}${reason}${replacement}`);
  }
  if (!summary.comparable) lines.push('The records are incomplete, legacy, or mix rehearsal inputs, graders, CLI or browser versions, or observed models.');
  lines.push(summary.pass ? 'rehearsal rule met' : 'rehearsal rule not met');
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { records: { type: 'string', default: defaultRecords } } });
  console.log(formatSummary(await readRecords(resolve(values.records))));
}
