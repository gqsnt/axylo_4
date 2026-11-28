/**
 * Real consumer bundlers on the packed tarball (plan M7, spec DX7): Rollup 4 with @rollup/plugin-node-resolve,
 * webpack 5 with css-loader and mini-css-extract-plugin, and Vite in production mode. Every consumer is built
 * from inside the npm fixture, which installed the tarball (scripts/pack.mjs), and every `axylo` import must
 * resolve to a file of that installed package: a resolution that fails, is external, or lands anywhere else
 * (the workspace package, the repository's node_modules) fails the test. Nothing is aliased.
 *
 * What the packed package.json declares and these builds check:
 *   - `sideEffects: ["*.css"]`: only stylesheets have side effects, so a bare `import 'axylo'` (or a subpath)
 *     leaves no JavaScript, while `import 'axylo/axylo.css'` is kept and its stylesheet emitted (webpack's rule:
 *     a pattern without a slash matches the file name, so `*.css` matches dist/axylo.css);
 *   - `exports`: each entry has `development` and `default` targets and no `production` key, so webpack's
 *     development mode picks the .dev.js file and its production mode (condition `production`) falls through to
 *     `default`.
 * Temporary output lives under tests/dist/.out/bundlers and is removed afterwards.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rollup, type OutputChunk, type Plugin as RollupPlugin, type RollupLog } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import webpack, { type Compiler, type Configuration, type Module, type Stats } from 'webpack';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { build as viteBuild, type Plugin as VitePlugin, type Rollup } from 'vite';
import { fixture, inside, installed, out, packedJson } from './paths';

const require = createRequire(import.meta.url);
const root = fixture('npm');
const work = path.join(out, 'bundlers');
/** The installed package as Node sees it on disk (npm unpacks a file: tarball into a real directory). */
let pkg: string;
let packedCss: string;
const cssLoader = require.resolve('css-loader');
/** Loader packages: webpack runs their runtime modules at build time to extract the stylesheet. */
const loaderDirs = [path.dirname(require.resolve('css-loader/package.json')), path.dirname(require.resolve('mini-css-extract-plugin/package.json'))].map(d => fs.realpathSync(d));

/** Each entry point and an export a consumer uses from it, with the file its `default` target names. */
const ENTRIES = [
  ['axylo', 'line', 'axylo'],
  ['axylo/static', 'line', 'static'],
  ['axylo/stream', 'line', 'stream'],
  ['axylo/cartesian', 'cartesian', 'cartesian'],
  ['axylo/stats', 'quantile', 'stats'],
  ['axylo/sync', 'createSyncGroup', 'sync'],
  ['axylo/export', 'exportSvg', 'export'],
  ['axylo/finance', 'candlestick', 'finance'],
  ['axylo/spatial', 'heatmap', 'spatial'],
  ['axylo/hierarchy', 'treemap', 'hierarchy'],
] as const;
const entryName = (specifier: string) => specifier.replace('/', '-');
/** A consumer that uses one export: it hands it to the page, so no bundler may drop it. */
const using = (specifier: string, name: string) => `import { ${name} } from '${specifier}';\nglobalThis.__used = ${name};\n`;
const file = (base: string, dev = false) => path.join(pkg, 'dist', `${base}${dev ? '.dev' : ''}.js`);

