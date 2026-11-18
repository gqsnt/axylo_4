/**
 * Spec DX11 (MIT for everything, third-party notices) and the zero-runtime-dependency half of DX7, checked
 * mechanically on the packed files and on the source they are built from. THIRD-PARTY-NOTICES.md lists
 * the same checks.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { installed, manifest, packedJson, repo } from './paths';

type Name = 'axylo' | '@axylo/react';
const NAMES: Name[] = ['axylo', '@axylo/react'];
/** What the shipped JavaScript may import: nothing for the core; the core and React for the adapter (plan 1.7). */
const ALLOWED_IMPORTS: Record<Name, string[]> = { axylo: [], '@axylo/react': ['axylo', 'react'] };
const SOURCE: Record<Name, string> = { axylo: 'packages/axylo/src', '@axylo/react': 'packages/react/src' };

// The standard MIT text (opensource.org/license/mit): its grant and its warranty disclaimer.
const MIT_GRANT = 'Permission is hereby granted, free of charge, to any person obtaining a copy';
const MIT_DISCLAIMER = 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND';
/** Markers of a licence or copyright header copied in from elsewhere. */
const HEADER = /@license\b|@preserve\b|SPDX-License-Identifier|Copyright\s+(\(c\)|©|\d{4})|Licensed under|Permission is hereby granted|THE SOFTWARE IS PROVIDED/i;

describe.each(NAMES)('%s', name => {
  const pkg = packedJson(name);

  it('is MIT: the license field and the shipped LICENSE file', () => {
    expect(pkg.license).toBe('MIT');
    const text = fs.readFileSync(installed(name, 'LICENSE'), 'utf8').replace(/\s+/g, ' ');
    expect(text.startsWith('MIT License')).toBe(true);
    expect(text).toContain(MIT_GRANT);
    expect(text).toContain(MIT_DISCLAIMER);
  });

  it('declares no runtime dependencies', () => {
    const raw = pkg as unknown as Record<string, unknown>;
    for (const field of ['dependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) expect(raw[field], field).toBeUndefined();
    expect(Object.keys(pkg.peerDependencies ?? {}).sort()).toEqual(ALLOWED_IMPORTS[name]);
  });

  it('ships JavaScript that imports nothing but its peers', async () => {
    const files = manifest().packages[name].files.filter(f => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const r = await build({
        entryPoints: [installed(name, file)], bundle: true, write: false, metafile: true, logLevel: 'silent', format: 'esm',
        plugins: [{ name: 'externals', setup(b) { b.onResolve({ filter: /^[^./]/ }, a => ({ path: a.path, external: true })); } }],
      });
      const imports = Object.values(r.metafile.inputs).flatMap(i => i.imports.filter(x => x.external).map(x => x.path));
      const roots = [...new Set(imports.map(s => s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]!))].sort();
      expect(roots.filter(s => !ALLOWED_IMPORTS[name].includes(s)), `${file} imports`).toEqual([]);
      expect(Object.keys(r.metafile.inputs), `${file} pulls in other files`).toHaveLength(1);
    }
  });

  it('is built from its own source only: no node_modules input when its entry is bundled as the release build does', async () => {
    const src = path.join(repo, SOURCE[name]);
    const r = await build({
      entryPoints: [path.join(src, 'index.ts')], bundle: true, write: false, metafile: true, format: 'esm', target: 'es2022',
      minify: true, define: { __DEV__: 'false' }, legalComments: 'none', logLevel: 'silent', absWorkingDir: repo,
      external: ['react', 'react/jsx-runtime', 'react-dom', 'axylo'],
    });
    const inputs = Object.keys(r.metafile.inputs).map(p => path.resolve(repo, p));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.filter(p => !p.startsWith(src + path.sep))).toEqual([]);
  });

  it('has no copied licence or copyright header in its source or its shipped files', () => {
    const src = path.join(repo, SOURCE[name]);
    const sources = fs.readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(f => /\.[cm]?[jt]sx?$/.test(f)).map(f => path.join(src, f));
    const shipped = manifest().packages[name].files.filter(f => !/^(LICENSE|README\.md|package\.json)$/.test(f)).map(f => installed(name, f));
    const hits = [...sources, ...shipped].filter(f => HEADER.test(fs.readFileSync(f, 'utf8')));
    expect(hits.map(f => path.relative(repo, f))).toEqual([]);
  });
});

describe('THIRD-PARTY-NOTICES.md', () => {
  const text = fs.readFileSync(path.join(repo, 'THIRD-PARTY-NOTICES.md'), 'utf8');

  it('covers both published packages and states that they ship no third-party code', () => {
    for (const name of NAMES) expect(text).toContain(`\`${name}\``);
    expect(text).toMatch(/contain no third-party code/);
  });
});
