/**
 * The offline distribution check (scripts/check-dist-closure.mjs) on synthetic packages: what it must accept
 * and the problems it must name. The expected problems come from what npm pack would ship (`files`), what the
 * manifest names, and the declaration imports written into each fixture, not from running the checker.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error scripts/check-dist-closure.mjs is plain JavaScript without declarations
import * as untyped from '../../../../scripts/check-dist-closure.mjs';

interface ClosureResult { ok: boolean; errors: string[]; targets: number; declarations: number; scripts: number }
const closureModule = untyped as {
  checkDistClosure: (pkgDir: string, options?: { scriptTagFiles?: string[] }) => ClosureResult;
  declarationSpecifiers: (text: string) => string[];
  hasSourceMapDirective: (text: string) => boolean;
};
const { checkDistClosure, declarationSpecifiers, hasSourceMapDirective } = closureModule;

const script = path.resolve(import.meta.dirname, '../../../../scripts/check-dist-closure.mjs');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Files = Record<string, string>;

/** Writes a package directory: package.json from `manifest`, then every file of `files`. */
function fixture(manifest: Record<string, unknown>, files: Files): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axylo-closure-'));
  made.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** A package shaped like Axylo's: a root entry, a `./sync` subpath, the stylesheet and both script-tag files. */
const MANIFEST = {
  name: 'axylo',
  version: '0.0.0',
  type: 'module',
  files: [
    'dist/axylo.js', 'dist/axylo.dev.js', 'dist/axylo.iife.js', 'dist/axylo.iife.min.js', 'dist/axylo.css',
    'dist/index.d.ts', 'dist/public.d.ts', 'dist/sync.js', 'dist/sync.dev.js', 'dist/sync.d.ts',
  ],
  exports: {
    '.': { types: './dist/index.d.ts', development: './dist/axylo.dev.js', default: './dist/axylo.js' },
    './sync': { types: './dist/sync.d.ts', development: './dist/sync.dev.js', default: './dist/sync.js' },
    './axylo.css': './dist/axylo.css',
  },
};
const FILES: Files = {
  'dist/axylo.js': 'export const a=1;',
  'dist/axylo.dev.js': 'export const a = 1;\n',
  'dist/axylo.iife.js': 'var Axylo = (() => ({}))();\n',
  'dist/axylo.iife.min.js': 'var Axylo=(()=>({}))();',
  'dist/axylo.css': '.axylo{}',
  'dist/index.d.ts': "export * from './public';\nexport type { Sync } from './sync.js';\n",
  'dist/public.d.ts': "export interface Chart { x: number }\nexport type Self = import('./index').Chart;\n",
  'dist/sync.js': 'export const s=1;',
  'dist/sync.dev.js': 'export const s = 1;\n',
  'dist/sync.d.ts': "import type { Chart } from './public.js';\nexport interface Sync { chart: Chart }\n",
  // tsc emits a declaration for every source file; these are on disk but npm pack leaves them out.
  'dist/sync/group.d.ts': 'export interface Group { id: string }\n',
  'dist/core/contracts.d.ts': 'export {};\n',
};

const withManifest = (change: (m: typeof MANIFEST) => Record<string, unknown>): Record<string, unknown> =>
  change(structuredClone(MANIFEST));

