/**
 * The packed declarations type-check an application (strict, skipLibCheck off) for both packages, with the
 * first-chart snippets among the checked files, and they are the declarations the compiler actually read:
 * the file list must show `axylo` and `@axylo/react` coming from the fixture's node_modules only.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fixture, inside, repo } from './paths';

const tsc = path.join(repo, 'node_modules/typescript/bin/tsc');

function check(project: string): { status: number | null; output: string; files: string[] } {
  const r = spawnSync(process.execPath, [tsc, '-p', project, '--listFiles'], { cwd: project, encoding: 'utf8' });
  const output = `${r.stdout}${r.stderr}`;
  const files = output.split('\n').map(l => l.trim()).filter(l => /\.(d\.)?tsx?$/.test(l)).map(l => path.resolve(project, l));
  return { status: r.status, output, files };
}

describe.each([
  ['npm', ['axylo']],
  ['react', ['axylo', '@axylo/react']],
] as const)('%s fixture', (name, packages) => {
  const project = fixture(name);
  const result = check(project);

  it('type-checks with tsc --strict against the packed declarations', () => {
    const errors = result.output.split('\n').filter(l => /error TS\d+/.test(l));
    expect(errors).toEqual([]);
    expect(result.status).toBe(0);
  });

  it('read the declarations from the fixture node_modules, never from the workspace', () => {
    for (const pkg of packages) {
      const dir = path.join(project, 'node_modules', pkg);
      const read = result.files.filter(f => inside(dir, f));
      expect(read.length, `${pkg} declarations read`).toBeGreaterThan(0);
    }
    expect(result.files.filter(f => inside(path.join(repo, 'packages'), f))).toEqual([]);
  });

  it('checked the first-chart snippet', () => {
    expect(result.files).toContain(path.join(project, 'example', name === 'npm' ? 'npm.ts' : 'react.tsx'));
  });
});
