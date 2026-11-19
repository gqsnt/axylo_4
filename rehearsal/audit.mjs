import { constants } from 'node:fs';
import { access, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, repository } from './files.mjs';

export function transcriptEvents(transcript) {
  const events = [];
  let malformedLines = 0;
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event.type === 'string') events.push(event);
      else malformedLines++;
    } catch {
      malformedLines++;
    }
  }
  return { events, malformedLines };
}

function * toolInputs(event) {
  const item = event.item;
  if (item?.type === 'command_execution') yield { command: item.command, cwd: item.cwd ?? item.workdir };
  if (item?.type === 'file_change') yield { changes: item.changes };
  if (item?.type === 'mcp_tool_call') yield item.arguments ?? item.input;
  if (event.type === 'tool_use') yield event.input;
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    for (const part of event.message.content) {
      if (part?.type === 'tool_use') yield part.input;
    }
  }
}

function * unquotedPaths(command) {
  const paths = /(?<![\w./:-])(?:file:\/\/\/|~\/|\$(?:[A-Z_]+|\{[A-Z_]+\})\/|\.\.?\/|\/)[^\s"'\x60;&|<>()[\]{}*,]*|(?<!\S)(?:~|\$(?:[A-Z_]+|\{[A-Z_]+\}))(?=$|[\s;&|])/g;
  for (const match of command.matchAll(paths)) yield match[0];
  for (const match of command.matchAll(/(?<![\w./:-])[\w.-]+(?:\/[\w.-]+)*(?![\w./:-])/g)) yield match[0];
}

function * commandPaths(command) {
  if (typeof command !== 'string') return;
  let offset = 0;
  // Keep spaces in literal paths, and inspect commands quoted for a shell or Node's -e.
  for (const match of command.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) {
    yield * unquotedPaths(command.slice(offset, match.index));
    const quoted = match[1] ?? match[2];
    if (/^(?:file:\/\/|[~/]|\.\.?\/|\$(?:[A-Z_]+|\{[A-Z_]+\})(?=\/|$))[^;&|<>()[\]{}"'\n]*$/.test(quoted) && !/\s[-/]/.test(quoted)) {
      yield quoted;
    } else {
      yield * commandPaths(quoted);
    }
    offset = match.index + match[0].length;
  }
  yield * unquotedPaths(command.slice(offset));
}

function localPath(text, base, directories) {
  if (text.startsWith('file://')) {
    try { return fileURLToPath(text); } catch { return undefined; }
  }
  if (/^[\w+.-]+:\/\//.test(text)) return undefined;
  const path = text.replace(/^(?:~|\$(?:\{([A-Z_]+)\}|([A-Z_]+)))(?=\/|$)/,
    (prefix, braced, bare) => directories[braced ?? bare ?? 'HOME'] ?? prefix);
  return isAbsolute(path) ? path : `${base}/${path}`;
}

async function resolveLinks(file, loginLink) {
  const parts = file.split('/').reverse();
  let path = '/';
  let links = 0;
  // Walk in filesystem order so a dangling link or a link followed by ".." still counts.
  while (parts.length) {
    const part = parts.pop();
    if (!part || part === '.') continue;
    if (part === '..') {
      path = dirname(path);
      continue;
    }
    const next = join(path, part);
    if (next === loginLink) return { path: next, readLogin: true };
    const target = await readlink(next).catch(error => {
      if (!['EINVAL', 'ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    });
    if (target === undefined) {
      path = next;
    } else {
      if (++links > 40) throw new Error('Too many symbolic links: ' + file);
      if (isAbsolute(target)) path = '/';
      parts.push(...target.split('/').reverse());
    }
  }
  return { path, readLogin: false };
}

async function systemTool(file) {
  if (file === '/dev/null') return true;
  if (!/^\/(?:usr\/(?:local\/)?)?(?:bin|sbin)\/[^/]+$/.test(file)) return false;
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const pathKeys = /^(?:(?:file|target|source|destination|absolute|relative)[_-]?)?(?:path|paths|file|files|uri|uris)$|^(?:dir|directory|cwd|workdir|working_directory)$/i;
const commandKeys = /^(?:cmd|command|command_line|argv)$/i;

function complete(events, agent) {
  const last = events.at(-1);
  if (agent === 'claude') {
    return last?.type === 'result' && typeof last.is_error === 'boolean' &&
      events.slice(0, -1).some(event => event.type === 'system' && event.subtype === 'init');
  }
  if (events[0]?.type !== 'thread.started' || !events[0].thread_id ||
      !events.some(event => event.type === 'turn.started') ||
      !['turn.completed', 'turn.failed'].includes(last?.type)) return false;
  const openItems = new Set();
  for (const event of events) {
    if (event.type === 'item.started') openItems.add(event.item?.id);
    if (event.type === 'item.completed') openItems.delete(event.item?.id);
  }
  return openItems.size === 0;
}

export async function auditTranscript(transcript, { workspace, runDirectory, home = workspace, codexHome, claudeConfigDir,
  temporary, loginLink }, agent) {
  const directories = { HOME: home, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeConfigDir, TMPDIR: temporary };
  const realHome = homedir();
  const paths = new Set();
  const checked = new Set();
  const { events, malformedLines } = transcriptEvents(transcript);
  const completeTranscript = complete(events, agent);
  const unavailable = events.length === 0 ? 'No transcript events.' : malformedLines
    ? `${malformedLines} malformed transcript line(s).` : !completeTranscript ? 'Incomplete transcript lifecycle.' : null;
  const externalTools = new Set();
  let unparseableInput = false;
  let linkedLogin;

  async function check(text, base) {
    if (!text || text === '-') return;
    const path = localPath(text, base, directories);
    if (!path || checked.has(path)) return;
    checked.add(path);
    const directTool = await systemTool(path);
    if (!inside(runDirectory, path) && !directTool) {
      paths.add(resolve(path));
      return;
    }
    const { path: actual, readLogin } = await resolveLinks(path, loginLink);
    if (readLogin) {
      linkedLogin = actual;
      return;
    }
    if (inside(runDirectory, actual)) return;
    if ((directTool || await systemTool(actual)) && !inside(repository, actual) && !inside(realHome, actual)) return;
    paths.add(actual);
  }

  async function scan(value, base, key = '') {
    if (typeof value === 'string') {
      if (commandKeys.test(key)) {
        for (const path of commandPaths(value)) await check(path, base);
      } else if (pathKeys.test(key)) {
        await check(value, base);
      } else if (key === 'arguments') {
        try { value = JSON.parse(value); } catch { unparseableInput = true; return; }
        await scan(value, base);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const part of value) await scan(part, base, key);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const cwd = value.cwd ?? value.workdir ?? value.working_directory;
    if (typeof cwd === 'string') await check(cwd, base);
    const directory = typeof cwd === 'string' ? localPath(cwd, base, directories) ?? base : base;
    // One recorded external working directory is enough, without treating every shell word as a path there.
    if (!inside(runDirectory, directory)) return;
    for (const [name, part] of Object.entries(value)) {
      if (part !== cwd || (name !== 'cwd' && name !== 'workdir' && name !== 'working_directory')) {
        await scan(part, directory, name);
      }
    }
  }

  for (const event of events) {
    if (['web_search', 'mcp_tool_call'].includes(event.item?.type)) externalTools.add(event.item.type);
    const content = event.type === 'assistant' ? event.message?.content : undefined;
    if (content !== undefined && !Array.isArray(content)) unparseableInput = true;
    const tools = event.type === 'tool_use' ? [event] : Array.isArray(content)
      ? content.filter(part => part?.type === 'tool_use') : [];
    for (const tool of tools) {
      if (!['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'].includes(tool.name)) externalTools.add(tool.name ?? '(unknown)');
      if (!tool.input || typeof tool.input !== 'object' || Array.isArray(tool.input)) unparseableInput = true;
    }
    if (event.item?.type === 'command_execution' && typeof event.item.command !== 'string') unparseableInput = true;
    for (const input of toolInputs(event)) {
      if (typeof input === 'string') await scan(input, workspace, 'arguments');
      else await scan(input, workspace);
    }
  }
  const problems = [
    unavailable ?? (unparseableInput ? 'Unparseable tool input.' : null),
    paths.size && 'Recorded forbidden paths outside the attempt run directory.',
    linkedLogin && 'Recorded attempt to read the linked login.',
    externalTools.size && 'Recorded excluded tool use.',
  ].filter(Boolean);
  const status = unavailable || unparseableInput ? 'unverifiable' : problems.length ? 'outside policy' : 'no findings';
  return { status, paths: [...paths].sort(), ...(linkedLogin ? { linkedLogin } : {}),
    tools: [...externalTools].sort(), malformedLines, problems };
}