describe('checkDistClosure', () => {
  it('accepts a package whose manifest files exist and ship and whose declarations close over shipped files', () => {
    const r = checkDistClosure(fixture(MANIFEST, FILES));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // index → public (and back, through import()), sync.js → sync.d.ts → public.js → public.d.ts
    expect(r.declarations).toBe(3);
    // 3 + 3 + 1 export targets, and the two script-tag files
    expect(r.targets).toBe(9);
    // every shipped .js in dist/
    expect(r.scripts).toBe(6);
  });

  it('fails when an exports target is missing, naming the subpath, the condition and the file', () => {
    const files = { ...FILES };
    delete files['dist/sync.dev.js'];
    const r = checkDistClosure(fixture(MANIFEST, files));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('exports["./sync"].development') && e.includes('dist/sync.dev.js') && e.includes('missing'))).toBe(true);
  });

  it('fails when the stylesheet export or a script-tag file is missing', () => {
    const files = { ...FILES };
    delete files['dist/axylo.css'];
    delete files['dist/axylo.iife.min.js'];
    const r = checkDistClosure(fixture(MANIFEST, files));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('exports["./axylo.css"]') && e.includes('dist/axylo.css'))).toBe(true);
    expect(r.errors.some(e => e.startsWith('script tag') && e.includes('dist/axylo.iife.min.js'))).toBe(true);
  });

  it('fails when an exports target exists but the files allowlist leaves it out', () => {
    const manifest = withManifest(m => ({ ...m, files: m.files.filter(f => f !== 'dist/sync.js') }));
    const r = checkDistClosure(fixture(manifest, FILES));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('exports["./sync"].default') && e.includes('not in package.json "files"'))).toBe(true);
  });

  it('checks top-level types, main and module where declared', () => {
    const manifest = withManifest(m => ({ ...m, types: './dist/index.d.ts', main: './dist/axylo.js', module: './dist/gone.js' }));
    const r = checkDistClosure(fixture(manifest, FILES));
    expect(r.errors).toEqual(['module → ./dist/gone.js: missing (dist/gone.js does not exist)']);
  });

  describe('the Wave 3 regression: a declaration re-export to a submodule the tarball does not ship', () => {
    const regressed: Files = { ...FILES, 'dist/sync.d.ts': "export * from './sync/group';\nexport interface Sync { id: string }\n" };

    it('fails when the submodule declaration is on disk but not in "files", naming the importing file and specifier', () => {
      const r = checkDistClosure(fixture(MANIFEST, regressed));
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual([
        "dist/sync.d.ts: './sync/group' resolves to dist/sync/group.d.ts, which is in dist/ but not in package.json \"files\", so npm pack leaves it out",
      ]);
    });

    it('fails when the submodule declaration does not exist at all', () => {
      const files = { ...regressed };
      delete files['dist/sync/group.d.ts'];
      const r = checkDistClosure(fixture(MANIFEST, files));
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual([
        "dist/sync.d.ts: './sync/group' names a declaration that does not exist (tried dist/sync/group.d.ts, dist/sync/group/index.d.ts)",
      ]);
    });

    it('accepts the submodule once "files" ships it', () => {
      const manifest = withManifest(m => ({ ...m, files: [...m.files, 'dist/sync/group.d.ts'] }));
      const r = checkDistClosure(fixture(manifest, regressed));
      expect(r.errors).toEqual([]);
      expect(r.declarations).toBe(4);
    });

    it('accepts the submodule when "files" ships its whole directory', () => {
      const manifest = withManifest(m => ({ ...m, files: [...m.files, 'dist/sync/'] }));
      expect(checkDistClosure(fixture(manifest, regressed)).errors).toEqual([]);
    });
  });

  it('follows declarations recursively, through directory indexes, every import form and cycles', () => {
    const manifest = withManifest(m => ({ ...m, files: [...m.files, 'dist/deep'] }));
    const files = {
      ...FILES,
      'dist/public.d.ts': "import './deep';\nexport interface Chart { x: number }\n",
      'dist/deep/index.d.ts': "export type A = import('./a.js').A;\n",
      'dist/deep/a.d.ts': "export { type B as A } from './b';\n",
      'dist/deep/b.d.ts': "import type { A } from './a';\nexport type B = { next?: A };\nexport * from './c.d.ts';\n",
      'dist/deep/c.d.ts': "export * from '../index';\n",
    };
    const ok = checkDistClosure(fixture(manifest, files));
    expect(ok.errors).toEqual([]);
    // index, public, sync, deep/index, deep/a, deep/b, deep/c
    expect(ok.declarations).toBe(7);

    const broken = { ...files, 'dist/deep/c.d.ts': "export * from '../index';\nexport * from './d';\n" };
    expect(checkDistClosure(fixture(manifest, broken)).errors).toEqual([
      "dist/deep/c.d.ts: './d' names a declaration that does not exist (tried dist/deep/d.d.ts, dist/deep/d/index.d.ts)",
    ]);
  });

  it('maps an explicit .js specifier to its own declaration only, not to a directory index', () => {
    const manifest = withManifest(m => ({ ...m, files: [...m.files, 'dist/group'] }));
    const files = { ...FILES, 'dist/sync.d.ts': "export * from './group.js';\n", 'dist/group/index.d.ts': 'export {};\n' };
    expect(checkDistClosure(fixture(manifest, files)).errors).toEqual([
      "dist/sync.d.ts: './group.js' names a declaration that does not exist (tried dist/group.d.ts)",
    ]);
  });

  it('fails when a declaration reaches outside dist/ or outside the package', () => {
    const manifest = withManifest(m => ({ ...m, files: [...m.files, 'src/sync.d.ts'] }));
    const files = { ...FILES, 'dist/sync.d.ts': "export * from '../src/sync';\nexport * from '../../elsewhere';\n", 'src/sync.d.ts': 'export {};\n' };
    expect(checkDistClosure(fixture(manifest, files)).errors).toEqual([
      "dist/sync.d.ts: '../src/sync' resolves to src/sync.d.ts, which is outside dist/",
      "dist/sync.d.ts: '../../elsewhere' resolves outside the package",
    ]);
  });

  it('fails on a bare import of a package that is not a peer, and accepts scoped and unscoped peers', () => {
    const files = { ...FILES, 'dist/public.d.ts': "import type { X } from 'left-pad';\nexport interface Chart { x: X }\n" };
    const r = checkDistClosure(fixture(MANIFEST, files));
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(["dist/public.d.ts: imports 'left-pad', and left-pad is not a peer dependency (declarations may import only peers)"]);

    const peers = {
      ...FILES,
      'dist/public.d.ts': "import type { X } from '@scope/kit/types';\nimport type { Y } from 'plain/sub';\nimport type { Z } from '@scope/other';\nexport interface Chart { x: X; y: Y; z: Z }\n",
    };
    const manifest = withManifest(m => ({ ...m, peerDependencies: { '@scope/kit': '^1', plain: '^2' } }));
    expect(checkDistClosure(fixture(manifest, peers)).errors).toEqual([
      "dist/public.d.ts: imports '@scope/other', and @scope/other is not a peer dependency (declarations may import only peers)",
    ]);
  });

  it('fails when shipped JavaScript refers to a source map', () => {
    const files = { ...FILES, 'dist/axylo.iife.min.js': 'var Axylo=(()=>({}))();\n//# sourceMappingURL=axylo.iife.min.js.map\n' };
    const r = checkDistClosure(fixture(MANIFEST, files));
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(['dist/axylo.iife.min.js: shipped JavaScript refers to a source map (sourceMappingURL)']);
  });

  it('fails on source maps and build state anywhere in dist/, shipped or not', () => {
    const files = { ...FILES, 'dist/axylo.js.map': '{}', 'dist/core/contracts.d.ts.map': '{}', 'dist/tsconfig.build.tsbuildinfo': '{}' };
    const r = checkDistClosure(fixture(MANIFEST, files));
    expect(r.ok).toBe(false);
    expect([...r.errors].sort()).toEqual([
      'dist/axylo.js.map: a source map in dist/',
      'dist/core/contracts.d.ts.map: a source map in dist/',
      'dist/tsconfig.build.tsbuildinfo: TypeScript build state in dist/',
    ]);
  });

  it('refuses a manifest whose shipped set it cannot decide exactly', () => {
    const noFiles = withManifest(m => {
      const { files: _files, ...rest } = m;
      return rest;
    });
    expect(checkDistClosure(fixture(noFiles, FILES)).errors).toContain(
      'package.json: no "files" allowlist; what npm pack ships cannot be decided without it');
    const glob = withManifest(m => ({ ...m, files: [...m.files, 'dist/**/*.d.ts'] }));
    expect(checkDistClosure(fixture(glob, FILES)).errors).toEqual([
      'package.json: files entry "dist/**/*.d.ts" is a pattern this check cannot match exactly; list paths',
    ]);
  });

  it('fails when dist/ was not built', () => {
    const r = checkDistClosure(fixture(MANIFEST, {}));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('dist/: missing; build first');
  });
});

