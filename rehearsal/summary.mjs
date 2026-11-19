import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, rehearsal } from './files.mjs';

const root = join(rehearsal, 'records');
const entries = await readdir(root, { withFileTypes: true }).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
const rows = [];
for (const entry of entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const directory = join(root, entry.name);
  try {
    const run = await readJson(join(directory, 'run.json'));
    const grade = await readJson(join(directory, 'grade.json'));
    const agentFailed = run.exit.code !== 0 || run.exit.timedOut || run.exit.error !== null;
    const failed = grade.criteria.filter(item => !item.pass).map(item => item.name);
    if (agentFailed) failed.unshift(run.exit.timedOut ? 'agent timeout' : 'agent exit');
    if (run.void) failed.unshift('outside workspace');
    rows.push([
      entry.name, run.agent, run.observed.model ?? `${run.requested.model} (requested)`, run.task,
      run.void ? 'void' : grade.pass && !agentFailed ? 'yes' : 'no', failed.join(', ') || '—',
    ]);
  } catch (error) {
    rows.push([entry.name, '—', '—', '—', 'incomplete', String(error)]);
  }
}

console.log('DX12 agent rehearsal');
const headings = ['Record', 'Agent', 'Model', 'Task', 'Pass', 'Failed criteria'];
const widths = headings.map((heading, i) => Math.max(heading.length, ...rows.map(row => row[i].length)));
for (const row of [headings, ...rows]) {
  console.log(row.map((value, i) => value.padEnd(widths[i])).join('  ').trimEnd());
}
