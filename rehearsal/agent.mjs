import { execFile, spawn } from 'node:child_process';
import { open, readdir, readFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { transcriptEvents } from './audit.mjs';

const exec = promisify(execFile);
const fileTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

export function agentArgs(agent, { model, effort, workspace, anthropicApiKey }) {
  if (agent === 'codex') {
    return ['-a', 'never', 'exec', '-m', model, '-c', 'model_reasoning_effort=' + JSON.stringify(effort),
      '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'web_search="disabled"', '--disable', 'apps', '--disable', 'plugins', '--disable', 'memories',
      '--disable', 'hooks', '--disable', 'multi_agent_v2', '--disable', 'skill_mcp_dependency_install',
      '--enable', 'skip_host_skill_discovery', '--ignore-user-config', '--ignore-rules',
      '--skip-git-repo-check', '-C', workspace, '--json', '-'];
  }
  return ['-p', '--model', model, '--effort', effort, '--output-format', 'stream-json', '--verbose',
    ...(anthropicApiKey ? ['--bare'] : []), '--restricted', '--safe-mode', '--no-chrome', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
    '--tools', [...fileTools, 'Bash'].join(','), '--allowedTools', [...fileTools, 'Bash(node *)'].join(','),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none'];
}

function agentEnvironment(agent, { home, codexHome, claudeConfigDir, temporary, anthropicApiKey }) {
  const path = process.env.PATH?.split(delimiter).filter(isAbsolute).join(delimiter);
  const env = { PATH: path, LANG: process.env.LANG, HOME: home, TMPDIR: temporary };
  if (agent === 'codex') env.CODEX_HOME = codexHome;
  if (agent === 'claude') {
    env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    if (anthropicApiKey) env.ANTHROPIC_API_KEY = anthropicApiKey;
    else env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  }
  return env;
}

export async function agentVersion(agent, options) {
  const { stdout } = await exec(agent, ['--version'], {
    cwd: options.workspace, env: agentEnvironment(agent, options), timeout: 5000,
  });
  const version = stdout.trim();
  if (!version) throw new Error(`${agent} --version returned no version.`);
  return version;
}

export async function runAgent(agent, options) {
  const { workspace, runDirectory, timeoutMs } = options;
  const transcript = join(runDirectory, 'transcript.jsonl');
  const stderr = join(runDirectory, 'stderr.log');
  const args = agentArgs(agent, options);
  const handles = [];
  let exit;
  try {
    for (const [name, flags] of [[join(workspace, 'PROMPT.md'), 'r'], [transcript, 'wx'], [stderr, 'wx']]) {
      handles.push(await open(name, flags));
    }
    exit = await new Promise(resolve => {
      const grouped = process.platform !== 'win32';
      const child = spawn(agent, args, {
        cwd: workspace,
        env: agentEnvironment(agent, options),
        stdio: handles.map(handle => handle.fd),
        detached: grouped,
      });
      let timedOut = false;
      let spawnError = null;
      let force;
      const stop = signal => {
        if (!child.pid) return;
        try {
          if (grouped) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (error) {
          if (error.code !== 'ESRCH') spawnError ??= String(error);
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop('SIGTERM');
        force = setTimeout(() => stop('SIGKILL'), 2000);
      }, timeoutMs);
      child.on('error', error => { spawnError = String(error); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        clearTimeout(force);
        // A command left running in this group could keep mutating the delivered files.
        stop('SIGKILL');
        resolve({ code, signal, timedOut, error: spawnError });
      });
    });
  } finally {
    await Promise.all(handles.map(handle => handle.close()));
  }
  return { transcript, stderr, exit, args };
}

export function reportedError(transcript) {
  const last = transcriptEvents(transcript).events.at(-1);
  if (last?.type === 'turn.failed') return last.error?.message ?? 'Codex reported a failed turn.';
  if (last?.type === 'result' && last.is_error) {
    return (Array.isArray(last.errors) ? last.errors.join(' | ') : last.result) || last.subtype || 'Claude reported a failed turn.';
  }
  return null;
}

export async function observeAgent(agent, transcript, codexHome) {
  const { events } = transcriptEvents(transcript);
  const observed = { model: null, effort: null };
  if (agent === 'claude') {
    const models = [...new Set(events.filter(event => event.type === 'assistant').map(event => event.message?.model)
      .filter(model => typeof model === 'string' && model !== '<synthetic>'))];
    return { ...observed, model: models.at(-1) ?? null, models };
  }

  const threadId = events[0]?.type === 'thread.started' ? events[0].thread_id : null;
  if (!threadId || !/^[\w-]+$/.test(threadId)) return observed;
  observed.threadId = threadId;
  try {
    const entries = await readdir(join(codexHome, 'sessions'), { recursive: true, withFileTypes: true });
    const rollout = entries.find(entry => entry.isFile() && entry.name.startsWith('rollout-') &&
      entry.name.endsWith('-' + threadId + '.jsonl'));
    if (!rollout) return { ...observed, detail: 'No rollout found for this Codex thread.' };
    const { events: session, malformedLines } = transcriptEvents(await readFile(join(rollout.parentPath, rollout.name), 'utf8'));
    const contexts = session.filter(event => event.type === 'turn_context').map(event => event.payload);
    const settings = contexts.map(turn => [turn?.model ?? null, turn?.effort ?? turn?.reasoning_effort ?? turn?.model_reasoning_effort ?? null]);
    if (malformedLines || new Set(settings.map(setting => JSON.stringify(setting))).size !== 1) {
      return { ...observed, detail: 'Could not verify consistent turn_context settings in the Codex rollout.' };
    }
    [observed.model, observed.effort] = settings.at(-1);
  } catch (error) {
    observed.detail = 'Could not read Codex rollout metadata: ' + (error.code ?? error.message);
  }
  return observed;
}
