import { access, chmod, copyFile, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentArgs, agentErrors, agentVersion, observeAgent, runAgent } from '../agent.mjs';
import { auditTranscript } from '../audit.mjs';
import { readJson, repository } from '../files.mjs';
import { grade } from '../grade.mjs';
import { cells, effort, models, nextAttempts, protocol, readRecords, summarize, timeoutMs } from '../protocol.mjs';
import { attempt, runBatch } from '../run.mjs';
import { formatSummary } from '../summary.mjs';
import { prepareWorkspace, removeWorkspace } from '../workspace.mjs';

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal();
  return { ...fs, open: vi.fn(fs.open), readFile: vi.fn(fs.readFile), copyFile: vi.fn(fs.copyFile), cp: vi.fn(fs.cp) };
});

const jsonl = (...events) => events.map(event => JSON.stringify(event)).join('\n');
const codexStart = { type: 'thread.started', thread_id: 'thread-id' };
const codexLog = (...events) => jsonl(codexStart, { type: 'turn.started' }, ...events, { type: 'turn.completed' });
const claudeInit = { type: 'system', subtype: 'init' };
const claudeLog = (...events) => jsonl(claudeInit, ...events, { type: 'result', is_error: false });
const command = (text, cwd) => ({ type: 'item.completed', item: { type: 'command_execution', command: text, cwd } });
const claude = (name, input, model = models.claude) => ({
  type: 'assistant', message: { model, content: [{ type: 'tool_use', name, input }] },
});
const expiredLogin = 'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again…';
const expiredLoginLog = jsonl(claudeInit,
  { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: expiredLogin }] } },
  { type: 'result', subtype: 'success', is_error: true, result: expiredLogin });

let scratch;
const workspaces = [];
beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'axylo-rehearsal-test-')); });
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of workspaces.splice(0)) await removeWorkspace(directory);
  await rm(scratch, { recursive: true, force: true });
});

async function workspaceFor(task, options) {
  const prepared = await prepareWorkspace(scratch, task, options);
  workspaces.push(prepared.runDirectory);
  return prepared;
}

it('audits complete Codex and Claude logs while allowing the copied docs and system tools', async () => {
  const codex = codexLog(command("/bin/bash -lc 'cat docs/getting-started.html; node ./chart.js'", scratch),
    { type: 'item.completed', item: { type: 'agent_message', text: 'I did not read /home/user/notes.txt.' } });
  expect(await auditTranscript(codex, scratch, 'codex')).toEqual({
    status: 'no findings', paths: [], tools: [], malformedLines: 0, problems: [],
  });
  const log = claudeLog(claude('Read', { file_path: join(scratch, 'data.json') }));
  expect(await auditTranscript(log, scratch, 'claude')).toMatchObject({ status: 'no findings' });
});

it('voids recorded reads of Axylo source, even in otherwise complete transcripts', async () => {
  const source = join(repository, 'packages/axylo/src/index.ts');
  expect(await auditTranscript(codexLog(command(`/bin/bash -lc 'cat "${source}"'`, scratch)), scratch, 'codex'))
    .toMatchObject({ status: 'outside policy', paths: [source] });
  expect(await auditTranscript(claudeLog(claude('Read', { file_path: source })), scratch, 'claude'))
    .toMatchObject({ status: 'outside policy', paths: [source] });
});

it('follows recorded relative paths and symlinks out of the workspace', async () => {
  const workspace = join(scratch, 'workspace');
  const outside = join(scratch, 'other.txt');
  await mkdir(workspace);
  await writeFile(outside, '');
  await symlink(outside, join(workspace, 'linked.txt'));
  expect(await auditTranscript(codexLog(command('cat linked.txt', workspace)), workspace, 'codex'))
    .toMatchObject({ status: 'outside policy', paths: [outside] });
  expect(await auditTranscript(claudeLog(claude('Read', { file_path: '../other.txt' })), workspace, 'claude'))
    .toMatchObject({ status: 'outside policy', paths: [outside] });
});

