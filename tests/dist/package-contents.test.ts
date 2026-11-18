/**
 * What the tarballs contain against what their package.json promises (plan M7). Expected files are derived
 * from the packed package.json (`exports`, `types`, `files`), from the declarations those entries import,
 * and from the documented script-tag files; anything else in the tarball is reported.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { exportTargets, installed, manifest, packedJson, repo } from './paths';

type Name = 'axylo';
const NAMES: Name[] = ['axylo'];

/** npm adds these whatever `files` says. */
const ALWAYS = ['package.json', 'README.md', 'LICENSE'];
/**
 * The script-tag flavours (plan 1.6: a development and a production file; examples/first-chart/script.html
 * loads the production one). They are not in `exports`, because a bundler never imports them.
 */
const SCRIPT_TAG: Record<Name, string[]> = { axylo: ['dist/axylo.iife.js', 'dist/axylo.iife.min.js'] };

const strip = (p: string): string => p.replace(/^\.\//, '');

/** Declaration files reachable from `entry` through relative imports, and the bare specifiers they import. */
function declarationClosure(name: Name, entry: string): { files: Set<string>; bare: Set<string>; missing: string[] } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const missing: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    const abs = installed(name, file);
    if (!fs.existsSync(abs)) { missing.push(file); continue; }
    files.add(file);
    const text = fs.readFileSync(abs, 'utf8');
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
      const spec = m[1]!;
      if (!spec.startsWith('.')) { bare.add(spec); continue; }
      const base = path.posix.join(path.posix.dirname(file), spec).replace(/\.(js|d\.ts|ts)$/, '');
      const candidates = [`${base}.d.ts`, `${base}/index.d.ts`];
      queue.push(candidates.find(c => fs.existsSync(installed(name, c))) ?? candidates[0]!);
    }
  }
  return { files, bare, missing };
}

describe.each(NAMES)('%s tarball', name => {
  const pkg = packedJson(name);
  const files = manifest().packages[name].files;

  it('is the workspace package.json, unchanged by packing', () => {
    const workspace = JSON.parse(fs.readFileSync(path.join(repo, manifest().packages[name].directory, 'package.json'), 'utf8'));
    expect(pkg).toEqual(workspace);
    expect(pkg.version).toBe('0.0.0');
  });

  it('contains every file its exports map names, under every condition', () => {
    const targets = exportTargets(pkg.exports);
    expect(targets.length).toBeGreaterThan(0);
    for (const { subpath, condition, target } of targets) {
      expect(files, `exports["${subpath}"].${condition} → ${target}`).toContain(strip(target));
    }
  });

  it('contains its top-level types, main and module entries, where declared', () => {
    for (const field of ['types', 'main', 'module'] as const) {
      const value = (pkg as unknown as Record<string, string | undefined>)[field];
      if (value !== undefined) expect(files, `${field}: ${value}`).toContain(strip(value));
    }
  });

  it('matches at least one shipped file with each "files" entry', () => {
    expect(pkg.files?.length ?? 0).toBeGreaterThan(0);
    for (const entry of pkg.files ?? []) {
      const e = strip(entry).replace(/\/$/, '');
      expect(files.some(f => f === e || f.startsWith(`${e}/`)), `files entry ${entry}`).toBe(true);
    }
  });

  it('ships a README and the MIT LICENSE', () => {
    expect(files).toContain('README.md');
    expect(files).toContain('LICENSE');
  });

  it('ships the declarations its types entries import, and they import no other package (it has no peers)', () => {
    const typeEntries = exportTargets(pkg.exports).filter(t => t.condition === 'types').map(t => strip(t.target));
    expect(typeEntries.length).toBeGreaterThan(0);
    for (const entry of typeEntries) {
      const { bare, missing } = declarationClosure(name, entry);
      expect(missing, `declarations imported from ${entry} but not shipped`).toEqual([]);
      const allowed = new Set(Object.keys(pkg.peerDependencies ?? {}));
      for (const spec of bare) {
        const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
        expect(allowed.has(root), `${entry} imports ${spec}, which is not a peer dependency`).toBe(true);
      }
    }
  });

  it('ships nothing that is not an entry, a declaration an entry imports, a script-tag file or npm metadata', () => {
    const expected = new Set<string>(ALWAYS);
    for (const { condition, target } of exportTargets(pkg.exports)) {
      expected.add(strip(target));
      if (condition === 'types') for (const f of declarationClosure(name, strip(target)).files) expected.add(f);
    }
    for (const f of SCRIPT_TAG[name]) expected.add(f);
    expect(files.filter(f => !expected.has(f))).toEqual([]);
  });

  it('ships no source, tests, source maps or build state', () => {
    const forbidden = files.filter(f =>
      /^src\//.test(f) || /(^|\/)(test|tests|__tests__)\//.test(f) || /\.(test|spec)\./.test(f) || /\.map$/.test(f) ||
      /\.tsbuildinfo$/.test(f) || (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)));
    expect(forbidden).toEqual([]);
    for (const f of files.filter(f => /\.js$/.test(f))) {
      expect(fs.readFileSync(installed(name, f), 'utf8'), `${f} refers to a source map`).not.toMatch(/sourceMappingURL/);
    }
  });

  if (name === 'axylo') {
    it('ships both script-tag flavours', () => {
      for (const f of SCRIPT_TAG.axylo) expect(files).toContain(f);
    });
  }
});
