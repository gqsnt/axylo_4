import { constants } from 'node:fs';
import { access, readlink, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inside, repository } from './files.mjs';
import { commandPaths } from './shell.mjs';

export const auditVersion = 2;
const fileTools = { Read: 'file_path', Write: 'file_path', Edit: 'file_path', Glob: 'path', Grep: 'path' };

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

function localPath(text, base, directories, bare) {
  if (typeof text !== 'string' || !text || text === '/' || text === '-' || /[\0\n\r<>]/.test(text)) return;
  if (text.startsWith('file:')) {
    try { return fileURLToPath(new URL(text, pathToFileURL(base + '/'))); } catch { return; }
  }
  if (/^[\w+.-]+:/.test(text) || /^\/[\\^]/.test(text)) return;
  if (/^\/(?:\\.|[^/\\])+\/[dgimsuvy]*$/.test(text) && /[\\^$*+?()[\]{}|]/.test(text)) return;
  const path = text.replace(/^(?:~|\$(?:\{([A-Z_]+)\}|([A-Z_]+)))(?=\/|$)/,
    (prefix, braced, plain) => directories[braced ?? plain ?? 'HOME'] ?? prefix);
  if (path.startsWith('$') || (!bare && !path.includes('/'))) return;
  // Preserve ".." until symlinks have been resolved in filesystem order.
  return isAbsolute(path) ? path : base + '/' + path;
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

export function auditHasPathViolation(audit) {
  return Boolean(audit.linkedLogin ||
    audit.paths.some(path => !audit.outsidePaths?.some(look => look.path === path && !look.exists)));
}

export function auditAllowsGrade(audit) {
  return audit.status === 'no findings' || audit.status === 'looked outside the workspace';
}

export async function auditTranscript(transcript, { workspace, runDirectory, home = workspace, codexHome, claudeConfigDir,
  temporary, loginLink, realHome = homedir(), repo = repository, pathEvidence = {} }, agent) {
  const forbidden = new Set();
  const looks = new Map();
  const checked = new Set();
  const { events, malformedLines } = transcriptEvents(transcript);
  const completeTranscript = complete(events, agent);
  const unavailable = events.length === 0 ? 'No transcript events.' : malformedLines
    ? `${malformedLines} malformed transcript line(s).` : !completeTranscript ? 'Incomplete transcript lifecycle.' : null;
  const denied = new Set(events.filter(event => event.type === 'system' && event.subtype === 'permission_denied')
    .map(event => event.tool_use_id).filter(Boolean));
  const finalDenials = events.at(-1)?.permission_denials;
  for (const denial of Array.isArray(finalDenials) ? finalDenials : []) {
    if (denial?.tool_use_id) denied.add(denial.tool_use_id);
  }
  const externalTools = new Set();
  let unparseableInput = false;
  let linkedLogin;

  function toPath(text, base, bare) {
    return localPath(text, base, { HOME: home, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeConfigDir,
      TMPDIR: temporary, PWD: resolve(base) }, bare);
  }

  function forbiddenZone(path) {
    return !inside(runDirectory, path) && (inside(repo, path) || inside(realHome, path) ||
      /(?:^|\/)axylo-rehearsal-[A-Za-z0-9]{6}(?:\/|$)/.test(path));
  }

  async function check(path) {
    if (!path || checked.has(path)) return;
    checked.add(path);
    const direct = resolve(path);
    if (forbiddenZone(direct)) forbidden.add(direct);
    // Saved observations let replay classify links from the removed workspace and preserve the outside existence check.
    const info = pathEvidence[path] ??= await resolveLinks(path, loginLink);
    if (info.readLogin) {
      linkedLogin = info.path;
    } else if (forbiddenZone(info.path)) {
      forbidden.add(info.path);
    } else if ((!inside(runDirectory, info.path) || !inside(runDirectory, direct)) && !forbidden.has(direct)) {
      info.systemTool ??= await systemTool(direct) || await systemTool(info.path);
      if (info.systemTool) return;
      info.exists ??= await stat(info.path).then(() => true, error => {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
        throw error;
      });
      const outside = inside(runDirectory, direct) ? info.path : direct;
      looks.set(outside, (looks.get(outside) ?? false) || info.exists);
    }
  }

  async function shell(command, cwd) {
    if (typeof command !== 'string') {
      unparseableInput = true;
      return;
    }
    const directory = toPath(cwd, workspace, true);
    await check(directory);
    try {
      for (const path of commandPaths(command, directory ?? (cwd === '/' ? cwd : workspace), toPath)) await check(path);
    } catch (error) {
      if (error.message !== 'Unterminated shell word.') throw error;
      unparseableInput = true;
    }
  }

  for (const event of events) {
    const item = event.item;
    if (['web_search', 'mcp_tool_call'].includes(item?.type)) externalTools.add(item.type);
    if (item?.type === 'command_execution') await shell(item.command, item.cwd ?? item.workdir);
    if (item?.type === 'file_change') {
      if (!Array.isArray(item.changes)) unparseableInput = true;
      else for (const change of item.changes) await check(toPath(change?.path, workspace, true));
    }
    const content = event.type === 'assistant' ? event.message?.content : undefined;
    if (content !== undefined && !Array.isArray(content)) unparseableInput = true;
    const tools = event.type === 'tool_use' ? [event] : Array.isArray(content)
      ? content.filter(part => part?.type === 'tool_use') : [];
    for (const tool of tools) {
      if (!Object.hasOwn(fileTools, tool.name) && tool.name !== 'Bash') {
        externalTools.add(tool.name ?? '(unknown)');
        continue;
      }
      if (denied.has(tool.id)) continue;
      const { input } = tool;
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        unparseableInput = true;
      } else if (tool.name === 'Bash') {
        await shell(input.command, input.cwd ?? input.workdir);
      } else {
        await check(toPath(input[fileTools[tool.name]], workspace, true));
      }
    }
  }
  const outsidePaths = [...looks].filter(([path]) => !forbidden.has(path)).sort(([a], [b]) => a.localeCompare(b))
    .map(([path, exists]) => ({ path, exists }));
  const problems = [
    unavailable ?? (unparseableInput ? 'Unparseable tool input.' : null),
    forbidden.size && 'Recorded forbidden paths outside the attempt run directory.',
    outsidePaths.length && 'Looked outside the workspace.',
    linkedLogin && 'Recorded attempt to read the linked login.',
    externalTools.size && 'Recorded excluded tool use.',
  ].filter(Boolean);
  const status = unavailable || unparseableInput ? 'unverifiable' :
    forbidden.size || outsidePaths.some(look => look.exists) || linkedLogin || externalTools.size ? 'outside policy' :
      outsidePaths.length ? 'looked outside the workspace' : 'no findings';
  return { status, paths: [...forbidden, ...outsidePaths.map(look => look.path)].sort(), ...(outsidePaths.length ? { outsidePaths } : {}),
    ...(linkedLogin ? { linkedLogin } : {}), tools: [...externalTools].sort(), malformedLines, problems };
}