it('preserves literal paths with spaces and ignores paths mentioned in tool output', async () => {
  const workspace = join(scratch, 'workspace with spaces');
  await mkdir(workspace);
  const event = command(`/bin/bash -lc 'cat "${join(workspace, 'data.json')}"'`, workspace);
  event.item.aggregated_output = '/another/path';
  expect(await auditTranscript(codexLog(event), workspace, 'codex')).toMatchObject({ status: 'no findings' });
});

it.each([
  ['codex', '', 0],
  ['codex', codexLog() + '\n{', 1],
  ['codex', jsonl(codexStart, { type: 'turn.started' }), 0],
  ['codex', codexLog({ type: 'item.started', item: { id: 'incomplete' } }), 0],
  ['codex', '[]\n{}\nnull\n', 3],
  ['claude', jsonl(claudeInit, claude('Read', { file_path: 'data.json' })), 0],
  ['claude', claudeLog({ type: 'assistant', message: { content: 'unexpected' } }), 0],
])('marks %s transcript %j unverifiable', async (agent, log, malformedLines) => {
  expect(await auditTranscript(log, scratch, agent)).toMatchObject({ status: 'unverifiable', malformedLines });
});

it('flags excluded web tools in either transcript', async () => {
  const codex = codexLog({ type: 'item.completed', item: { type: 'web_search', query: 'Axylo' } });
  const log = claudeLog(claude('WebFetch', { url: 'https://example.com' }));
  expect(await auditTranscript(codex, scratch, 'codex')).toMatchObject({ status: 'outside policy', tools: ['web_search'] });
  expect(await auditTranscript(log, scratch, 'claude')).toMatchObject({ status: 'outside policy', tools: ['WebFetch'] });
});

it('reads observed metadata from the isolated Codex rollout and the Claude stream', async () => {
  const sessionDirectory = join(scratch, 'sessions', '2026', '11', '19');
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(join(sessionDirectory, 'rollout-day-thread-id.jsonl'), jsonl(
    { type: 'turn_context', payload: { model: 'codex-observed', effort: 'high' } },
  ));
  expect(await observeAgent('codex', codexLog(), scratch)).toEqual({ model: 'codex-observed', effort: 'high', threadId: 'thread-id' });
  expect(await observeAgent('codex', codexLog(), join(scratch, 'unused'))).toMatchObject({ model: null, effort: null });
  const log = claudeLog(claude('Read', { file_path: 'data.json' }, 'claude-observed'));
  expect(await observeAgent('claude', log)).toEqual({ model: 'claude-observed', effort: null, models: ['claude-observed'] });
});

it('uses the same effort, restricts tools, and disables workspace reuse and web access where the flags allow', () => {
  const args = (agent, anthropicApiKey) => agentArgs(agent, { workspace: scratch, model: models[agent], effort, anthropicApiKey });
  expect(args('codex')).toEqual(expect.arrayContaining(['-a', 'never', '-s', 'workspace-write',
    'model_reasoning_effort="xhigh"', 'sandbox_workspace_write.network_access=false', 'web_search="disabled"',
    '--disable', 'apps', 'memories', '--ignore-user-config', '--skip-git-repo-check', '-C', scratch, '--json']));
  const flags = args('claude', 'fixture-key');
  expect(flags).toEqual(expect.arrayContaining(['--bare', '--restricted', '--strict-mcp-config',
    '--no-session-persistence', '--effort', 'xhigh', '--permission-mode', 'dontAsk', '--permission-prompts', 'none']));
  expect(flags[flags.indexOf('--tools') + 1]).toBe('Read,Write,Edit,Glob,Grep,Bash');
  expect(flags[flags.indexOf('--allowedTools') + 1]).toBe('Read,Write,Edit,Glob,Grep,Bash(node *)');
});

