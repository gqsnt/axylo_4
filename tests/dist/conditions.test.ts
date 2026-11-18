/**
 * Development and production flavours (plan 1.6): the `development` export condition and the default
 * resolve to different files, in Node and in esbuild, and neither refers to the build-time __DEV__ or __BENCH__ constant.
 *
 * The behaviour that must differ between the flavours is pinned in flavours.browser.test.ts, from a list
 * written by hand from the spec and the plan. An earlier check here derived "development-only text" from the
 * source's `if (__DEV__)` statements; it followed the guard syntax, and an ordinary identifier the minifier
 * kept elsewhere (an object shorthand's `value`) made it fail on innocent code, so it was retired.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, fixtureGuard, installed, nodeJson, packedJson } from './paths';

type Name = 'axylo';
const FIXTURE: Record<Name, 'npm'> = { axylo: 'npm' };

const targetOf = (name: Name, condition: string): string => {
  const entry = packedJson(name).exports?.['.'];
  if (!entry || typeof entry === 'string' || !entry[condition]) throw new Error(`${name} has no "${condition}" export`);
  return installed(name, entry[condition]!.replace(/^\.\//, ''));
};

describe.each(['axylo'] as const)('%s', name => {
  const dev = targetOf(name, 'development');
  const prod = targetOf(name, 'default');

  it('the development condition and the default name different files with different content', () => {
    expect(dev).not.toBe(prod);
    expect(fs.readFileSync(dev, 'utf8')).not.toBe(fs.readFileSync(prod, 'utf8'));
  });

  it('Node resolves the default without conditions and the development file with --conditions=development', () => {
    const code = `console.log(JSON.stringify(import.meta.resolve(${JSON.stringify(name)})))`;
    const resolve = (args: string[]) => fs.realpathSync(new URL(nodeJson<string>(fixture(FIXTURE[name]), [...args, '--input-type=module', '-e', code])));
    expect(resolve([])).toBe(prod);
    expect(resolve(['--conditions=development'])).toBe(dev);
  });

  it('esbuild resolves the development file under the development condition and the default under production', async () => {
    const entry = async (conditions: string[]) => {
      const r = await build({
        stdin: { contents: `export * from ${JSON.stringify(name)};`, resolveDir: fixture(FIXTURE[name]) }, bundle: true, write: false,
        metafile: true, format: 'esm', conditions, absWorkingDir: fixture(FIXTURE[name]), plugins: [fixtureGuard([fixture(FIXTURE[name])])], logLevel: 'silent',
      });
      return Object.keys(r.metafile.inputs).map(p => path.resolve(fixture(FIXTURE[name]), p)).filter(p => p === dev || p === prod);
    };
    expect(await entry(['development'])).toEqual([dev]);
    expect(await entry(['production'])).toEqual([prod]);
  });

  it('neither file refers to a build-time constant (__DEV__, __BENCH__: scripts/build.mjs replaces both)', () => {
    const scriptTag = ['dist/axylo.iife.js', 'dist/axylo.iife.min.js'].map(f => installed('axylo', f));
    for (const file of [dev, prod, ...scriptTag]) expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/\b__(DEV|BENCH)__\b/);
  });
});