describe('symbolic links, which npm pack never follows', () => {
  it('fails on a shipped declaration that is a link, even one pointing inside the package', () => {
    const files = { ...FILES, 'src/sync.d.ts': "import type { Chart } from './public.js';\nexport interface Sync { chart: Chart }\n" };
    delete (files as Files)['dist/sync.d.ts'];
    const dir = fixture(MANIFEST, files);
    fs.symlinkSync('../src/sync.d.ts', path.join(dir, 'dist/sync.d.ts'));
    const r = checkDistClosure(dir);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('package.json: files entry "dist/sync.d.ts": dist/sync.d.ts is a symbolic link, which npm pack skips');
    expect(r.errors).toContain('exports["./sync"].types → ./dist/sync.d.ts: dist/sync.d.ts is a symbolic link, which npm pack skips');
    // index.d.ts imports './sync.js', which reaches the link: the importing file and specifier are named
    expect(r.errors).toContain("dist/index.d.ts: './sync.js' resolves to dist/sync.d.ts, but dist/sync.d.ts is a symbolic link, which npm pack skips");
  });

  it('fails on a linked directory beneath dist/, naming the importing file, the specifier and the link', () => {
    const manifest = withManifest(m => ({ ...m, files: [...m.files, 'dist/sync/group.d.ts'] }));
    const files = { ...FILES, 'dist/sync.d.ts': "export * from './sync/group';\n", 'elsewhere/group.d.ts': 'export {};\n' };
    delete (files as Files)['dist/sync/group.d.ts'];
    const dir = fixture(manifest, files);
    fs.rmSync(path.join(dir, 'dist/sync'), { recursive: true, force: true });
    fs.symlinkSync('../elsewhere', path.join(dir, 'dist/sync'));
    expect(checkDistClosure(dir).errors).toEqual([
      'package.json: files entry "dist/sync/group.d.ts": dist/sync/group.d.ts lies under dist/sync, a symbolic link npm pack does not follow',
      "dist/sync.d.ts: './sync/group' resolves to dist/sync/group.d.ts, but dist/sync/group.d.ts lies under dist/sync, a symbolic link npm pack does not follow",
    ]);
  });

  it('fails on a linked dist/ and does not walk into it', () => {
    const real = fixture({}, { ...FILES, 'dist/axylo.js.map': '{}' });
    const dir = fixture(MANIFEST, {});
    fs.symlinkSync(path.join(real, 'dist'), path.join(dir, 'dist'));
    const r = checkDistClosure(dir);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('dist/: a symbolic link, which npm pack does not follow; build into a real directory');
    expect(r.errors).toContain('exports["."].types → ./dist/index.d.ts: dist/index.d.ts lies under dist, a symbolic link npm pack does not follow');
    expect(r.errors.some(e => e.includes('.map'))).toBe(false);
    expect(r.declarations).toBe(0);
  });
});

