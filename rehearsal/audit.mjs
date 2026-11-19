import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
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
      if (event && typeof event === 'object') events.push(event);
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
  if (event.type === 'assistant') {
    for (const part of event.message?.content ?? []) {
      if (part.type === 'tool_use') yield part.input;
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

function localPath(text, base) {
  if (text.startsWith('file://')) {
    try { return fileURLToPath(text); } catch { return undefined; }
  }
  if (/^[\w+.-]+:\/\//.test(text)) return undefined;
  return resolve(base, text.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir()));
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

export async function auditTranscript(transcript, workspace) {
  workspace = await realpath(workspace);
  const paths = new Set();
  const checked = new Set();
  const { events, malformedLines } = transcriptEvents(transcript);

  async function check(text, base) {
    if (!text || text === '-') return;
    const path = localPath(text, base);
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
        try { value = JSON.parse(value); } catch { return; }
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
    const directory = typeof cwd === 'string' ? localPath(cwd, base) ?? base : base;
    // One recorded external working directory is enough, without treating every shell word as a path there.
    if (!inside(workspace, directory)) return;
    for (const [name, part] of Object.entries(value)) {
      if (part !== cwd || (name !== 'cwd' && name !== 'workdir' && name !== 'working_directory')) {
        await scan(part, directory, name);
      }
    }
  }

  for (const event of events) {
    for (const input of toolInputs(event)) {
      if (typeof input === 'string') await scan(input, workspace, 'arguments');
      else await scan(input, workspace);
    }
  }
  return { void: paths.size > 0, paths: [...paths].sort(), malformedLines };
}
