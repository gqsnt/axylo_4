/**
 * A clean consumer of the packed packages, for the documentation's examples (spec DX10), set up the way
 * tests/dist does it (tests/dist/README.md, scripts/pack.mjs): `npm pack` each package as npm would publish
 * it, then `npm install --offline` the tarballs through `file:` specifiers into a project of its own, so
 * nothing is linked to the workspace. The consumer lives under apps/docs/.cache (git-ignored):
 *
 *   .cache/packed/<name>-<version>.tgz     the tarballs
 *   .cache/consumer/package.json           axylo
 *   .cache/consumer/node_modules           npm's install of those, offline
 *   .cache/consumer/src/…                  copies of the examples, so they resolve from the consumer
 *
 * The consumer sits under the repository, whose root node_modules links the workspace packages; anything it
 * did not install could be found there by walking up. `guard()` (esbuild) and `listFilesOutside()`
 * (TypeScript) turn such a fallback into an error.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cacheDir, repoRoot } from './examples.mjs';

export const PACKAGES = { axylo: 'packages/axylo' };
export const packedDir = path.join(cacheDir, 'packed');
export const consumerDir = path.join(cacheDir, 'consumer');
const windows = process.platform === 'win32';

// npm started through npm run or Vitest passes its own settings down as npm_config_* variables; the consumer
// installs with defaults, as tests/dist does.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
const npm = (args, options) =>
  execFileSync(windows ? 'npm.cmd' : 'npm', args, { encoding: 'utf8', shell: windows, env, stdio: 'pipe', ...options });

export const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]);
}

/**
 * Packs both packages from their current dist and installs them into the consumer. The install is skipped
 * when the consumer already holds exactly these tarballs (same integrity). Returns what npm pack reported.
 */
export function prepareConsumer({ log = () => {} } = {}) {
  fs.rmSync(packedDir, { recursive: true, force: true });
  fs.mkdirSync(packedDir, { recursive: true });
  const packed = {};
  for (const [name, dir] of Object.entries(PACKAGES)) {
    const [report] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', packedDir], { cwd: path.join(repoRoot, dir) }));
    packed[name] = { tarball: report.filename, integrity: report.integrity, version: report.version, files: report.files.map(f => f.path).sort() };
  }
  fs.mkdirSync(consumerDir, { recursive: true });
  const manifest = {
    name: 'axylo-docs-consumer',
    private: true,
    type: 'module',
    description: 'Installs the packed tarballs for the documentation examples (apps/docs/lib/consumer.mjs). Generated.',
    dependencies: { axylo: `file:../packed/${packed.axylo.tarball}` },
  };
  fs.writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const record = path.join(consumerDir, '.installed.json');
  const wanted = JSON.stringify(Object.fromEntries(Object.entries(packed).map(([n, p]) => [n, p.integrity])));
  const current = fs.existsSync(record) ? fs.readFileSync(record, 'utf8') : '';
  if (current !== wanted || !fs.existsSync(path.join(consumerDir, 'node_modules/axylo'))) {
    fs.rmSync(path.join(consumerDir, 'node_modules'), { recursive: true, force: true });
    const install = mode => npm(['install', mode, '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], { cwd: consumerDir });
    // Only the local tarball is installed, so nothing comes from a registry or the npm cache.
    install('--offline');
    fs.writeFileSync(record, wanted);
    log(`docs consumer: installed ${Object.values(packed).map(p => p.tarball).join(', ')}`);
  }
  for (const [name, p] of Object.entries(packed)) {
    const at = path.join(consumerDir, 'node_modules', name);
    if (fs.lstatSync(at).isSymbolicLink()) throw new Error(`docs consumer: npm linked ${name} instead of installing the tarball`);
    if (walk(at).sort().join('\n') !== p.files.join('\n')) throw new Error(`docs consumer: installed ${name} differs from npm pack's file list`);
  }
  return packed;
}

/** The installed package's directory in the consumer. */
export const installed = name => path.join(consumerDir, 'node_modules', name);

/** An esbuild plugin that fails the build when an import resolves outside the consumer. */
export function guard(roots = [consumerDir]) {
  return {
    name: 'docs-consumer-guard',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async args => {
        if (args.pluginData?.guarded || args.kind === 'entry-point') return undefined;
        const result = await build.resolve(args.path, {
          kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, namespace: args.namespace, pluginData: { guarded: true },
        });
        if (result.errors.length > 0 || result.external || result.namespace !== 'file') return result;
        if (!roots.some(r => inside(r, result.path))) {
          return { errors: [{ text: `[docs consumer guard] ${JSON.stringify(args.path)} from ${args.importer} resolved outside the consumer, to ${result.path}` }] };
        }
        return result;
      });
    },
  };
}

/**
 * Files TypeScript read (`--listFiles` output) that are neither in the consumer nor the compiler's own
 * libraries: a declaration found by walking up into the workspace.
 */
export function listFilesOutside(listing, allowed = []) {
  const typescript = path.dirname(fs.realpathSync(path.join(repoRoot, 'node_modules/typescript/package.json')));
  return listing.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(file => {
    const at = path.resolve(file);
    if (inside(consumerDir, at) || inside(typescript, at) || /[\\/]@typescript[\\/]/.test(at) || /[\\/]lib\.[\w.]*\.d\.ts$/.test(at)) return false;
    return !allowed.some(dir => inside(path.join(repoRoot, 'node_modules', dir), at));
  });
}

const STRICT = {
  target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true,
  noImplicitOverride: true, noFallthroughCasesInSwitch: true, isolatedModules: true, noEmit: true, skipLibCheck: false,
  types: [],
};

/**
 * The consumer's TypeScript configurations: one for the browser examples (the .ts files, and the
 * scripts of the .html examples as JavaScript under checkJs, all strict), one for the Node examples. Library
 * checking is on, so the packed declarations are checked as a consumer's compiler reads them.
 */
export function writeConsumerTsconfigs() {
  const browser = {
    compilerOptions: { ...STRICT, lib: ['ES2022', 'DOM', 'DOM.Iterable'], allowJs: true, checkJs: true },
    include: ['src/*.ts', 'src/*.js'],
  };
  const node = { compilerOptions: { ...STRICT, lib: ['ES2022', 'DOM'] }, include: ['src/node/*.ts'] };
  fs.writeFileSync(path.join(consumerDir, 'tsconfig.json'), JSON.stringify(browser, null, 2));
  fs.writeFileSync(path.join(consumerDir, 'tsconfig.node.json'), JSON.stringify(node, null, 2));
  return { browser: path.join(consumerDir, 'tsconfig.json'), node: path.join(consumerDir, 'tsconfig.node.json') };
}
