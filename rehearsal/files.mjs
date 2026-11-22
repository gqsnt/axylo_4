import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const rehearsal = fileURLToPath(new URL('.', import.meta.url));
export const repository = fileURLToPath(new URL('..', import.meta.url));
export const tasks = ['daily-visits', 'regional-sales', 'signups', 'daily-revenue'];

export function inside(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

export function taskFiles(task) {
  if (!task || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task)) throw new Error('Supply a task ID from rehearsal/prompts.');
  return {
    prompt: join(rehearsal, 'prompts', task + '.md'),
    fixture: join(rehearsal, 'fixtures', task + '.json'),
    expected: join(rehearsal, 'fixtures', task + '.expected.json'),
    alternate: join(rehearsal, 'fixtures', task + '.alternate.json'),
    alternateExpected: join(rehearsal, 'fixtures', task + '.alternate.expected.json'),
    ...(task === 'daily-revenue' ? {
      grammar: join(rehearsal, 'fixtures', 'daily-revenue.grammar.json'),
      grammarExpected: join(rehearsal, 'fixtures', 'daily-revenue.grammar.expected.json'),
    } : {}),
  };
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function isMain(url) {
  return !!process.argv[1] && pathToFileURL(process.argv[1]).href === url;
}
