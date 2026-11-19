import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { auditHasPathViolation, auditTranscript, auditVersion } from '../audit.mjs';
import { readJson, rehearsal, taskFiles, writeJson } from '../files.mjs';
import { effort, inputHashes, models, nextAttempts, protocol, readRecords, timeoutMs } from '../protocol.mjs';
import { reauditRecords } from '../reaudit.mjs';
import { formatSummary } from '../summary.mjs';
import { prepareWorkspace, removeWorkspace } from '../workspace.mjs';

const fixtures = new URL('./fixtures/release-1e93128/', import.meta.url);
const fixture = name => readFile(new URL(name + '.jsonl', fixtures), 'utf8');
const claudeFixtures = ['daily-visits', 'regional-sales', 'signups', 'daily-revenue']
  .flatMap(task => [1, 2, 3].map(slot => ['claude', task, slot]));
const codexFixtures = [
  ['codex', 'daily-visits', 1, '/tmp/axylo-rehearsal-DwnMqz/workspace'],
  ['codex', 'regional-sales', 2, '/tmp/axylo-rehearsal-iS75px/workspace'],
  ['codex', 'regional-sales', 3, '/tmp/axylo-rehearsal-EiVT5R/workspace'],
];
const start = '2026-11-19T08:25:08.459Z';
const end = '2026-11-19T08:27:09.968Z';
const cell = { agent: 'codex', task: 'daily-revenue' };
const revenueWorkspace = '/tmp/axylo-rehearsal-6SKmnr/workspace';
const outsideMissing = ['/AGENTS.md', '/tmp/AGENTS.md'].map(path => ({ path, exists: false }));

function codexLog(command, cwd, output = '') {
  return [{ type: 'thread.started', thread_id: 'thread-id' }, { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'command_execution', command, cwd, aggregated_output: output } },
    { type: 'turn.completed' }].map(event => JSON.stringify(event)).join('\n');
}

let scratch;
beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'axylo-reaudit-test-')); });
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

it.each([...claudeFixtures, ...codexFixtures])('clears the saved %s %s %s false positive', async (agent, task, slot, cwd) => {
  const log = await fixture(`${agent}-${task}-${slot}`);
  const workspace = cwd ?? JSON.parse(log.split('\n')[0]).cwd;
  expect(await auditTranscript(log, { workspace, runDirectory: dirname(workspace) }, agent)).toEqual({
    status: 'no findings', paths: [], tools: [], malformedLines: 0, problems: [],
  });
});

it('records the two missing paths outside the original run without voiding it', async () => {
  const transcript = await fixture('codex-daily-revenue-3');
  const audit = await auditTranscript(transcript, { workspace: revenueWorkspace, runDirectory: dirname(revenueWorkspace) }, 'codex');
  expect(audit).toMatchObject({ status: 'looked outside the workspace', paths: outsideMissing.map(look => look.path),
    outsidePaths: outsideMissing, problems: ['Looked outside the workspace.'] });
  expect(auditHasPathViolation(audit)).toBe(false);
});

it('voids an existing outside file and resolves shell operands after changing directory', async () => {
  const runDirectory = join(scratch, 'run');
  const workspace = join(runDirectory, 'workspace');
  const outside = join(scratch, 'outside directory');
  const file = join(outside, 'names with spaces.txt');
  await mkdir(workspace, { recursive: true });
  await mkdir(outside);
  await writeFile(file, 'outside text');
  const command = `/bin/bash -lc "cd '../../outside directory' && cat names\\ with\\ spaces.txt; cat file:///etc/hostname"`;
  const audit = await auditTranscript(codexLog(command, workspace), { workspace, runDirectory }, 'codex');
  expect(audit).toMatchObject({ status: 'outside policy', paths: ['/etc/hostname', outside, file].sort(),
    outsidePaths: ['/etc/hostname', outside, file].sort().map(path => ({ path, exists: true })) });
  expect(auditHasPathViolation(audit)).toBe(true);
});

it('ignores paths in patterns, option values, inline programs, heredocs and command output', async () => {
  const command = [
    "rg -n --glob '/etc/hostname' '/etc/hostname' docs/options.html",
    "sed -e 's:/etc/hostname::g' docs/index.html",
    `node -e 'const path = "/etc/hostname"'`,
    "cat >chart.js <<'EOF'", 'cat /etc/hostname', 'EOF',
    "printf '%s' '/etc/hostname' # cat /etc/hostname",
  ].join('\n');
  const log = codexLog(command, scratch, 'cat /etc/hostname');
  expect(await auditTranscript(log, { workspace: scratch, runDirectory: scratch }, 'codex'))
    .toMatchObject({ status: 'no findings', paths: [] });
});