it.each([
  ['bare', 'fixture-key'],
  ['fresh-config', undefined],
])('runs Claude in %s mode with isolated config and records the audit', async (claudeMode, key) => {
  const realHome = join(scratch, 'login-home');
  const realConfig = join(realHome, '.claude');
  const login = join(realConfig, '.credentials.json');
  const bin = join(scratch, 'bin');
  const records = join(scratch, 'records');
  await Promise.all([mkdir(realConfig, { recursive: true }), mkdir(bin), mkdir(records)]);
  await writeFile(login, 'fixture credential', { mode: 0o600 });
  await writeFile(join(realConfig, 'settings.json'), '{}');

  const assistantModel = `${models.claude}-20261119`;
  const log = jsonl({ ...claudeInit, model: 'advertised-in-init' },
    claude('Read', { file_path: 'data.json' }, assistantModel), { type: 'result', is_error: false });
  await writeFile(join(bin, 'claude'), `#!/bin/sh
set -e
export LC_ALL=C
link="$CLAUDE_CONFIG_DIR/.credentials.json"
target=
if [ -L "$link" ]; then target=$(readlink "$link"); fi
if [ "$1" = '--version' ]; then
  [ "\${ANTHROPIC_API_KEY+key}\${target:+link}" = '${key ? 'key' : 'link'}' ]
  echo fixture-version
  exit 0
fi
case "\${ANTHROPIC_API_KEY-unset}" in
  fixture-key) key_state=fixture ;;
  unset) key_state=unset ;;
  *) key_state=unexpected ;;
esac
{
  printf '%s\\n' "$HOME" "$CLAUDE_CONFIG_DIR" "$key_state" "\${CLAUDE_CODE_DISABLE_AUTO_MEMORY-unset}" "$target"
  ls -A "$CLAUDE_CONFIG_DIR" | paste -sd ' '
  ls -A . | paste -sd ' '
  printf '%s\\n' "$@"
} >&2
cat <<'TRANSCRIPT'
${log}
TRANSCRIPT
`, { mode: 0o700 });
  vi.stubEnv('HOME', realHome);
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(realHome, 'ignored-config'));
  vi.stubEnv('PATH', `${bin}:/usr/bin:/bin`);
  vi.stubEnv('ANTHROPIC_API_KEY', key);
  const fileOperations = [open, readFile, copyFile, cp];
  for (const operation of fileOperations) operation.mockClear();
  const result = await attempt({ agent: 'claude', task: 'signups', slot: 1, replaces: null }, {
    records, workdir: scratch, gradeAnswer: async () => ({ pass: true, criteria: [] }),
  });
  expect(result).toMatchObject({ status: 'pass', reason: null });
  const run = await readJson(join(result.record, 'run.json'));
  const stderr = await readFile(join(result.record, 'stderr.log'), 'utf8');
  const [home, config, childKey, autoMemory, target, configEntries, workspaceEntries, ...args] = stderr.split('\n').slice(0, -1);
  expect(run).toMatchObject({ claudeMode, audit: { status: 'no findings' },
    cli: { version: 'fixture-version', args }, requested: { effort },
    observed: { model: assistantModel, models: [assistantModel], effort: null }, effectiveEffort: null,
    effortEvidence: '--effort flag; stream does not expose effective effort' });
  expect(home).not.toBe(realHome);
  expect(config).toBe(join(home, '.claude'));
  expect(childKey).toBe(key ? 'fixture' : 'unset');
  expect(autoMemory).toBe(key ? 'unset' : '1');
  expect(target).toBe(key ? '' : login);
  expect(configEntries).toBe(key ? '' : '.credentials.json');
  expect(workspaceEntries).toBe('PROMPT.md data.json docs node_modules package.json');
  expect(args.includes('--bare')).toBe(Boolean(key));
  expect(args).toEqual(expect.arrayContaining(['--restricted', '--safe-mode', '--no-chrome', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
    '--tools', 'Read,Write,Edit,Glob,Grep,Bash', '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash(node *)',
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--effort', effort]));
  const workspace = join(home, '..', 'workspace');
  const transcript = join(home, '..', 'transcript.jsonl');
  const link = join(config, '.credentials.json');
  for (const [operation, expectedSource] of [[open, join(workspace, 'PROMPT.md')], [readFile, transcript],
    [copyFile, transcript], [cp, workspace]]) {
    expect(operation.mock.calls.map(([source]) => source)).toContain(expectedSource);
    const paths = operation.mock.calls.flat();
    expect(paths).not.toContain(login);
    expect(paths).not.toContain(link);
  }
  await expect(lstat(link)).rejects.toHaveProperty('code', 'ENOENT');
  await expect(access(home)).rejects.toHaveProperty('code', 'ENOENT');
  expect(await readFile(login, 'utf8')).toBe('fixture credential');
  expect((await stat(login)).mode & 0o777).toBe(0o600);
});

it('runs a local stub with fresh environment, captures both streams, and stops on timeout', async () => {
  const bin = join(scratch, 'bin');
  const { workspace, home, codexHome, ...prepared } = await workspaceFor('signups');
  const timedRun = join(scratch, 'timed');
  await Promise.all([mkdir(bin), mkdir(timedRun)]);
  const executable = join(bin, 'codex');
  await writeFile(executable, [
    '#!/bin/sh', 'if [ "$1" = "--version" ]; then echo fixture-version; exit 0; fi',
    'IFS= read -r prompt', 'printf "%s\\n" "$prompt" "$HOME" "$CODEX_HOME" "${TEST_SECRET-unset}"',
    'printf "%s" "stderr" >&2',
  ].join('\n') + '\n', { mode: 0o700 });
  vi.stubEnv('PATH', bin);
  vi.stubEnv('TEST_SECRET', 'parent value');
  const options = { ...prepared, workspace, home, codexHome, model: models.codex, effort, timeoutMs: 5000 };
  expect(await agentVersion('codex', options)).toBe('fixture-version');
  const finished = await runAgent('codex', options);
  expect(finished.exit).toEqual({ code: 0, signal: null, timedOut: false, error: null });
  expect((await readFile(finished.transcript, 'utf8')).split('\n').slice(1)).toEqual([home, codexHome, 'unset', '']);
  expect(await readFile(finished.stderr, 'utf8')).toBe('stderr');

  await writeFile(executable, '#!/bin/sh\nexec /bin/sleep 10\n');
  const stopped = await runAgent('codex', { ...options, runDirectory: timedRun, timeoutMs: 100 });
  expect(stopped.exit).toMatchObject({ code: null, signal: 'SIGTERM', timedOut: true, error: null });
});

it('prepares fresh read-only inputs, a writable answer area and a login symlink only', async () => {
  await expect(prepareWorkspace(join(repository, 'rehearsal', 'would-create'), 'daily-visits'))
    .rejects.toThrow('--workdir must be outside the repository.');
  const login = join(scratch, 'auth.json');
  await writeFile(login, 'fake login');
  const first = await workspaceFor('daily-visits', { codexLogin: login });
  const second = await workspaceFor('daily-visits', { codexLogin: login });
  expect(first.home).not.toBe(second.home);
  expect(await readdir(first.codexHome)).toEqual(['auth.json']);
  const link = join(first.codexHome, 'auth.json');
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
  expect(await readlink(link)).toBe(login);
  expect((await readdir(first.workspace)).sort()).toEqual(['PROMPT.md', 'data.json', 'docs', 'node_modules', 'package.json']);
  for (const path of ['docs', 'docs/getting-started.html', 'node_modules', 'node_modules/axylo/dist/axylo.js', 'data.json']) {
    expect((await stat(join(first.workspace, path))).mode & 0o222).toBe(0);
  }
  await access(join(first.workspace, 'docs/source/apps/docs/examples/daily-sessions.ts.html'));
  await expect(access(join(first.workspace, 'docs/source/packages'))).rejects.toHaveProperty('code', 'ENOENT');
  await writeFile(join(first.workspace, 'chart.js'), '// answer');
  await removeWorkspace(first.runDirectory);
  expect(await readFile(login, 'utf8')).toBe('fake login');
  await expect(access(first.runDirectory)).rejects.toHaveProperty('code', 'ENOENT');
});

it('records a missing chart without opening Chrome', async () => {
  const result = await grade(scratch, 'daily-visits', {
    launch: () => { throw new Error('Chrome should only be opened for a bundle.'); },
  });
  expect(result.criteria).toEqual([{ name: 'render', pass: false, detail: 'chart.js is missing.' }]);
  expect(await readJson(join(scratch, 'grade.json'))).toEqual(result);
});

it('bundles the packed browser entry and reports a Chrome launch failure', async () => {
  const { workspace } = await workspaceFor('signups');
  await writeFile(join(workspace, 'chart.js'), `
    import { line } from 'axylo';
    export default function render(element, data) {
      return line(element, { data, x: 'day', y: { field: 'signpus', label: 'Signups' }, title: 'Daily signups' });
    }
  `);
  const result = await grade(workspace, 'signups', {
    launch: () => { throw new Error('Chrome unavailable in this test.'); },
  });
  expect(result.criteria).toEqual([{ name: 'browser', pass: false, detail: 'Error: Chrome unavailable in this test.' }]);
});

it.each([
  ['pass', claudeLog(claude('Write', { file_path: 'chart.js' })), false, { pass: true, criteria: [] }],
  ['fail', claudeLog(claude('Write', { file_path: 'chart.js' })), false, { pass: false, criteria: [{ name: 'table rows' }] }],
  ['timeout', jsonl(claudeInit), true],
  ['void', jsonl(claudeInit, claude('Write', { file_path: 'chart.js' })), false],
  ['void', claudeLog(claude('Write', { file_path: 'data.json' })), false, undefined, true],
  ['infrastructure', claudeLog(claude('Write', { file_path: 'chart.js' })), false, { pass: false, criteria: [{ name: 'browser', detail: 'Chrome unavailable' }] }],
])('saves a %s attempt before cleaning up the workspace and home', async (status, log, timedOut, gradeResult, tamper) => {
  const records = join(scratch, 'records');
  await mkdir(records);
  let temporary;
  const result = await attempt({ agent: 'claude', task: 'signups', slot: 1, replaces: null }, {
    records, workdir: scratch, claudeLogin: join(scratch, '.credentials.json'), version: async () => 'fixture-version',
    launch: async (_, { workspace, runDirectory }) => {
      temporary = runDirectory;
      const transcript = join(runDirectory, 'transcript.jsonl');
      const stderr = join(runDirectory, 'stderr.log');
      await Promise.all([writeFile(transcript, log), writeFile(stderr, ''), writeFile(join(workspace, 'chart.js'), '// answer')]);
      if (tamper) {
        await chmod(join(workspace, 'data.json'), 0o600);
        await writeFile(join(workspace, 'data.json'), '[]');
      }
      return { transcript, stderr, exit: { code: timedOut ? null : 0, timedOut, error: null } };
    },
    gradeAnswer: async () => gradeResult,
  });
  const run = await readJson(join(result.record, 'run.json'));
  expect(run).toMatchObject({
    status, timeoutMs, cli: { version: 'fixture-version', args: expect.arrayContaining(['--effort', effort]) },
    hashes: { input: expect.stringMatching(/^[a-f0-9]{64}$/), alternate: expect.stringMatching(/^[a-f0-9]{64}$/),
      docs: expect.stringMatching(/^[a-f0-9]{64}$/), grader: expect.stringMatching(/^[a-f0-9]{64}$/) },
  });
  if (status === 'pass') expect(run.reason).toBeNull();
  else expect(run.reason).toEqual(expect.any(String));
  if (tamper) expect(run.reason).toBe('Staged inputs changed: input');
  expect(await readFile(join(result.record, 'answer', 'chart.js'), 'utf8')).toBe('// answer');
  expect(await readFile(join(result.record, 'transcript.jsonl'), 'utf8')).toBe(log);
  await expect(access(temporary)).rejects.toHaveProperty('code', 'ENOENT');
});

it.each([
  ['claude', 'expired login', expiredLoginLog, 1, 'infrastructure', expiredLogin],
  ['claude', 'API error without an assistant message', jsonl(claudeInit,
    { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['API Error: 503 Service Unavailable'] }),
  0, 'infrastructure', 'API Error: 503 Service Unavailable'],
  ['claude', 'zero exit before a model turn', jsonl(claudeInit), 0, 'infrastructure',
    'Agent exited with code 0 before a model turn.'],
  ['codex', 'startup error', jsonl(codexStart, { type: 'error', message: 'Failed to initialize the session.' }),
    1, 'infrastructure', 'Failed to initialize the session.'],
  ['codex', 'exit without an error event', jsonl(codexStart), 1, 'infrastructure',
    'Agent exited with code 1 before a model turn.'],
  ['codex', 'provider disconnect after starting a turn', jsonl(codexStart, { type: 'turn.started' },
    { type: 'error', message: 'Reconnecting... 5/5' },
    { type: 'turn.failed', error: { message: 'stream disconnected before completion' } }),
  1, 'infrastructure', 'stream disconnected before completion'],
  ['codex', 'authentication error after starting a turn', jsonl(codexStart, { type: 'turn.started' },
    { type: 'error', message: 'Unexpected status 401 Unauthorized' },
    { type: 'turn.failed', error: { message: 'Request failed.' } }),
  1, 'infrastructure', 'Unexpected status 401 Unauthorized'],
  ['codex', 'failed turn after model work', jsonl(codexStart, { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'I read the inputs.' } },
    { type: 'turn.failed', error: { message: 'Turn failed.' } }),
  1, 'fail', 'Turn failed.'],
])('classifies %s %s from the transcript and exit', async (agent, _, log, code, status, reason) => {
  const records = join(scratch, 'records');
  await mkdir(records);
  const login = join(scratch, 'auth.json');
  await writeFile(login, '{}');
  const gradeAnswer = vi.fn();
  const result = await attempt({ agent, task: 'signups', slot: 1, replaces: null }, {
    records, workdir: scratch, login, claudeLogin: join(scratch, '.credentials.json'),
    version: async () => 'fixture-version', gradeAnswer,
    launch: async (_, { runDirectory }) => {
      const transcript = join(runDirectory, 'transcript.jsonl');
      const stderr = join(runDirectory, 'stderr.log');
      await Promise.all([writeFile(transcript, log), writeFile(stderr, '')]);
      return { transcript, stderr, exit: { code, signal: null, timedOut: false, error: null } };
    },
  });
  expect(result).toMatchObject({ status, reason });
  expect(gradeAnswer).not.toHaveBeenCalled();
  const [record] = await readRecords(records);
  expect(record).toMatchObject({ status, reason, exit: { code } });
  const cell = { agent, task: 'signups' };
  expect(nextAttempts([record], cell, 1)).toEqual(
    status === 'infrastructure' ? [{ ...cell, slot: 1, replaces: record.name }] : []);
});

it('accepts a Codex turn that completed after a provider retry', () => {
  const transcript = codexLog({ type: 'error', message: 'Reconnecting: connection reset' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'I wrote the chart.' } });
  expect(agentErrors('codex', transcript, { code: 0, signal: null, timedOut: false, error: null }))
    .toEqual({ cliError: null });
});