describe('a directory in "files" beside npm ignore files', () => {
  const regressed: Files = { ...FILES, 'dist/sync.d.ts': "export * from './sync/group';\nexport interface Sync { id: string }\n" };
  const withDir = withManifest(m => ({ ...m, files: [...m.files, 'dist/sync/'] }));
  const guidance = (ignores: string) =>
    `package.json: files entry "dist/sync/" is a directory, and ${ignores} can drop files from it, so what npm pack ships from it is uncertain; list the files it must ship individually in "files" (npm always ships a listed file)`;

  it('fails with guidance when an ignore file inside the directory could drop the Wave 3 submodule', () => {
    const r = checkDistClosure(fixture(withDir, { ...regressed, 'dist/sync/.npmignore': 'group.d.ts\n' }));
    expect(r.errors).toEqual([guidance('dist/sync/.npmignore')]);
  });

  it('fails with guidance for ignore files deeper inside or in a directory above it', () => {
    const r = checkDistClosure(fixture(withDir, { ...regressed, 'dist/.gitignore': 'sync/group.d.ts\n', 'dist/sync/deep/.npmignore': '*\n' }));
    expect(r.errors).toEqual([guidance('dist/.gitignore, dist/sync/deep/.npmignore')]);
  });

  it('ignores the package root ignore files, which npm drops once "files" exists, and named files, which always ship', () => {
    const named = withManifest(m => ({ ...m, files: [...m.files, 'dist/sync/group.d.ts'] }));
    const r = checkDistClosure(fixture(named, { ...regressed, '.npmignore': 'dist\n', 'dist/sync/.npmignore': 'group.d.ts\n' }));
    expect(r.errors).toEqual([]);
    expect(r.declarations).toBe(4);
  });
});