beforeAll(() => {
  pkg = fs.realpathSync(installed('axylo'));
  // The tarball the fixture installed, not the workspace package the repository links as node_modules/axylo.
  expect(inside(root, pkg), `installed axylo at ${pkg} is inside the npm fixture`).toBe(true);
  packedCss = fs.readFileSync(path.join(pkg, 'dist/axylo.css'), 'utf8');
  expect(packedCss.length).toBeGreaterThan(100);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

it('the packed manifest declares what these builds rely on: sideEffects ["*.css"], development and default targets, no production key', () => {
  const json = packedJson('axylo');
  expect(json.sideEffects).toEqual(['*.css']);
  for (const [specifier, , base] of ENTRIES) {
    const key = specifier === 'axylo' ? '.' : `./${specifier.slice('axylo/'.length)}`;
    expect(json.exports?.[key], key).toEqual({ types: `./dist/${base === 'axylo' ? 'index' : base}.d.ts`, development: `./dist/${base}.dev.js`, default: `./dist/${base}.js` });
  }
  expect(json.exports?.['./axylo.css']).toBe('./dist/axylo.css');
});

/** Where a resolved `axylo` file must be: in the installed package, and the same file once symlinks are followed. */
function expectPacked(id: string, what: string): void {
  expect(path.isAbsolute(id), `${what}: ${id} is a file path`).toBe(true);
  expect(inside(pkg, id), `${what}: ${id} is inside the installed package ${pkg}`).toBe(true);
  expect(fs.realpathSync(id), `${what}: ${id} is not a link out of the package`).toBe(id);
}

describe('Rollup 4 with @rollup/plugin-node-resolve', () => {
  /**
   * Entries are virtual modules with ids inside the fixture, so node-resolve looks up `axylo` from the fixture's
   * node_modules. Every `axylo` import is resolved through the other plugins and recorded; one that does not
   * resolve, or resolves as external, throws.
   */
  function consumers(entries: Record<string, string>, resolved: { source: string; id: string }[]): RollupPlugin {
    const ids = new Map(Object.entries(entries).map(([name, code]) => [path.join(root, `__rollup_${name}.js`), code]));
    return {
      name: 'axylo-consumers',
      async resolveId(source, importer, options) {
        if (!importer && ids.has(source)) return source;
        if (source !== 'axylo' && !source.startsWith('axylo/')) return null;
        const r = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!r || r.external) throw new Error(`${source} from ${importer ?? '(entry)'} did not resolve to a bundled file`);
        resolved.push({ source, id: r.id });
        return r;
      },
      load: id => ids.get(id) ?? null,
    };
  }
  async function bundle(entries: Record<string, string>) {
    const resolved: { source: string; id: string }[] = [];
    const warnings: RollupLog[] = [];
    const b = await rollup({
      input: Object.fromEntries(Object.keys(entries).map(n => [n, path.join(root, `__rollup_${n}.js`)])),
      // Pass 'production' explicitly: @rollup/plugin-node-resolve 16 appends 'development' whenever
      // NODE_ENV is set to anything other than 'production' (Vitest sets NODE_ENV=test).
      plugins: [consumers(entries, resolved), nodeResolve({ browser: true, exportConditions: ['production'], rootDir: root })],
      onwarn: w => { warnings.push(w); },
    });
    try {
      const { output } = await b.generate({ format: 'es' });
      return { output, resolved, warnings, loaded: b.watchFiles };
    } finally {
      await b.close();
    }
  }

  it('bundles the root and all nine opt-in entry points, each from its packed default file', async () => {
    const { output, resolved, warnings } = await bundle(Object.fromEntries(ENTRIES.map(([s, name]) => [entryName(s), using(s, name)])));
    expect(warnings.map(w => `${w.code}: ${w.message}`)).toEqual([]);
    for (const [specifier, , base] of ENTRIES) {
      const hits = resolved.filter(r => r.source === specifier);
      expect(hits.length, specifier).toBeGreaterThan(0);
      for (const hit of hits) {
        expectPacked(hit.id, specifier);
        expect(hit.id, `${specifier} resolves to its default target`).toBe(file(base));
      }
      const chunk = output.find((c): c is OutputChunk => c.type === 'chunk' && c.isEntry && c.name === entryName(specifier));
      expect(chunk, specifier).toBeDefined();
      expect(chunk!.imports, `${specifier} leaves nothing external`).toEqual([]);
      expect(chunk!.moduleIds.filter(id => !id.startsWith(path.join(root, '__rollup_'))), `${specifier} bundles only its packed file`).toEqual([file(base)]);
      expect(chunk!.modules[file(base)]!.renderedLength, `${specifier} keeps the code of ${base}.js`).toBeGreaterThan(0);
    }
  });

  it('tree-shakes a bare import of axylo, axylo/spatial or axylo/hierarchy to no code at all', async () => {
    const bare = { 'bare-root': "import 'axylo';\n", 'bare-spatial': "import 'axylo/spatial';\n", 'bare-hierarchy': "import 'axylo/hierarchy';\n" };
    const { output, resolved, warnings } = await bundle(bare);
    // Rollup reports each empty chunk; any other warning (an unresolved import, say) fails.
    expect(warnings.filter(w => w.code !== 'EMPTY_BUNDLE').map(w => `${w.code}: ${w.message}`)).toEqual([]);
    for (const [name, specifier, base] of [['bare-root', 'axylo', 'axylo'], ['bare-spatial', 'axylo/spatial', 'spatial'], ['bare-hierarchy', 'axylo/hierarchy', 'hierarchy']] as const) {
      // The import resolved to the packed file (so the empty output is tree-shaking, not a missing module) …
      expect([...new Set(resolved.filter(r => r.source === specifier).map(r => r.id))], specifier).toEqual([file(base)]);
      const chunk = output.find((c): c is OutputChunk => c.type === 'chunk' && c.isEntry && c.name === name)!;
      // … and nothing of it, nor any import of it, is left.
      expect(chunk.code.trim(), `${specifier}: no code`).toBe('');
      expect(Buffer.byteLength(chunk.code.trim())).toBe(0);
      expect(chunk.imports).toEqual([]);
      expect(Object.values(chunk.modules).reduce((n, m) => n + m.renderedLength, 0)).toBe(0);
    }
  });
});

describe('webpack 5 with css-loader and mini-css-extract-plugin', () => {
  interface Built { stats: Stats; dir: string; resolved: { request: string; resource: string }[]; chunks: Map<string, string[]> }

  /** Records every request the module factory resolved, and the file it resolved to. */
  class Recorder {
    constructor(private readonly list: { request: string; resource: string }[]) {}
    apply(compiler: Compiler): void {
      compiler.hooks.normalModuleFactory.tap('axylo-recorder', factory => {
        factory.hooks.afterResolve.tap('axylo-recorder', data => {
          this.list.push({ request: data.request, resource: (data.createData as { resource?: string }).resource ?? '' });
        });
      });
    }
  }

  /** Files of the modules a chunk contains, concatenated modules included. */
  function chunkFiles(stats: Stats): Map<string, string[]> {
    const { compilation } = stats;
    const map = new Map<string, string[]>();
    const filesOf = (m: Module): string[] => {
      const nested = (m as unknown as { modules?: Iterable<Module> }).modules;
      if (nested) return [...nested].flatMap(filesOf);
      const name = m.nameForCondition();
      return name ? [name] : [];
    };
    for (const chunk of compilation.chunks) {
      map.set(chunk.name ?? '', [...compilation.chunkGraph.getChunkModulesIterable(chunk)].flatMap(filesOf));
    }
    return map;
  }

  async function compile(name: string, mode: 'production' | 'development', entries: Record<string, string>): Promise<Built> {
    const dir = path.join(work, `webpack-${name}`);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const entry: Record<string, string> = {};
    for (const [n, code] of Object.entries(entries)) {
      entry[n] = path.join(dir, 'src', `${n}.js`);
      fs.writeFileSync(entry[n]!, code);
    }
    const resolved: { request: string; resource: string }[] = [];
    const config: Configuration = {
      mode, context: dir, entry, target: 'web', devtool: false,
      output: { path: path.join(dir, 'out'), filename: '[name].js', clean: true },
      // The fixture's node_modules only: an absolute modules directory is searched alone, with no walk up
      // into the repository's node_modules (where `axylo` is the workspace package).
      resolve: { modules: [path.join(root, 'node_modules')], symlinks: true },
      module: { rules: [{ test: /\.css$/, use: [MiniCssExtractPlugin.loader, cssLoader] }] },
      plugins: [new MiniCssExtractPlugin({ filename: '[name].css' }), new Recorder(resolved)],
      // Production keeps sideEffects, usedExports and concatenation on; the minifier is off to stay fast, and
      // the pruning checked here is done by those flags, not by the minifier.
      optimization: { minimize: false },
      performance: false, cache: false, stats: 'none', infrastructureLogging: { level: 'none' },
    };
    const compiler = webpack(config);
    const stats = await new Promise<Stats>((resolve, reject) => compiler.run((error, result) => {
      compiler.close(() => {});
      if (error || !result) reject(error ?? new Error('webpack returned no stats'));
      else resolve(result);
    }));
    const info = stats.toJson({ all: false, errors: true, warnings: true });
    expect(info.errors?.map(e => e.message) ?? []).toEqual([]);
    expect(info.warnings?.map(w => w.message) ?? []).toEqual([]);
    // Nothing outside the entries, the installed package and the loaders' own runtime is read.
    const sources = new Set(Object.values(entry));
    for (const r of resolved) {
      const real = r.resource && fs.existsSync(r.resource) ? fs.realpathSync(r.resource) : r.resource;
      const ok = sources.has(r.resource) || inside(pkg, r.resource) || loaderDirs.some(d => inside(d, real));
      expect(ok, `${r.request} resolved to ${r.resource}`).toBe(true);
      if (r.request === 'axylo' || r.request.startsWith('axylo/')) expectPacked(r.resource, r.request);
    }
    return { stats, dir, resolved, chunks: chunkFiles(stats) };
  }
  const read = (b: Built, name: string) => fs.readFileSync(path.join(b.dir, 'out', name), 'utf8');
  const resourceOf = (b: Built, request: string) => [...new Set(b.resolved.filter(r => r.request === request).map(r => r.resource))];

  it('production: bundles the root and all nine opt-in entry points from their packed default files (no production key, so default)', async () => {
    const b = await compile('used', 'production', Object.fromEntries(ENTRIES.map(([s, name]) => [entryName(s), using(s, name)])));
    for (const [specifier, , base] of ENTRIES) {
      expect(resourceOf(b, specifier), specifier).toEqual([file(base)]);
      const files = b.chunks.get(entryName(specifier)) ?? [];
      expect(files, `${specifier} chunk holds ${base}.js`).toContain(file(base));
      expect(files, `${specifier} chunk holds no development file`).not.toContain(file(base, true));
      expect(files.filter(f => inside(pkg, f)), `${specifier} bundles only its packed file`).toEqual([file(base)]);
      expect(read(b, `${entryName(specifier)}.js`).length).toBeGreaterThan(1000);
    }
  }, 20_000);

  it('production: drops the JavaScript of a bare import of axylo and keeps axylo/axylo.css (sideEffects "*.css"), extracting the packed stylesheet', async () => {
    const b = await compile('side-effects', 'production', {
      bare: "import 'axylo';\n",
      styled: "import 'axylo';\nimport 'axylo/axylo.css';\n",
    });
    // Both imports resolved to the packed files: what is missing below was pruned, not unresolved.
    expect(resourceOf(b, 'axylo')).toEqual([file('axylo')]);
    expect(resourceOf(b, 'axylo/axylo.css')).toEqual([path.join(pkg, 'dist/axylo.css')]);
    for (const name of ['bare', 'styled']) {
      const files = b.chunks.get(name) ?? [];
      expect(files.filter(f => f.endsWith('.js') && inside(pkg, f)), `${name}: no packed JavaScript is bundled`).toEqual([]);
      expect(read(b, `${name}.js`).length, `${name}.js is only webpack's runtime`).toBeLessThan(2000);
    }
    expect(b.chunks.get('styled'), 'the stylesheet module is kept').toContain(path.join(pkg, 'dist/axylo.css'));
    const assets = fs.readdirSync(path.join(b.dir, 'out'));
    expect(assets.filter(a => a.endsWith('.css'))).toEqual(['styled.css']);
    const css = read(b, 'styled.css');
    expect(css.trim().length).toBeGreaterThan(100);
    // css-loader re-prints the stylesheet; compared without whitespace, it is the packed file.
    const squash = (s: string) => s.replace(/\s+/g, '');
    expect(squash(css)).toContain(squash(packedCss));
  }, 20_000);

  it('development resolves the development files and production the default files of the same imports', async () => {
    const entries = { root: using('axylo', 'line'), spatial: using('axylo/spatial', 'heatmap') };
    const dev = await compile('development', 'development', entries);
    const prod = await compile('production', 'production', entries);
    expect(resourceOf(dev, 'axylo')).toEqual([file('axylo', true)]);
    expect(resourceOf(dev, 'axylo/spatial')).toEqual([file('spatial', true)]);
    expect(resourceOf(prod, 'axylo')).toEqual([file('axylo')]);
    expect(resourceOf(prod, 'axylo/spatial')).toEqual([file('spatial')]);
    expect(dev.chunks.get('root')).toContain(file('axylo', true));
    expect(dev.chunks.get('root')).not.toContain(file('axylo'));
    expect(prod.chunks.get('root')).toContain(file('axylo'));
    expect(prod.chunks.get('root')).not.toContain(file('axylo', true));
    expect(file('axylo', true)).not.toBe(file('axylo'));
  }, 20_000);
});

describe('Vite, production build', () => {
  it('bundles axylo, axylo/spatial, axylo/hierarchy and axylo/axylo.css from the npm fixture root, every module from the packed files', async () => {
    const entry = path.join(root, '__vite_consumer.js');
    const code = [
      "import { line } from 'axylo';",
      "import { heatmap } from 'axylo/spatial';",
      "import { treemap } from 'axylo/hierarchy';",
      "import 'axylo/axylo.css';",
      'globalThis.__used = [line, heatmap, treemap];',
    ].join('\n');
    const resolved: { source: string; id: string }[] = [];
    const consumer: VitePlugin = {
      name: 'axylo-consumer',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (source === entry) return entry;
        if (source !== 'axylo' && !source.startsWith('axylo/')) return null;
        const r = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!r || r.external) throw new Error(`${source} did not resolve to a bundled file`);
        resolved.push({ source, id: r.id });
        return r;
      },
      load: id => (id === entry ? code : null),
    };
    // Vite 8 preserves a preexisting NODE_ENV (Vitest sets NODE_ENV=test) even with mode: 'production',
    // and derives isProduction—and thus its 'development|production' export condition—from NODE_ENV.
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let result: Awaited<ReturnType<typeof viteBuild>>;
    try {
      result = await viteBuild({
        root, configFile: false, envFile: false, logLevel: 'silent', mode: 'production', publicDir: false,
        cacheDir: path.join(work, 'vite-cache'),
        resolve: { preserveSymlinks: true },
        plugins: [consumer],
        build: {
          write: false, outDir: path.join(work, 'vite-out'), emptyOutDir: false, minify: false, copyPublicDir: false,
          rolldownOptions: { input: entry },
        },
      });
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
    const outputs = (Array.isArray(result) ? result : [result as Rollup.RollupOutput]).flatMap(r => r.output);
    for (const [specifier, target] of [['axylo', file('axylo')], ['axylo/spatial', file('spatial')], ['axylo/hierarchy', file('hierarchy')], ['axylo/axylo.css', path.join(pkg, 'dist/axylo.css')]] as const) {
      const ids = [...new Set(resolved.filter(r => r.source === specifier).map(r => r.id))];
      expect(ids, specifier).toEqual([target]);
      expectPacked(ids[0]!, specifier);
    }
    const chunks = outputs.filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
    // Module ids that name files (bundler runtimes are virtual ids, not paths): the entry and packed files only.
    const modules = chunks.flatMap(c => c.moduleIds).map(id => id.replace(/\?.*$/, '')).filter(id => id !== entry && path.isAbsolute(id));
    for (const target of [file('axylo'), file('spatial'), file('hierarchy')]) expect(modules, 'bundled').toContain(target);
    for (const id of modules) expectPacked(id, 'module');
    expect(modules.filter(id => /\.dev\.js$/.test(id))).toEqual([]);
    const css = outputs.filter((o): o is Rollup.OutputAsset => o.type === 'asset' && o.fileName.endsWith('.css'));
    expect(css.length, 'one stylesheet asset').toBe(1);
    const text = typeof css[0]!.source === 'string' ? css[0]!.source : Buffer.from(css[0]!.source).toString('utf8');
    const squash = (s: string) => s.replace(/\s+/g, '');
    expect(text.trim().length).toBeGreaterThan(100);
    expect(squash(text)).toContain(squash(packedCss).slice(0, 200));
  }, 20_000);
});