it('reopens an older failed Claude slot using its recorded authentication error', async () => {
  const cell = { agent: 'claude', task: 'signups' };
  const name = 'expired-login-trial';
  const directory = join(scratch, name);
  await mkdir(directory);
  const original = { ...cell, protocol, slot: 1, status: 'fail', reason: expiredLogin,
    exit: { code: 1, signal: null, timedOut: false, error: null } };
  const file = join(directory, 'run.json');
  await Promise.all([writeFile(file, JSON.stringify(original)), writeFile(join(directory, 'transcript.jsonl'), expiredLoginLog)]);
  const records = await readRecords(scratch);
  expect(records).toEqual([{ ...original, name, status: 'infrastructure' }]);
  expect(nextAttempts(records, cell, 1)).toEqual([{ ...cell, slot: 1, replaces: name }]);
  expect(await readJson(file)).toEqual(original);
});

it('fills only unused, void and infrastructure slots while keeping failed and timed-out attempts', () => {
  const [cell] = cells;
  const records = ['void', 'fail', 'infrastructure', 'timeout'].map((status, i) =>
    ({ ...cell, protocol, status, name: status, slot: i + 1 }));
  expect(nextAttempts(records, cell, 5)).toEqual([
    { ...cell, slot: 1, replaces: 'void' },
    { ...cell, slot: 3, replaces: 'infrastructure' },
    { ...cell, slot: 5, replaces: null },
  ]);
});

