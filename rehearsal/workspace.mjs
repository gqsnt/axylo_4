import { execFile } from 'node:child_process';
import { copyFile, cp, lstat, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { inside, repository, taskFiles } from './files.mjs';

const exec = promisify(execFile);
const sealedTrees = ['docs', 'node_modules'];
export const packedPackage = join(repository, 'tests/dist/.packed/axylo-0.0.0.tgz');

export async function removeWorkspace(runDirectory) {
  // Unseal only our copy so an ordinary user can remove its directories.
  for (const name of sealedTrees) {
    const path = join(runDirectory, 'workspace', name);
    const info = await lstat(path).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (info?.isDirectory()) await exec('chmod', ['-R', 'u+w', path]);
  }
  await rm(runDirectory, { recursive: true, force: true });
}

export async function prepareWorkspace(directory, task, { agent = 'codex', codexLogin, claudeLogin, inputHashes } = {}) {
  const { prompt, fixture, expected } = taskFiles(task);
  await stat(expected);

  const scratch = resolve(directory);
  const repo = await realpath(repository);
  // Check the nearest existing ancestor before creating any directories through a symlink.
  let ancestor = scratch;
  while (true) {
    try {
      if (inside(repo, await realpath(ancestor))) throw new Error('--workdir must be outside the repository.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = resolve(ancestor, '..');
    }
  }
  await mkdir(scratch, { recursive: true });
  const runDirectory = await mkdtemp(join(await realpath(scratch), 'axylo-rehearsal-'));
  const workspace = join(runDirectory, 'workspace');
  const home = join(runDirectory, 'home');
  const temporary = join(runDirectory, 'tmp');
  const codexHome = join(home, '.codex');
  const claudeConfigDir = join(home, '.claude');
  const docs = join(repository, 'apps/docs/dist');
  const installed = join(workspace, 'node_modules/axylo');
  let loginLink;
  try {
    await mkdir(installed, { recursive: true });
    await mkdir(temporary);
    if (agent === 'claude') {
      await mkdir(claudeConfigDir, { recursive: true });
      if (claudeLogin) {
        loginLink = join(claudeConfigDir, '.credentials.json');
        await symlink(resolve(claudeLogin), loginLink);
      }
    } else {
      await mkdir(codexHome, { recursive: true });
      if (codexLogin) {
        if (!(await stat(codexLogin)).isFile()) throw new Error('Codex login must be a file.');
        loginLink = join(codexHome, 'auth.json');
        await symlink(codexLogin, loginLink);
      }
    }
    await cp(docs, join(workspace, 'docs'), {
      recursive: true,
      async filter(file) {
        if ((await lstat(file)).isSymbolicLink()) return false;
        const path = relative(docs, file);
        // Linked public examples belong to the docs. Evidence links can point to internal source snapshots.
        return !path.startsWith('source/') || path === 'source/apps' || path === 'source/apps/docs' ||
          /^source\/(?:apps\/docs\/)?examples(?:\/|$)/.test(path);
      },
    });
    await exec('tar', ['-xzf', packedPackage, '--strip-components=1', '-C', installed]);
    await copyFile(fixture, join(workspace, 'data.json'));
    await copyFile(prompt, join(workspace, 'PROMPT.md'));
    await writeFile(join(workspace, 'package.json'), '{"type":"module"}\n');
    const hashes = await inputHashes?.(workspace);
    await exec('chmod', ['-R', 'a-w', ...sealedTrees.map(name => join(workspace, name))]);
    await exec('chmod', ['a-w', ...['data.json', 'PROMPT.md', 'package.json'].map(name => join(workspace, name))]);
    return { workspace, runDirectory, home, codexHome, claudeConfigDir, temporary, loginLink, hashes };
  } catch (error) {
    await removeWorkspace(runDirectory);
    throw error;
  }
}
