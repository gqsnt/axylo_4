import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside } from './files.mjs';

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
  const paths = /(?<![\w./:-])(?:file:\/\/\/|~\/|\$(?:HOME|\{HOME\})\/|\.\.?\/|\/)[^\s"'\x60;&|<>()[\]{}*,]*|(?<!\S)(?:~|\$(?:HOME|\{HOME\}))(?=$|[\s;&|])/g;
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
    if (/^(?:file:\/\/|[~/]|\.\.?\/)[^;&|<>()[\]{}"'\n]*$/.test(quoted) && !/\s[-/]/.test(quoted)) {
      yield quoted;
    } else {
      yield * commandPaths(quoted);
    }
    offset = match.index + match[0].length;
  }
  yield * unquotedPaths(command.slice(offset));
}

function localPath(text, base, home) {
  if (text.startsWith('file://')) {
    try { return fileURLToPath(text); } catch { return undefined; }
  }
  if (/^[\w+.-]+:\/\//.test(text)) return undefined;
  return resolve(base, text.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, () => home));
}

async function resolveLinks(file) {
  try {
    return await realpath(file);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    const parent = dirname(file);
    return parent === file ? file : resolve(await resolveLinks(parent), file.slice(parent === '/' ? 1 : parent.length + 1));
  }
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

export async function auditTranscript(transcript, workspace, agent, home = workspace) {
  workspace = await realpath(workspace);
  const paths = new Set();
  const checked = new Set();
  const { events, malformedLines } = transcriptEvents(transcript);
  const completeTranscript = complete(events, agent);
  const unavailable = events.length === 0 ? 'No transcript events.' : malformedLines
    ? `${malformedLines} malformed transcript line(s).` : !completeTranscript ? 'Incomplete transcript lifecycle.' : null;
  const externalTools = new Set();
  let unparseableInput = false;

  async function check(text, base) {
    if (!text || text === '-') return;
    const path = localPath(text, base, home);
    if (!path || checked.has(path)) return;
    checked.add(path);
    if (await systemTool(path)) return;
    if (!inside(workspace, path)) {
      paths.add(path);
      return;
    }
    const actual = await resolveLinks(path);
    if (!inside(workspace, actual) && !await systemTool(actual)) paths.add(actual);
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
    const directory = typeof cwd === 'string' ? localPath(cwd, base, home) ?? base : base;
    // One recorded external working directory is enough, without treating every shell word as a path there.
    if (!inside(workspace, directory)) return;
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
    paths.size && 'Recorded paths outside the workspace.',
    externalTools.size && 'Recorded excluded tool use.',
  ].filter(Boolean);
  const status = unavailable || unparseableInput ? 'unverifiable' : problems.length ? 'outside policy' : 'no findings';
  return { status, paths: [...paths].sort(), tools: [...externalTools].sort(), malformedLines, problems };
}
