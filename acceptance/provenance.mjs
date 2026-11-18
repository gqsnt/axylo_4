import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const kinds = new Set(['unit', 'property', 'browser']);
const sha = value => createHash('sha256').update(value).digest('hex');

export const hashFile = file => sha(readFileSync(file));

export function citedTestFiles(matrix) {
  const files = new Set();
  for (const row of matrix) {
    for (const citations of [row.evidence, row.weak]) {
      for (const refs of Object.values(citations ?? {})) {
        for (const { kind, file } of refs) if (kinds.has(kind)) files.add(file);
      }
    }
  }
  return [...files].sort();
}

export function snapshot(root, files) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
  const commit = git('rev-parse', 'HEAD').trim();
  const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':(exclude)acceptance/report.md');
  const tree = createHash('sha256').update(status);
  // A dirty flag alone cannot distinguish two edits to the same library file.
  const changed = new Set(git('ls-files', '-m', '-o', '--exclude-standard', '-z').split('\0'));
  for (const file of [...changed].sort()) {
    if (!file || file === 'acceptance/report.md') continue;
    const path = resolve(root, file);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    const content = stat?.isSymbolicLink() ? readlinkSync(path) : stat?.isFile() ? readFileSync(path) : '';
    tree.update(JSON.stringify([file, stat?.mode, sha(content)]));
  }
  // Include edits staged against HEAD even when the index matches the working file.
  tree.update(git('diff', '--cached', '--binary', 'HEAD', '--', '.', ':(exclude)acceptance/report.md'));
  const hashes = Object.fromEntries(files.map(file => [file, hashFile(resolve(root, file))]));
  return { commit, dirty: status.length > 0, tree: tree.digest('hex'), hashes };
}
