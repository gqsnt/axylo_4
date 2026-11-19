import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, rehearsal, repository, taskFiles, tasks } from './files.mjs';
import { packedPackage } from './workspace.mjs';

export const protocol = 1;
export const models = { codex: 'gpt-6.2-sol', claude: 'claude-opus-5-5' };
export const effort = 'xhigh';
export const timeoutMs = 20 * 60 * 1000;
export const target = 3;
export const defaultRecords = join(rehearsal, 'records');
export const cells = Object.keys(models).flatMap(agent => tasks.map(task => ({ agent, task })));
export const counted = ['pass', 'fail', 'timeout'];

const digest = data => createHash('sha256').update(data).digest('hex');
const fileHash = async file => digest(await readFile(file));

async function treeHash(directory) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Expected an input directory: ' + directory);
  const tree = await readdir(directory, { recursive: true, withFileTypes: true });
  if (tree.some(entry => !entry.isDirectory() && !entry.isFile())) throw new Error('Unexpected entry in input tree: ' + directory);
  const files = tree.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(directory.length + 1)).sort();
  const entries = await Promise.all(files.map(async file => [file, await fileHash(join(directory, file))]));
  return digest(JSON.stringify(entries));
}

const stagedFiles = { prompt: 'PROMPT.md', input: 'data.json', manifest: 'package.json' };

async function stagedHashes(workspace) {
  const files = Object.entries(stagedFiles).map(async ([key, name]) => {
    const file = join(workspace, name);
    if (!(await lstat(file)).isFile()) throw new Error('Expected a regular input file: ' + file);
    return [key, await fileHash(file)];
  });
  const entries = await Promise.all([
    treeHash(join(workspace, 'docs')).then(hash => ['docs', hash]),
    treeHash(join(workspace, 'node_modules')).then(hash => ['installedPackage', hash]),
    ...files,
  ]);
  return Object.fromEntries(entries);
}

export async function inputChanges(workspace, original) {
  try {
    const current = await stagedHashes(workspace);
    return Object.keys(current).filter(key => current[key] !== original[key]).join(', ');
  } catch (error) {
    return error.message;
  }
}

export async function inputHashes(workspace, task) {
  const { alternate, expected, alternateExpected } = taskFiles(task);
  const sources = {
    package: fileHash(packedPackage),
    alternate: fileHash(alternate),
    expected: fileHash(expected),
    alternateExpected: fileHash(alternateExpected),
    grader: Promise.all([
      ...['grade.mjs', 'reader.mjs', 'table.mjs', 'files.mjs'].map(file => fileHash(join(rehearsal, file))),
      fileHash(join(repository, 'packages/axylo/src/diagnostics/registry.ts')),
    ]).then(hashes => digest(JSON.stringify(hashes))),
  };
  const [staged, entries] = await Promise.all([
    stagedHashes(workspace),
    Promise.all(Object.entries(sources).map(async ([key, hash]) => [key, await hash])),
  ]);
  return { ...staged, ...Object.fromEntries(entries) };
}

export async function readRecords(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const records = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async ({ name }) => {
    try {
      return { ...await readJson(join(root, name, 'run.json')), name };
    } catch (error) {
      return { name, reason: String(error) };
    }
  }));
  return records.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.name.localeCompare(b.name));
}

export function cellRecords(records, agent, task) {
  return records.filter(record => record.protocol === protocol && record.agent === agent && record.task === task);
}

export function nextAttempts(records, cell, attempts) {
  const previous = cellRecords(records, cell.agent, cell.task);
  return Array.from({ length: attempts }, (_, index) => index + 1).flatMap(slot => {
    const entries = previous.filter(record => record.slot === slot);
    if (entries.some(record => counted.includes(record.status))) return [];
    return [{ ...cell, slot, replaces: entries.at(-1)?.name ?? null }];
  });
}

export function observedMatches(agent, observed = {}) {
  const { model, models: seen, effort: observedEffort } = observed;
  if (agent === 'codex') return model === models.codex && observedEffort === effort;
  return seen?.length === 1 && (model === models.claude || /^claude-opus-5-5-\d{8}$/.test(model));
}

function incompleteOrMixed(records, results) {
  if (records.some(record => record.protocol !== protocol || !Object.hasOwn(models, record.agent) ||
      !tasks.includes(record.task) || ![...counted, 'void', 'infrastructure'].includes(record.status))) return true;
  const distinct = (runs, lookup) => new Set(runs.map(lookup)).size;
  if (results.some(record => !record.hashes || !record.cli?.version ||
      record.requested?.model !== models[record.agent] || record.requested?.effort !== effort ||
      record.timeoutMs !== timeoutMs || (record.status === 'pass' &&
        (!record.browserVersion || !observedMatches(record.agent, record.observed))))) return true;
  if (distinct(results, run => JSON.stringify([run.hashes.grader, run.hashes.docs, run.hashes.package, run.hashes.installedPackage])) > 1) return true;
  if (distinct(results.filter(run => run.browserVersion), run => run.browserVersion) > 1) return true;
  for (const agent of Object.keys(models)) {
    const runs = results.filter(run => run.agent === agent);
    if (distinct(runs, run => run.cli.version) > 1 ||
        distinct(runs.filter(run => run.observed?.model), run => run.observed.model) > 1) return true;
  }
  return tasks.some(task => distinct(results.filter(run => run.task === task), run => JSON.stringify(run.hashes)) > 1);
}

export function summarize(records) {
  const results = records.filter(record => record.protocol === protocol && counted.includes(record.status));
  const rows = cells.map(({ agent, task }) => {
    const all = cellRecords(records, agent, task);
    const attempts = all.filter(record => counted.includes(record.status));
    const counts = Object.fromEntries([...counted, 'void', 'infrastructure'].map(status =>
      [status, all.filter(record => record.status === status).length]));
    return { agent, task, attempts: attempts.length, ...counts,
      complete: counts.pass === target && attempts.length === target &&
        [1, 2, 3].every(slot => attempts.some(run => run.slot === slot)) };
  });
  const comparable = !incompleteOrMixed(records, results);
  return { rows, comparable, pass: comparable && rows.every(row => row.complete) };
}
