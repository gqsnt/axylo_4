/**
 * Spec DX11 (MIT for everything, third-party notices verified at release) and the zero-runtime-dependency
 * half of DX7, on the packed files and the source they are built from. The release inventory in
 * THIRD-PARTY-NOTICES.md must list exactly the files of each tarball, and each origin it claims is checked;
 * a licence or copyright header anywhere in what ships, or in the source, must be quoted in its notices.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { installed, manifest, packedJson, repo } from './paths';

type Name = 'axylo';
const NAMES: Name[] = ['axylo'];
/** What the shipped JavaScript may import: nothing (spec DX7, zero runtime dependencies). */
const ALLOWED_IMPORTS: Record<Name, string[]> = { axylo: [] };
const SOURCE: Record<Name, string> = { axylo: 'packages/axylo/src' };

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

  it('ships JavaScript that imports nothing', async () => {
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
    });
    const inputs = Object.keys(r.metafile.inputs).map(p => path.resolve(repo, p));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.filter(p => !p.startsWith(src + path.sep))).toEqual([]);
  });

  it('every licence or copyright header in its source or shipped files is quoted in the notices', () => {
    const src = path.join(repo, SOURCE[name]);
    const sources = fs.readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(f => /\.[cm]?[jt]sx?$/.test(f)).map(f => path.join(src, f));
    const shipped = manifest().packages[name].files.filter(f => !/^(LICENSE|README\.md|package\.json)$/.test(f)).map(f => installed(name, f));
    const notices = notice();
    const unquoted = [...sources, ...shipped].flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(l => HEADER.test(l))
      .map(l => l.replace(/^[\s/*#!]+/, '').trim()).filter(l => !notices.includes(l)).map(l => `${path.relative(repo, f)}: ${l}`));
    expect(unquoted).toEqual([]);
  });
});

/** The release inventory table of THIRD-PARTY-NOTICES.md: package, file, origin, license. */
const notices = (): string => fs.readFileSync(path.join(repo, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const notice = (): string => notices().split(/^## Notices$/m)[1] ?? '';
function inventory(): { pkg: string; file: string; origin: string; license: string }[] {
  const section = notices().split(/^## Release inventory$/m)[1]?.split(/^## /m)[0] ?? '';
  return section.split('\n').filter(l => /^\| `/.test(l)).map(l => {
    const [pkg, file, origin, license] = l.split('|').slice(1, 5).map(c => c.trim().replace(/^`|`$/g, ''));
    return { pkg: pkg!, file: file!, origin: origin!, license: license! };
  });
}

describe('THIRD-PARTY-NOTICES.md', () => {
  it('covers the published package', () => {
    for (const name of NAMES) expect(notices()).toContain(`\`${name}\``);
  });

  it('lists exactly the files of the packed tarball in its release inventory', () => {
    const listed = inventory().map(r => `${r.pkg}/${r.file}`).sort();
    const packed = NAMES.flatMap(n => manifest().packages[n].files.map(f => `${n}/${f}`)).sort();
    expect(listed).toEqual(packed);
  });

  it('gives each file an origin that holds, and a license', async () => {
    for (const row of inventory()) {
      const where = `${row.pkg}/${row.file}`;
      expect(row.license, where).toBe('MIT');
      const name = row.pkg as Name;
      const own = /^built from `?(packages\/[\w-]+\/src)`?$/.exec(row.origin);
      // "generated from <module>", or "generated from <module> through <module>": a string the first exports, passed
      // through the function the second exports (the stylesheet, minified at build time).
      const generated = /^generated from `?(packages\/[\w/.-]+\.ts)`?(?: through `?(packages\/[\w/.-]+\.ts)`?)?$/.exec(row.origin);
      const emitted = /^emitted from `?(packages\/[\w/.-]+\.ts)`?$/.exec(row.origin);
      if (row.origin === 'package metadata') {
        expect(['package.json', 'README.md', 'LICENSE'], where).toContain(row.file);
      } else if (own) {
        expect(own[1], where).toBe(SOURCE[name]);
        expect(row.file, where).toMatch(/\.js$/);
        // The bundle-input check above covers every built JavaScript file of the package.
      } else if (generated) {
        const load = async (file: string) => {
          const r = await build({ entryPoints: [path.join(repo, file)], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
          return await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0]!.contents).toString('base64')}`) as Record<string, unknown>;
        };
        const mod = await load(generated[1]!);
        const through = generated[2] ? Object.values(await load(generated[2])).filter((v): v is (s: string) => string => typeof v === 'function') : [];
        if (generated[2]) expect(through, `${generated[2]} exports one function`).toHaveLength(1);
        const strings = Object.values(mod).filter((v): v is string => typeof v === 'string').map(v => through.length ? through[0]!(v) : v);
        const shipped = fs.readFileSync(installed(name, row.file), 'utf8');
        expect(strings.some(v => v === shipped), `${where} is a string ${generated[1]} exports${generated[2] ? `, through ${generated[2]}` : ''}`).toBe(true);
      } else if (emitted) {
        expect(fs.existsSync(path.join(repo, emitted[1]!)), where).toBe(true);
        expect(row.file, where).toMatch(/\.d\.ts$/);
      } else {
        // A third-party file: named with its version, and its notice quoted below the inventory.
        const third = /^third-party: (\S+) (\S+)$/.exec(row.origin);
        expect(third, `${where}: unknown origin "${row.origin}"`).not.toBeNull();
        expect(notice(), where).toContain(third![1]!);
      }
    }
  });
});
