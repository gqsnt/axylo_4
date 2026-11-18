/**
 * The fixtures reach `axylo` and `@axylo/react` only through the packed files: the installed packages are
 * real directories (not links to the workspace), and Node and esbuild both resolve them, including the
 * adapter's own `import 'axylo'`, to files under the fixture's node_modules. The root node_modules holds
 * workspace symlinks to packages/*, which a fixture would silently fall back to if its copy were missing.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, inside, nodeJson, repo } from './paths';

const workspace = path.join(repo, 'packages');

describe('fixture installs', () => {
  for (const [name, pkg] of [['npm', 'axylo'], ['script', 'axylo'], ['react', 'axylo'], ['react', '@axylo/react']] as const) {
    it(`${name}: node_modules/${pkg} is an unpacked directory, not a link`, () => {
      const at = fixture(name, 'node_modules', pkg);
      expect(fs.lstatSync(at).isSymbolicLink()).toBe(false);
      expect(fs.realpathSync(at)).toBe(at);
    });
  }

  it('the root node_modules does link the workspace, so the check below has something to catch', () => {
    expect(fs.realpathSync(path.join(repo, 'node_modules/axylo'))).toBe(path.join(workspace, 'axylo'));
  });
});

describe('Node resolution from inside the fixtures', () => {
  const probe = (cwd: string, specifiers: string[], conditions: string[] = []) => {
    const code = `console.log(JSON.stringify(${JSON.stringify(specifiers)}.map(s => import.meta.resolve(s))))`;
    return nodeJson<string[]>(cwd, [...conditions.map(c => `--conditions=${c}`), '--input-type=module', '-e', code])
      .map(u => fs.realpathSync(new URL(u)));
  };

  for (const conditions of [[], ['development']]) {
    it(`npm fixture, conditions [${conditions.join(', ')}]`, () => {
      for (const file of probe(fixture('npm'), ['axylo', 'axylo/axylo.css'], conditions)) {
        expect(inside(fixture('npm', 'node_modules/axylo'), file), file).toBe(true);
      }
    });

    it(`react fixture, and the adapter's own import of axylo, conditions [${conditions.join(', ')}]`, () => {
      const [adapter, core] = probe(fixture('react'), ['@axylo/react', 'axylo'], conditions);
      expect(inside(fixture('react', 'node_modules/@axylo/react'), adapter!), adapter).toBe(true);
      expect(inside(fixture('react', 'node_modules/axylo'), core!), core).toBe(true);
      // Resolved from the adapter's own directory, as its `import ... from 'axylo'` is at run time.
      const [fromAdapter] = probe(path.dirname(adapter!), ['axylo'], conditions);
      expect(inside(fixture('react', 'node_modules/axylo'), fromAdapter!), fromAdapter).toBe(true);
    });
  }
});

describe('esbuild resolution from inside the fixtures', () => {
  it('every bundled input of the React snippet that is ours comes from the fixture node_modules', async () => {
    const r = await build({
      entryPoints: [fixture('react', 'main.tsx')], bundle: true, write: false, metafile: true, jsx: 'automatic',
      format: 'esm', logLevel: 'silent', absWorkingDir: fixture('react'), define: { 'process.env.NODE_ENV': '"production"' },
    });
    const inputs = Object.keys(r.metafile.inputs).map(p => path.resolve(fixture('react'), p));
    // The production condition (esbuild applies none by default, so `default` is taken).
    expect(inputs).toContain(fixture('react', 'node_modules/axylo/dist/axylo.js'));
    expect(inputs).toContain(fixture('react', 'node_modules/@axylo/react/dist/index.js'));
    expect(inputs.filter(p => inside(workspace, p))).toEqual([]);
  });
});
