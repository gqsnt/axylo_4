/**
 * The fixtures reach `axylo` only through the packed files, and nothing they did not declare at all.
 *
 * scripts/pack.mjs installs each fixture with `npm install --offline` from its own package.json: the
 * tarball through its `file:` specifier, nothing linked. The fixtures
 * still sit under the repository, whose root node_modules links the workspace packages, and Node, esbuild and
 * TypeScript all walk up there for anything a fixture lacks. So every resolution in these tests is guarded:
 * Node through guard/node-guard.mjs, esbuild through `fixtureGuard`, TypeScript through its file list. This
 * file shows each guard lets the declared imports through and stops an undeclared one that, unguarded,
 * would have resolved into the workspace.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { check, fixture, fixtureGuard, inside, manifest, nodeJson, outsideFixture, repo } from './paths';

type Fixture = 'npm' | 'script';
const FIXTURES: Fixture[] = ['npm', 'script'];
const declared = (name: Fixture): string[] => {
  const pkg = JSON.parse(fs.readFileSync(fixture(name, 'package.json'), 'utf8')) as { dependencies?: object; devDependencies?: object };
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
};
/** A package the root node_modules has and the fixture did not declare; a type-carrying one for tsc. */
const UNDECLARED: Record<Fixture, string> = { npm: 'fast-check', script: 'fast-check' };

const symlinks = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isSymbolicLink() ? [p] : e.isDirectory() ? symlinks(p) : [];
});

describe.each(FIXTURES)('%s fixture', name => {
  const dir = fixture(name);
  const ours = declared(name).filter(n => n === 'axylo');

  it('was installed by npm from the packed tarballs, with no links anywhere in node_modules', () => {
    const lock = JSON.parse(fs.readFileSync(fixture(name, 'node_modules/.package-lock.json'), 'utf8')) as { packages: Record<string, { resolved?: string; integrity?: string }> };
    expect(ours.length).toBeGreaterThan(0);
    for (const pkg of ours) {
      const entry = lock.packages[`node_modules/${pkg}`];
      const packed = manifest().packages[pkg as 'axylo'];
      expect(entry?.resolved).toBe(`file:../../.packed/${packed.tarball}`);
      expect(entry?.integrity).toBe(packed.integrity);
    }
    expect(symlinks(fixture(name, 'node_modules'))).toEqual([]);
  });

  it('the undeclared package is reachable from here without a guard, so the guards below have something to stop', () => {
    const code = `console.log(JSON.stringify(import.meta.resolve(${JSON.stringify(UNDECLARED[name])})))`;
    const url = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8' }).trim();
    expect(inside(repo, new URL(JSON.parse(url) as string).pathname)).toBe(true);
    expect(inside(dir, new URL(JSON.parse(url) as string).pathname)).toBe(false);
  });

  for (const conditions of [[], ['--conditions=development']]) {
    it(`Node [${conditions.join(' ')}]: declared packages resolve inside the fixture; the undeclared one is stopped`, () => {
      const code = `const out = {};
for (const s of ${JSON.stringify([...ours, 'axylo/axylo.css'])}) out[s] = import.meta.resolve(s);
try { out.undeclared = import.meta.resolve(${JSON.stringify(UNDECLARED[name])}); } catch (e) { out.undeclared = 'stopped: ' + e.message; }
console.log(JSON.stringify(out));`;
      const r = nodeJson<Record<string, string>>(dir, [...conditions, '--input-type=module', '-e', code]);
      for (const [spec, url] of Object.entries(r)) {
        if (spec === 'undeclared') continue;
        expect(inside(fixture(name, 'node_modules'), new URL(url).pathname), `${spec} → ${url}`).toBe(true);
      }
      expect(r.undeclared).toMatch(/^stopped: \[fixture guard\]/);
    });
  }

  it('esbuild: declared imports bundle inside the fixture; the undeclared one fails the build', async () => {
    const entry = ours.map(p => `export * as m${ours.indexOf(p)} from ${JSON.stringify(p)};`).join('\n');
    const ok = await build({
      stdin: { contents: entry, resolveDir: dir }, absWorkingDir: dir, bundle: true, write: false, metafile: true, logLevel: 'silent',
      format: 'esm', plugins: [fixtureGuard([dir])],
    });
    expect(Object.keys(ok.metafile.inputs).map(p => path.resolve(dir, p)).filter(p => !inside(dir, p) && p !== path.resolve(dir, '<stdin>'))).toEqual([]);
    const failed = await build({
      stdin: { contents: `import ${JSON.stringify(UNDECLARED[name])};`, resolveDir: dir }, absWorkingDir: dir, bundle: true, write: false,
      logLevel: 'silent', plugins: [fixtureGuard([dir])],
    }).then(() => null, (e: { errors: { text: string }[] }) => e.errors.map(x => x.text).join('\n'));
    expect(failed).toMatch(/\[fixture guard\]/);
  });

  it('tsc: the file-list guard stops an undeclared import (types.test.ts shows it passes the fixture projects)', () => {
    const scratch = fixture(name, '.out', 'undeclared');
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(scratch, 'undeclared.ts'), `export * from ${JSON.stringify(UNDECLARED[name])};\n`);
    fs.writeFileSync(path.join(scratch, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, types: [], skipLibCheck: true, lib: ['ES2022', 'DOM'] },
      include: ['undeclared.ts'],
    }));
    const r = check(scratch, 'tsconfig.json');
    expect(outsideFixture(r.files, dir).length, 'workspace files the undeclared import reached').toBeGreaterThan(0);
  });
});