describe('declaration entries beneath nested conditions', () => {
  // index.d.ts no longer reaches sync.d.ts, so only the nested ./sync entry can lead the check to it
  const broken = { ...FILES, 'dist/index.d.ts': "export * from './public';\n", 'dist/sync.d.ts': "export * from './sync/group';\n" };
  const nested = (types: unknown) =>
    withManifest(m => ({ ...m, exports: { ...m.exports, './sync': { types, default: './dist/sync.js' } } }));

  it('does not reach sync.d.ts when no ./sync entry names it, so the cases below depend on nested seeding', () => {
    const manifest = withManifest(m => ({ ...m, exports: { ...m.exports, './sync': { default: './dist/sync.js' } } }));
    const r = checkDistClosure(fixture(manifest, broken));
    expect(r.errors).toEqual([]);
    // index and public only
    expect(r.declarations).toBe(2);
  });

  for (const [name, types] of [
    ['a condition object', { import: './dist/sync.d.ts' }],
    ['a fallback array', ['./dist/sync.d.ts']],
    ['an array of conditions', [{ import: { default: './dist/sync.d.ts' } }]],
  ] as const) {
    it(`follows a types entry inside ${name}, beside an ordinary types entry`, () => {
      expect(checkDistClosure(fixture(nested(types), broken)).errors).toEqual([
        "dist/sync.d.ts: './sync/group' resolves to dist/sync/group.d.ts, which is in dist/ but not in package.json \"files\", so npm pack leaves it out",
      ]);
    });
  }

  it("follows TypeScript's versioned types@ conditions", () => {
    const manifest = withManifest(m => ({ ...m, exports: { ...m.exports, './sync': { 'types@>=5.0': './dist/sync.d.ts', default: './dist/sync.js' } } }));
    expect(checkDistClosure(fixture(manifest, broken)).errors).toEqual([
      "dist/sync.d.ts: './sync/group' resolves to dist/sync/group.d.ts, which is in dist/ but not in package.json \"files\", so npm pack leaves it out",
    ]);
  });
});

describe('the Wave 3 regression against the real Axylo manifest', () => {
  const real = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { files: string[] };

  it('names sync.d.ts and its specifier when dist/sync/group.d.ts is on disk but outside "files"', () => {
    const files: Files = {};
    for (const f of real.files) files[f] = f.endsWith('.d.ts') ? 'export {};\n' : 'export {};';
    files['dist/index.d.ts'] = "export * from './public';\n";
    files['dist/sync.d.ts'] = "export * from './sync/group';\n";
    files['dist/sync/group.d.ts'] = 'export interface Group { id: string }\n';
    expect(checkDistClosure(fixture(real, files)).errors).toEqual([
      "dist/sync.d.ts: './sync/group' resolves to dist/sync/group.d.ts, which is in dist/ but not in package.json \"files\", so npm pack leaves it out",
    ]);
  });
});

describe('declarationSpecifiers', () => {
  it('reads every module specifier form, with comments between the tokens and no space after import', () => {
    const text = [
      "import'./setup';",
      "import type { A } from /* why */ './a';",
      "export * from // reason\n  './b.js';",
      "export { type C } from\n'./c'",
      "import D, { E } from \"./d\";",
      "export type F = import(/* lazy */ './f').F;",
      "import * as G from '@scope/g';",
      "export * as from from './h';",
      "import from from './i';",
    ].join('\n');
    expect(declarationSpecifiers(text)).toEqual(['./setup', './a', './b.js', './c', './d', './f', '@scope/g', './h', './i']);
  });

  it('skips lookalikes in comments, string and template literal types and properties named from or import', () => {
    const text = [
      '/**',
      " * Example: `import { chart } from 'left-pad'` or import('./nope').",
      ' */',
      "// export * from './commented';",
      "export type S = \"import('./string')\" | 'from \"./string2\"';",
      "export type T = `x${import('./inside').X}from './tpl'`;",
      "export interface P { from: './prop'; import?: './prop2'; to(from: 'a'): void; import(x: 'b'): void }",
      "export declare function from(x: './arg'): void;",
      "declare module './ambient' { export * from './real'; }",
      "export declare const o: { a: string };",
      "type Q = Foo.import;",
    ].join('\n');
    expect(declarationSpecifiers(text)).toEqual(['./inside', './real']);
  });
});

