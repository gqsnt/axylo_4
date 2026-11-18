/** Locations and small helpers shared by the distribution tests. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';
// @ts-expect-error scripts/pack.mjs is plain JavaScript without declarations
import { fixtureGuard as untypedGuard } from '../../scripts/pack.mjs';

export const repo = path.resolve(import.meta.dirname, '../..');
export const here = import.meta.dirname;
export const packed = path.join(here, '.packed');
export const out = path.join(here, '.out');
export const fixture = (name: 'npm' | 'script' | 'react', ...rest: string[]): string => path.join(here, 'fixtures', name, ...rest);
export const examples = path.join(repo, 'examples/first-chart');

export interface PackedPackage {
  directory: string;
  tarball: string;
  integrity: string;
  size: number;
  unpackedSize: number;
  /** Paths inside the tarball, without the `package/` prefix, as npm pack listed them. */
  files: string[];
}
export interface Manifest { packedAt: string; packages: Record<'axylo' | '@axylo/react', PackedPackage> }

export const manifest = (): Manifest => JSON.parse(fs.readFileSync(path.join(packed, 'manifest.json'), 'utf8')) as Manifest;

export interface PackageJson {
  name: string;
  version: string;
  license?: string;
  type?: string;
  sideEffects?: boolean | string[];
  files?: string[];
  types?: string;
  main?: string;
  exports?: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** The package.json as it was packed (read from the unpacked tarball, not from the workspace). */
export const packedJson = (name: 'axylo' | '@axylo/react'): PackageJson =>
  JSON.parse(fs.readFileSync(installed(name, 'package.json'), 'utf8')) as PackageJson;

/** A file of a package as unpacked into the fixture that installs it. */
export const installed = (name: 'axylo' | '@axylo/react', ...rest: string[]): string =>
  fixture(name === 'axylo' ? 'npm' : 'react', 'node_modules', name, ...rest);

/** Every file path an `exports` map points at, by condition, for each subpath. */
export function exportTargets(exports: PackageJson['exports']): { subpath: string; condition: string; target: string }[] {
  const list: { subpath: string; condition: string; target: string }[] = [];
  for (const [subpath, value] of Object.entries(exports ?? {})) {
    if (typeof value === 'string') list.push({ subpath, condition: 'default', target: value });
    else for (const [condition, target] of Object.entries(value)) list.push({ subpath, condition, target });
  }
  return list;
}

export const posix = (p: string): string => p.split(path.sep).join('/');
export const inside = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** The fixture directory (tests/dist/fixtures/<name>) that contains `p`, or null. */
export function fixtureOf(p: string): string | null {
  const base = path.join(here, 'fixtures');
  const rel = path.relative(base, p);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') return null;
  return path.join(base, rel.split(path.sep)[0]!);
}

export const nodeGuard = path.join(here, 'guard/node-guard.mjs');

/**
 * Runs Node on a script, from `cwd`, and parses the one JSON line it prints. Resolution is guarded
 * (guard/node-guard.mjs): an import that resolves outside `roots` (by default the fixture containing `cwd`)
 * throws instead of falling back to the repository's node_modules.
 */
export function nodeJson<T>(cwd: string, args: string[], roots: string[] = [fixtureOf(cwd) ?? cwd]): T {
  const stdout = execFileSync(process.execPath, ['--import', pathToFileURL(nodeGuard).href, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AXYLO_FIXTURE_ROOTS: JSON.stringify(roots) },
  });
  const line = stdout.trim().split('\n').pop() ?? '';
  return JSON.parse(line) as T;
}

/**
 * Files a `tsc --listFiles` run read that lie outside `root`, other than the compiler's own lib files: what
 * TypeScript found by walking up from a fixture into the repository's node_modules. TypeScript has no
 * option that stops that walk, so the file list is the guard.
 */
export function outsideFixture(files: string[], root: string): string[] {
  return files.filter(f => !inside(root, f) && !/[\\/]node_modules[\\/](@typescript[\\/][^\\/]+|typescript)[\\/]lib[\\/]lib\.[^\\/]+\.d\.ts$/.test(f));
}

/** esbuild plugin (scripts/pack.mjs): any import that resolves outside `roots` fails the build. */
export const fixtureGuard = untypedGuard as (roots: string[]) => Plugin;

export const tsc = path.join(repo, 'node_modules/typescript/bin/tsc');

/** Runs `tsc -p <project>/<config> --listFiles`: errors, exit status and the files the compiler read. */
export function check(project: string, config: string): { status: number | null; errors: string[]; files: string[] } {
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(project, config), '--listFiles'], { cwd: project, encoding: 'utf8' });
  const output = `${r.stdout}${r.stderr}`;
  const files = output.split('\n').map(l => l.trim()).filter(l => /\.(d\.)?tsx?$/.test(l)).map(l => path.resolve(project, l));
  return { status: r.status, errors: output.split('\n').filter(l => /error TS\d+/.test(l)), files };
}