it('takes only the named path fields of file tools', async () => {
  const path = '/etc/hostname';
  const transcript = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [
      { type: 'text', text: path },
      { type: 'tool_use', name: 'Edit', input: { file_path: 'chart.js', old_string: '/code', new_string: path } },
      { type: 'tool_use', name: 'Write', input: { file_path: 'check.js', content: path } },
      { type: 'tool_use', name: 'Glob', input: { path: 'docs', pattern: '**/*.html' } },
      { type: 'tool_use', name: 'Grep', input: { path, pattern: '/script/' } },
    ] } },
    { type: 'result', is_error: false },
  ].map(event => JSON.stringify(event)).join('\n');
  expect(await auditTranscript(transcript, { workspace: scratch, runDirectory: scratch }, 'claude'))
    .toMatchObject({ status: 'outside policy', paths: [path], outsidePaths: [{ path, exists: true }] });
});

it('replays a resolved symlink after removal using the saved path evidence', async () => {
  const runDirectory = join(scratch, 'run');
  const link = join(runDirectory, 'linked');
  await mkdir(runDirectory);
  await symlink('/etc/hostname', link);
  const log = codexLog('cat linked', runDirectory);
  const options = { workspace: runDirectory, runDirectory, pathEvidence: {} };
  const original = await auditTranscript(log, options, 'codex');
  expect(original).toMatchObject({ status: 'outside policy', paths: ['/etc/hostname'] });
  await rm(runDirectory, { recursive: true });
  expect(await auditTranscript(log, structuredClone(options), 'codex')).toEqual(original);
});

async function recordCopy(root, name, { hashes, status = 'void', slot = 3, chart = true } = {}) {
  const saved = join(root, name);
  await mkdir(join(saved, 'answer'), { recursive: true });
  await cp(new URL('codex-daily-revenue-3.jsonl', fixtures), join(saved, 'transcript.jsonl'));
  if (chart) await writeFile(join(saved, 'answer', 'chart.js'), 'export { help as default } from "./helpers.js";');
  await writeFile(join(saved, 'answer', 'helpers.js'), 'export function help() {}');
  await writeFile(join(saved, 'answer', 'data.json'), 'excluded from the restored answer');
  const record = { ...cell, slot, protocol, status, hashes, startedAt: start, endedAt: end, timeoutMs,
    reason: status === 'void' ? 'Recorded forbidden paths outside the attempt run directory.' : null,
    requested: { model: models.codex, effort }, observed: { model: models.codex, effort },
    cli: { args: ['-C', revenueWorkspace], version: 'fixture-cli' }, exit: { code: 0, signal: null, timedOut: false, error: null },
    audit: { status: 'outside policy', paths: outsideMissing.map(look => look.path) },
    ...(status === 'pass' ? { browserVersion: 'fixture Chrome' } : {}) };
  await writeJson(join(saved, 'run.json'), record);
  return { saved, record };
}

async function hashesForRevenue() {
  const prepared = await prepareWorkspace(scratch, cell.task, { inputHashes: workspace => inputHashes(workspace, cell.task) });
  await removeWorkspace(prepared.runDirectory);
  return prepared.hashes;
}

