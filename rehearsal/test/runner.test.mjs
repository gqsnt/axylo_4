import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentArgs, observeAgent, runAgent } from '../agent.mjs';
import { auditTranscript } from '../audit.mjs';
import { repository } from '../files.mjs';
import { grade } from '../grade.mjs';
import { prepareWorkspace } from '../workspace.mjs';

const jsonl = (...events) => events.map(event => JSON.stringify(event)).join('\n');
const command = (text, cwd) => ({ type: 'item.completed', item: { type: 'command_execution', command: text, cwd } });
const claude = (name, input, model) => ({
  type: 'assistant', message: { model, content: [{ type: 'tool_use', name, input }] },
});

let scratch;
beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'axylo-rehearsal-test-')); });
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

it('audits actual Codex commands and Claude tool calls while allowing the published docs and system tools', async () => {
  const transcript = jsonl(
    { type: 'thread.started', thread_id: 'rehearsal-test' },
    command('/bin/bash -lc \'cat docs/getting-started.html; node ./chart.js\'', scratch),
    claude('Read', { file_path: join(scratch, 'data.json') }, 'claude-test-model'),
    { type: 'item.completed', item: { type: 'agent_message', text: 'I did not read /home/user/notes.txt.' } },
  );
  expect(await auditTranscript(transcript, scratch)).toEqual({ void: false, paths: [], malformedLines: 0 });
});

it('voids a transcript that reads Axylo source', async () => {
  const source = '/home/canarit/projects/axylo/packages/axylo/src/index.ts';
  const transcript = jsonl(
    command(`/bin/bash -lc 'cat "${source}"'`, scratch),
    claude('Read', { file_path: source }, 'claude-test-model'),
  );
  expect(await auditTranscript(transcript, scratch)).toEqual({ void: true, paths: [source], malformedLines: 0 });
});

it('follows recorded relative paths and symlinks out of the workspace', async () => {
  const workspace = join(scratch, 'workspace');
  const outside = join(scratch, 'other.txt');
  await mkdir(workspace);
  await writeFile(outside, '');
  await symlink(outside, join(workspace, 'linked.txt'));
  const transcript = jsonl(command('cat linked.txt', workspace), claude('Read', { file_path: '../other.txt' }));
  expect(await auditTranscript(transcript, workspace)).toEqual({ void: true, paths: [outside], malformedLines: 0 });
});

it('preserves literal paths with spaces and ignores paths mentioned in tool output', async () => {
  const workspace = join(scratch, 'workspace with spaces');
  await mkdir(workspace);
  const event = command(`/bin/bash -lc 'cat "${join(workspace, 'data.json')}"'`, workspace);
  event.item.aggregated_output = '/another/path';
  expect(await auditTranscript(jsonl(event), workspace)).toEqual({ void: false, paths: [], malformedLines: 0 });
});

it('reads observed metadata without substituting requested values', async () => {
  const sessionDirectory = join(scratch, '2026', '11', '19');
  const events = jsonl({ type: 'thread.started', thread_id: 'thread-id' });
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(join(sessionDirectory, 'rollout-day-thread-id.jsonl'), jsonl(
    { type: 'turn_context', payload: { model: 'codex-observed', effort: 'high' } },
  ));
  expect(await observeAgent('codex', events, scratch)).toEqual({ model: 'codex-observed', effort: 'high', threadId: 'thread-id' });
  expect(await observeAgent('claude', jsonl(claude('Read', { file_path: 'data.json' }, 'claude-observed'))))
    .toEqual({ model: 'claude-observed', effort: null });
});

it('passes the non-interactive flags without shell interpolation', () => {
  expect(agentArgs('codex', { workspace: scratch, model: 'requested-codex', effort: 'high' })).toEqual([
    'exec', '-m', 'requested-codex', '-c', 'model_reasoning_effort="high"', '-s', 'workspace-write',
    '--skip-git-repo-check', '-C', scratch, '--json', '-',
  ]);
  expect(agentArgs('claude', { workspace: scratch, model: 'requested-claude' })).toEqual([
    '-p', '--model', 'requested-claude', '--output-format', 'stream-json', '--verbose', '--allowedTools',
    'Read,Write,Edit,Glob,Grep,Bash(node:*),Bash(ls:*),Bash(cat:*)',
  ]);
});

it('captures stdout and stderr from a local fixture executable and stops it on timeout', async () => {
  const bin = join(scratch, 'bin');
  const workspace = join(scratch, 'workspace');
  const timedRun = join(scratch, 'timed');
  await Promise.all([mkdir(bin), mkdir(workspace), mkdir(timedRun)]);
  await writeFile(join(workspace, 'PROMPT.md'), 'Prompt from stdin\n');
  const executable = join(bin, 'codex');
  await writeFile(executable, '#!/bin/sh\nIFS= read -r prompt\nprintf "%s" "$prompt"\nprintf "%s" "stderr" >&2\n', { mode: 0o700 });
  vi.stubEnv('PATH', bin);
  const options = { workspace, runDirectory: scratch, model: 'fixture-executable', timeoutMs: 5000 };
  const finished = await runAgent('codex', options);
  expect(finished.exit).toEqual({ code: 0, signal: null, timedOut: false, error: null });
  expect(await readFile(finished.transcript, 'utf8')).toBe('Prompt from stdin');
  expect(await readFile(finished.stderr, 'utf8')).toBe('stderr');

  await writeFile(executable, '#!/bin/sh\nexec /bin/sleep 10\n');
  const stopped = await runAgent('codex', { ...options, runDirectory: timedRun, timeoutMs: 100 });
  expect(stopped.exit).toEqual({ code: null, signal: 'SIGTERM', timedOut: true, error: null });
});

it('prepares a clean workspace from the packed package and the published docs', async () => {
  await expect(prepareWorkspace(join(repository, 'rehearsal', 'would-create'), 'daily-visits'))
    .rejects.toThrow('--workdir must be outside the repository.');
  const { workspace } = await prepareWorkspace(scratch, 'daily-visits');
  expect((await readdir(workspace)).sort()).toEqual(['PROMPT.md', 'data.json', 'docs', 'node_modules', 'package.json']);
  expect(JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'))).toEqual({ type: 'module' });
  await access(join(workspace, 'node_modules/axylo/dist/axylo.js'));
  await access(join(workspace, 'docs/getting-started.html'));
  await access(join(workspace, 'docs/source/apps/docs/examples/daily-sessions.ts.html'));
  await expect(access(join(workspace, 'docs/source/packages'))).rejects.toHaveProperty('code', 'ENOENT');
});

it('records a missing chart without opening Chrome', async () => {
  const result = await grade(scratch, 'daily-visits', {
    launch: () => { throw new Error('Chrome should only be opened for a bundle.'); },
  });
  expect(result.criteria).toEqual([{ name: 'render', pass: false, detail: 'chart.js is missing.' }]);
  expect(JSON.parse(await readFile(join(scratch, 'grade.json'), 'utf8'))).toEqual(result);
});

it('bundles the packed browser entry before reporting a Chrome launch failure', async () => {
  const { workspace } = await prepareWorkspace(scratch, 'signups');
  await writeFile(join(workspace, 'chart.js'), `
    import { line } from 'axylo';
    export default function render(element, data) {
      return line(element, { data, x: 'day', y: 'signpus', title: 'Daily signups' });
    }
  `);
  const result = await grade(workspace, 'signups', {
    launch: () => { throw new Error('Chrome unavailable in this test.'); },
  });
  expect(result.criteria).toEqual([{ name: 'browser', pass: false, detail: 'Error: Chrome unavailable in this test.' }]);
});
