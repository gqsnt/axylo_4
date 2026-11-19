import { spawn } from 'node:child_process';
import { open, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { transcriptEvents } from './audit.mjs';

const claudeTools = 'Read,Write,Edit,Glob,Grep,Bash(node:*),Bash(ls:*),Bash(cat:*)';

export function agentArgs(agent, { model, effort, workspace }) {
  if (agent === 'codex') {
    return ['exec', '-m', model, ...(effort ? ['-c', 'model_reasoning_effort=' + JSON.stringify(effort)] : []),
      '-s', 'workspace-write', '--skip-git-repo-check', '-C', workspace, '--json', '-'];
  }
  return ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', '--allowedTools', claudeTools];
}

export async function runAgent(agent, options) {
  const { workspace, runDirectory, timeoutMs } = options;
  const transcript = join(runDirectory, 'transcript.jsonl');
  const stderr = join(runDirectory, 'stderr.log');
  const handles = [];
  let exit;
  try {
    for (const [name, flags] of [[join(workspace, 'PROMPT.md'), 'r'], [transcript, 'wx'], [stderr, 'wx']]) {
      handles.push(await open(name, flags));
    }
    exit = await new Promise(resolve => {
      const grouped = process.platform !== 'win32';
      const child = spawn(agent, agentArgs(agent, options), {
        cwd: workspace,
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
        if (timedOut) stop('SIGKILL');
        resolve({ code, signal, timedOut, error: spawnError });
      });
    });
  } finally {
    await Promise.all(handles.map(handle => handle.close()));
  }
  return { transcript, stderr, exit };
}

export async function observeAgent(agent, transcript, sessions = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')) {
  const { events } = transcriptEvents(transcript);
  const observed = { model: null, effort: null };
  if (agent === 'claude') {
    const models = events.filter(event => event.type === 'assistant').map(event => event.message?.model)
      .filter(model => typeof model === 'string');
    return { ...observed, model: models.at(-1) ?? null };
  }

  const threadId = events[0]?.type === 'thread.started' ? events[0].thread_id : null;
  if (!threadId || !/^[\w-]+$/.test(threadId)) return observed;
  observed.threadId = threadId;
  try {
    const entries = await readdir(sessions, { recursive: true, withFileTypes: true });
    const rollout = entries.find(entry => entry.isFile() && entry.name.startsWith('rollout-') &&
      entry.name.endsWith('-' + threadId + '.jsonl'));
    if (!rollout) return { ...observed, detail: 'No rollout found for this Codex thread.' };
    const { events: session } = transcriptEvents(await readFile(join(rollout.parentPath, rollout.name), 'utf8'));
    const turn = session.findLast(event => event.type === 'turn_context')?.payload;
    observed.model = turn?.model ?? null;
    observed.effort = turn?.effort ?? turn?.reasoning_effort ?? turn?.model_reasoning_effort ?? null;
    if (!turn) observed.detail = 'No turn_context found in the Codex rollout.';
  } catch (error) {
    observed.detail = 'Could not read Codex rollout metadata: ' + (error.code ?? error.message);
  }
  return observed;
}