describe('declarationSpecifiers with keyword names in module clauses', () => {
  it('keeps the from clause through named lists and import bindings spelled like declaration keywords', () => {
    const text = [
      "export { Class as class } from './sync/group';",
      "import type { interface as Shape } from 'non-peer';",
      "export { default as module, enum as declare } from './k';",
      "import module, { const as abstract, namespace } from './l';",
      "import declare, * as function_ from './m';",
      "export type { function as let } from './n';",
      "export * as namespace from './o';",
    ].join('\n');
    expect(declarationSpecifiers(text)).toEqual(['./sync/group', 'non-peer', './k', './l', './m', './n', './o']);
  });

  it('reads no from clause out of local export and type declarations', () => {
    const text = [
      "export declare const from: './const';",
      "export type from = './type';",
      "export default interface D { from: './member' }",
      "export declare class C { static from: './static' }",
      'export { a, b }',
      "declare const from2: './after-list';",
      "export type T = { from: './literal' };",
      "export declare namespace N { const from: './ns' }",
      "export = from;",
    ].join('\n');
    expect(declarationSpecifiers(text)).toEqual([]);
  });

  it('fails the gate on the reviewed forms: a keyword-aliased re-export of an unshipped submodule and a non-peer import', () => {
    const files = {
      ...FILES,
      'dist/sync.d.ts': "export { Group as class } from './sync/group';\n",
      'dist/public.d.ts': "import type { interface as Shape } from 'non-peer';\nexport interface Chart { x: Shape }\n",
    };
    // sorted: the order follows the traversal, which this case is not about
    expect([...checkDistClosure(fixture(MANIFEST, files)).errors].sort()).toEqual([
      "dist/public.d.ts: imports 'non-peer', and non-peer is not a peer dependency (declarations may import only peers)",
      "dist/sync.d.ts: './sync/group' resolves to dist/sync/group.d.ts, which is in dist/ but not in package.json \"files\", so npm pack leaves it out",
    ]);
  });
});

