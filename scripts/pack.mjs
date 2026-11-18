// Packs the two published packages as npm would publish them and installs the tarballs into the fixtures under
// tests/dist/fixtures with npm itself, offline (plan M7; spec DX1, DX7, DX8, DX10).
//
//   node scripts/pack.mjs             runs the root build first (npm run build)
//   node scripts/pack.mjs --no-build  packs whatever packages/*/dist holds now
//
// Output (all git-ignored):
//   tests/dist/.packed/<name>-<version>.tgz   the tarballs, exactly what `npm publish` would upload
//   tests/dist/.packed/manifest.json          what npm pack reported (file list, integrity) per package
//   tests/dist/fixtures/<fixture>/node_modules  `npm install --offline` of the fixture's own package.json: the
//                                               packed tarballs through their `file:` specifiers, third-party
//                                               packages (react, its types) from the npm cache. No links.
//   tests/dist/fixtures/<fixture>/example/    copies of examples/first-chart, so they resolve from the fixture
//
// Every fixture sits under the repository, whose root node_modules links the workspace packages; resolution
// from a fixture could fall back to them for anything it did not install. `fixtureGuard` (esbuild) and
// tests/dist/guard/node-guard.mjs (Node) fail any resolution that leaves the fixture, so such a fallback is an
// error rather than a silent pass. The install is --offline; only if the npm cache lacks the metadata for the
// fixtures' third-party packages (a cache filled by `npm ci` alone) does it fall back to --prefer-offline.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const distTests = path.join(root, 'tests/dist');
const packed = path.join(distTests, '.packed');
const windows = process.platform === 'win32';

export const PACKAGES = { axylo: 'packages/axylo', '@axylo/react': 'packages/react' };

/** The fixtures and the first-chart examples each one carries. What each installs is its own package.json. */
export const FIXTURES = { npm: ['npm.ts'], script: ['script.html'], react: ['react.tsx'] };

// npm run, npx and Vitest started through them pass their own settings down as npm_config_* variables
// (one of them, allow-scripts, makes a project install refuse to run); the fixtures install with defaults.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
const run = (command, args, options = {}) =>
  execFileSync(windows ? `${command}.cmd` : command, args, { cwd: root, encoding: 'utf8', shell: windows, env, ...options });

const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** Files under `dir`, as forward-slash paths relative to it. */
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]);
}

/**
 * An esbuild plugin that fails the build when any import resolves outside `roots` (absolute directories):
 * what esbuild would otherwise find by walking up from a fixture into the repository's node_modules.
 */
export function fixtureGuard(roots) {
  return {
    name: 'fixture-guard',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async args => {
        if (args.pluginData?.guarded || args.kind === 'entry-point') return undefined;
        const result = await build.resolve(args.path, {
          kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, namespace: args.namespace, pluginData: { guarded: true },
        });
        if (result.errors.length > 0 || result.external || result.namespace !== 'file') return result;
        if (!roots.some(r => inside(r, result.path))) {
          return { errors: [{ text: `[fixture guard] ${JSON.stringify(args.path)} imported from ${args.importer || '(stdin)'} resolved outside the fixture, to ${result.path}` }] };
        }
        return result;
      });
    },
  };
}

export function pack({ build = true, log = console.log } = {}) {
  if (build) run('npm', ['run', 'build'], { stdio: 'inherit' });
  fs.rmSync(packed, { recursive: true, force: true });
  fs.mkdirSync(packed, { recursive: true });

  const manifest = { packedAt: new Date().toISOString(), packages: {} };
  for (const [name, dir] of Object.entries(PACKAGES)) {
    const out = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packed], { cwd: path.join(root, dir) });
    const [report] = JSON.parse(out);
    manifest.packages[name] = {
      directory: dir,
      tarball: report.filename,
      integrity: report.integrity,
      size: report.size,
      unpackedSize: report.unpackedSize,
      files: report.files.map(f => f.path).sort(),
    };
    log(`packed ${report.filename}: ${report.files.length} files, ${report.size} bytes`);
  }

  for (const [fixture, examples] of Object.entries(FIXTURES)) {
    const dir = path.join(distTests, 'fixtures', fixture);
    for (const generated of ['node_modules', 'example', '.out']) fs.rmSync(path.join(dir, generated), { recursive: true, force: true });
    const install = mode => run('npm', ['install', mode, '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], { cwd: dir, stdio: 'pipe' });
    try {
      install('--offline');
    } catch (error) {
      // A cache filled by `npm ci` holds tarballs but not the registry metadata a version range needs; only
      // then is the registry asked, for the fixtures' third-party packages (never for ours).
      if (!/ENOTCACHED/.test(String(error.stderr ?? error))) throw error;
      log(`${fixture}: npm cache incomplete, installing with --prefer-offline`);
      install('--prefer-offline');
    }
    const declared = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const name of Object.keys(declared.dependencies ?? {}).filter(n => n in PACKAGES)) {
      const at = path.join(dir, 'node_modules', name);
      if (fs.lstatSync(at).isSymbolicLink()) throw new Error(`${fixture}: npm linked ${name} instead of installing the tarball`);
      const files = walk(at).sort();
      if (files.join('\n') !== manifest.packages[name].files.join('\n')) throw new Error(`${fixture}: installed ${name} differs from npm pack's file list`);
    }
    fs.mkdirSync(path.join(dir, 'example'), { recursive: true });
    for (const file of examples) fs.copyFileSync(path.join(root, 'examples/first-chart', file), path.join(dir, 'example', file));
  }
  fs.writeFileSync(path.join(packed, 'manifest.json'), JSON.stringify(manifest, null, 1));
  log(`fixtures installed: ${Object.keys(FIXTURES).join(', ')}`);
  return manifest;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  pack({ build: !process.argv.includes('--no-build') });
}