it('grades an eligible copied void once, keeps its slot and history, and refuses a hash mismatch', async () => {
  const records = join(scratch, 'records');
  const hashes = await hashesForRevenue();
  const { saved, record } = await recordCopy(records, 'eligible', { hashes });
  const { saved: mismatched, record: originalMismatch } = await recordCopy(records, 'mismatched', {
    hashes: { ...hashes, input: 'different' }, slot: 2,
  });
  await recordCopy(records, 'counted', { hashes, status: 'pass', slot: 1 });
  const gradeAnswer = vi.fn(async (workspace, task) => {
    expect(task).toBe(cell.task);
    expect(await inputHashes(workspace, task)).toEqual(hashes);
    expect(await readFile(join(workspace, 'data.json'), 'utf8')).toBe(await readFile(taskFiles(task).fixture, 'utf8'));
    expect(await readFile(join(workspace, 'chart.js'), 'utf8')).toBe('export { help as default } from "./helpers.js";');
    expect(await readFile(join(workspace, 'helpers.js'), 'utf8')).toBe('export function help() {}');
    return { pass: true, criteria: [], browserVersion: 'fixture Chrome' };
  });
  const options = { workdir: scratch, gradeAnswer };
  const results = await reauditRecords(records, options);
  expect(results).toEqual([
    { name: 'counted', status: 'pass', reason: null }, { name: 'eligible', status: 'pass', reason: null },
    { name: 'mismatched', error: 'Saved hashes do not match prepared inputs: input' },
  ]);
  expect(gradeAnswer).toHaveBeenCalledTimes(1);
  expect(await readJson(join(saved, 'grade.json'))).toMatchObject({ pass: true, browserVersion: 'fixture Chrome' });
  const run = await readJson(join(saved, 'run.json'));
  expect(run).toMatchObject({ status: 'pass', slot: 3, hashes, auditVersion, auditedAt: expect.any(String),
    audit: { status: 'looked outside the workspace', outsidePaths: outsideMissing },
    history: [{ status: 'void', reason: record.reason, auditVersion: 1, date: end, audit: record.audit }] });
  expect(await readFile(join(saved, 'transcript.jsonl'), 'utf8')).toBe(await fixture('codex-daily-revenue-3'));
  expect(await readFile(join(saved, 'answer', 'data.json'), 'utf8')).toBe('excluded from the restored answer');
  expect(await readJson(join(mismatched, 'run.json'))).toEqual(originalMismatch);
  const latest = await readRecords(records);
  expect(nextAttempts(latest, cell, 3)).toEqual([{ ...cell, slot: 2, replaces: 'mismatched' }]);
  expect(formatSummary(latest)).toContain('Re-audited records: 2.');
  expect(formatSummary(latest)).toMatch(/^codex +daily-revenue +2 +2 +0 +0 +1 +0 +no$/m);

  await reauditRecords(records, options);
  expect(gradeAnswer).toHaveBeenCalledTimes(1);
  const again = await readJson(join(saved, 'run.json'));
  expect(again.history).toEqual([...run.history, { status: 'pass', reason: null, auditVersion, date: run.auditedAt,
    audit: run.audit, browserVersion: run.browserVersion }]);
});

it('runs the CLI and writes the same failing grade as the runner for a copy with no chart', async () => {
  const records = join(scratch, 'records');
  const { saved } = await recordCopy(records, 'missing-chart', { hashes: await hashesForRevenue(), chart: false });
  const executable = join(rehearsal, 'reaudit.mjs');
  const output = join(scratch, 'reaudit.log');
  const handle = await open(output, 'wx');
  try {
    const child = spawn(process.execPath, [executable, '--records', records], { stdio: ['ignore', handle.fd, 'inherit'] });
    expect(await once(child, 'close')).toEqual([0, null]);
  } finally {
    await handle.close();
  }
  expect(await readJson(join(saved, 'run.json'))).toMatchObject({ status: 'fail', slot: 3 });
  expect(await readFile(output, 'utf8')).toBe('missing-chart: fail — render\nRe-audited 1 of 1 records.\n');
  expect(await readJson(join(saved, 'grade.json'))).toMatchObject({ pass: false, criteria: [
    { name: 'render', pass: false, detail: 'chart.js is missing.' },
  ] });
});

it('keeps an outside-read void open and voids a counted copy with the same finding', async () => {
  const records = join(scratch, 'records');
  for (const status of ['void', 'pass']) {
    const { saved } = await recordCopy(records, status, { status });
    await writeFile(join(saved, 'transcript.jsonl'), codexLog('cat /etc/hostname', revenueWorkspace));
  }
  const gradeAnswer = vi.fn();
  const results = await reauditRecords(records, { workdir: scratch, gradeAnswer });
  expect(results).toEqual(['pass', 'void'].map(name => ({ name, status: 'void', reason: 'Looked outside the workspace.' })));
  expect(gradeAnswer).not.toHaveBeenCalled();
  expect(await readJson(join(records, 'pass', 'run.json'))).toMatchObject({ status: 'void', audit: {
    status: 'outside policy', outsidePaths: [{ path: '/etc/hostname', exists: true }],
  }, history: [{ status: 'pass' }] });
});
