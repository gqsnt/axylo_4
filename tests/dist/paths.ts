/** Locations and small helpers shared by the distribution tests. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

/** Runs Node on a script, from `cwd`, and parses the one JSON line it prints. */
export function nodeJson<T>(cwd: string, args: string[]): T {
  const stdout = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const line = stdout.trim().split('\n').pop() ?? '';
  return JSON.parse(line) as T;
}