describe('hasSourceMapDirective', () => {
  it('finds line and block directives in either spelling', () => {
    expect(hasSourceMapDirective('var a=1;\n//# sourceMappingURL=a.js.map\n')).toBe(true);
    expect(hasSourceMapDirective('var a=1;//@ sourceMappingURL=a.js.map')).toBe(true);
    expect(hasSourceMapDirective('var a=1;\n/*# sourceMappingURL=data:application/json;base64,e30= */\n')).toBe(true);
    expect(hasSourceMapDirective('var a = "x";\n//#sourceMappingURL=a.js.map')).toBe(true);
  });

  it('accepts mentions in strings, templates, regular expressions, properties and explanatory comments', () => {
    const text = [
      "const s = '//# sourceMappingURL=not-a-directive.map';",
      'const t = `\n//# sourceMappingURL=${s}\n`;',
      'const r = /\\/\\/# sourceMappingURL=(.*)$/m;',
      'const o = { sourceMappingURL: 1 }; o.sourceMappingURL = 2;',
      '// the build strips every sourceMappingURL comment',
      '/* sourceMappingURL directives are not shipped */',
      'const half = 4 / 2; const x = half / 1; // # sourceMappingURL= is spaced out, so not a directive',
    ].join('\n');
    expect(hasSourceMapDirective(text)).toBe(false);
  });

  it('finds a directive after a regular expression statement that follows a control condition', () => {
    expect(hasSourceMapDirective('if (enabled) /[`]/.test(input);\n//# sourceMappingURL=fixture.js.map\n')).toBe(true);
    expect(hasSourceMapDirective("while (more()) /['\"]/g.exec(s);\n//# sourceMappingURL=fixture.js.map")).toBe(true);
    expect(hasSourceMapDirective('for (;;) /\\/*/.test(s);\n/*# sourceMappingURL=fixture.js.map */')).toBe(true);
  });

  it('finds a directive right after a postfix update divided by a number', () => {
    expect(hasSourceMapDirective('const x=i++/2;//# sourceMappingURL=fixture.js.map')).toBe(true);
    expect(hasSourceMapDirective('let y=n--/2;\n//# sourceMappingURL=fixture.js.map\n')).toBe(true);
  });

  it('still divides after a parenthesised value or a postfix update, and keeps harmless mentions harmless', () => {
    const text = [
      'const q = (a + b) / 2 / c;',
      "const p = i++ / 2; const s = '//# sourceMappingURL=a.map';",
      "if (ready) /\\/\\/# sourceMappingURL=/.test(s);",
      'const w = f(x) / g(y); // sourceMappingURL comments are stripped',
    ].join('\n');
    expect(hasSourceMapDirective(text)).toBe(false);
  });

  // The shapes esbuild emits for each flavour (scripts/build.mjs): minified and readable ESM, readable and
  // minified IIFE, each followed by the trailing directive a build with sourcemap: true would append.
  for (const [name, body] of [
    ['minified ESM', 'var r=/[`]/,a=(t,e)=>t/e;export{a as divide,r as tick};\n'],
    ['readable ESM', '// packages/axylo/src/index.ts\nvar tick = /[`]/;\nfunction divide(t, e) {\n  return t / e;\n}\nexport {\n  divide,\n  tick\n};\n'],
    ['readable IIFE', '"use strict";\nvar Axylo = (() => {\n  var __defProp = Object.defineProperty;\n  var tick = /[`]/;\n  return { tick };\n})();\n'],
    ['minified IIFE', '"use strict";var Axylo=(()=>{var e=/[`]/,t=0;t++/2;return{tick:e}})();\n'],
  ] as const) {
    it(`finds the conventional trailing directive on ${name} output, and none without it`, () => {
      expect(hasSourceMapDirective(body)).toBe(false);
      expect(hasSourceMapDirective(`${body}//# sourceMappingURL=axylo.js.map\n`)).toBe(true);
      expect(hasSourceMapDirective(`${body}//# sourceMappingURL=data:application/json;base64,e30=`)).toBe(true);
    });
  }

  // Runs only when a build has left packages/axylo/dist in place (as ./tools/loupe verify does).
  const builtDist = path.resolve(import.meta.dirname, '../../dist');
  const builtScripts = fs.existsSync(builtDist) ? fs.readdirSync(builtDist).filter(f => f.endsWith('.js')) : [];
  it.skipIf(builtScripts.length === 0)('finds a trailing directive appended to every built dist/*.js, and none in the files as built', () => {
    for (const f of builtScripts) {
      const text = fs.readFileSync(path.join(builtDist, f), 'utf8');
      expect([f, hasSourceMapDirective(text)]).toEqual([f, false]);
      const sep = text.endsWith('\n') ? '' : '\n';
      expect([f, hasSourceMapDirective(`${text}${sep}//# sourceMappingURL=${f}.map\n`)]).toEqual([f, true]);
    }
  });

  it('accepts a shipped file that only mentions the name, and fails one with a directive', () => {
    const mention = { ...FILES, 'dist/axylo.js': "export const strip=s=>s.replace('//# sourceMappingURL=','');" };
    expect(checkDistClosure(fixture(MANIFEST, mention)).errors).toEqual([]);
    const directive = { ...FILES, 'dist/sync.js': 'export const s=1;\n/*# sourceMappingURL=sync.js.map */' };
    expect(checkDistClosure(fixture(MANIFEST, directive)).errors).toEqual([
      'dist/sync.js: shipped JavaScript refers to a source map (sourceMappingURL)',
    ]);
  });
});

describe('scripts/check-dist-closure.mjs run directly', () => {
  const run = (dir: string) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

  it('exits 0 with one summary line on a clean package', () => {
    const r = run(fixture(MANIFEST, FILES));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stdout).toMatch(/^dist closure ok: /);
  });

  it('exits 1 and names the importing file and specifier on a broken one', () => {
    const r = run(fixture(MANIFEST, { ...FILES, 'dist/sync.d.ts': "export * from './sync/group';\n" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("dist/sync.d.ts: './sync/group' resolves to dist/sync/group.d.ts");
  });
});