it('limits batch concurrency and preserves job order', async () => {
  const jobs = [1, 2, 3, 4, 5];
  let open = 0;
  let highWater = 0;
  const results = await runBatch(jobs, 2, async value => {
    open++;
    highWater = Math.max(highWater, open);
    await new Promise(done => setImmediate(done));
    open--;
    return value * 2;
  });
  expect(results).toEqual([2, 4, 6, 8, 10]);
  expect(highWater).toBe(2);
});

function passingRecords() {
  return cells.flatMap(cell => [1, 2, 3].map(slot => ({
    ...cell, protocol, slot, status: 'pass', timeoutMs, requested: { model: models[cell.agent], effort },
    observed: { model: models[cell.agent], models: [models[cell.agent]], effort },
    hashes: { docs: 'docs', grader: 'grader', package: 'package' }, cli: { version: cell.agent }, browserVersion: 'fixture Chrome',
  })));
}

it('requires three distinct counted slots per cell and comparable records', () => {
  const records = passingRecords();
  expect(summarize([]).pass).toBe(false);
  expect(summarize(records).pass).toBe(true);
  expect(summarize([...records, { ...records[0], status: 'void' }]).pass).toBe(true);
  expect(summarize([...records, records[0]]).pass).toBe(false);
  expect(summarize([records[1], ...records.slice(1)]).rows[0].meetsRule).toBe(false);
  expect(summarize(records.slice(1)).rows[0].meetsRule).toBe(false);
  const changed = [{ ...records[0], hashes: { ...records[0].hashes, grader: 'different' } }, ...records.slice(1)];
  expect(summarize(changed)).toMatchObject({ comparable: false, pass: false });
});

