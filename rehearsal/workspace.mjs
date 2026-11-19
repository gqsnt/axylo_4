import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, realpath, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { inside, repository, taskFiles } from './files.mjs';

export async function prepareWorkspace(directory, task) {
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
  const docs = join(repository, 'apps/docs/dist');
  const tarball = join(repository, 'tests/dist/.packed/axylo-0.0.0.tgz');
  const installed = join(workspace, 'node_modules/axylo');
  await mkdir(installed, { recursive: true });
  await cp(docs, join(workspace, 'docs'), {
    recursive: true,
    filter(file) {
      const path = relative(docs, file);
      // Linked public examples belong to the docs. The evidence pages also link to internal source snapshots.
      return !path.startsWith('source/') || path === 'source/apps' || path === 'source/apps/docs' ||
        /^source\/(?:apps\/docs\/)?examples(?:\/|$)/.test(path);
    },
  });
  await promisify(execFile)('tar', ['-xzf', tarball, '--strip-components=1', '-C', installed]);
  await copyFile(fixture, join(workspace, 'data.json'));
  await copyFile(prompt, join(workspace, 'PROMPT.md'));
  await writeFile(join(workspace, 'package.json'), '{"type":"module"}\n');
  return { workspace, runDirectory };
}