it.each([
  [false, ['fail', 'timeout'], 1, 22, 1],
  [true, ['fail', 'pass'], 2, 23, 0],
])('prints the batch verdict %s, cell counts, totals and failure reasons', (pass, statuses, cellPasses, totalPasses, timeouts) => {
  const records = passingRecords().map((record, index) => {
    const status = statuses[index] ?? 'pass';
    return { ...record, name: `record-${index}`, status,
      reason: status === 'fail' ? 'table rows' : status === 'timeout' ? 'deadline' : null };
  });
  const summary = summarize(records);
  expect(summary.pass).toBe(pass);
  expect(summary.rows[0]).toMatchObject({ pass: cellPasses, attempts: 3, fail: 1, timeout: timeouts, meetsRule: pass });
  const output = formatSummary(records);
  const lines = output.split('\n');
  expect(lines.at(-1)).toBe(pass ? 'rehearsal rule met' : 'rehearsal rule not met');
  expect(output).toMatch(new RegExp(`^codex +daily-visits +${cellPasses} +3 +1 +${timeouts} +0 +0 +${pass ? 'yes' : 'no'}$`, 'm'));
  expect(output).toMatch(new RegExp(`^Total +${totalPasses} +24 +1 +${timeouts} +0 +0$`, 'm'));
  expect(lines).toContain('record-0: fail — table rows');
  if (timeouts) expect(lines).toContain('record-1: timeout — deadline');
});
