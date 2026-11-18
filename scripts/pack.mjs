// Packs the two published packages as npm would publish them and installs the tarballs into the fixtures under
// tests/dist/fixtures, without a registry (plan M7; spec DX1, DX7, DX8, DX10).
//
//   node scripts/pack.mjs             runs the root build first (npm run build)
//   node scripts/pack.mjs --no-build  packs whatever packages/*/dist holds now
//
// Output (all git-ignored):
//   tests/dist/.packed/<name>-<version>.tgz   the tarballs, exactly what `npm publish` would upload
//   tests/dist/.packed/manifest.json          what npm pack reported (file list, integrity) per package
//   tests/dist/fixtures/<fixture>/node_modules  the tarballs unpacked as an install would, plus links to the
//                                               root node_modules for third-party packages (react, types)
//   tests/dist/fixtures/<fixture>/example/    copies of examples/first-chart, so they resolve from the fixture
//
// The packages are unpacked, never linked: a fixture must reach `axylo` and `@axylo/react` only through the
// packed files and their `exports`, never through the workspace symlinks in the root node_modules.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const distTests = path.join(root, 'tests/dist');
const packed = path.join(distTests, '.packed');
const windows = process.platform === 'win32';

export const PACKAGES = { axylo: 'packages/axylo', '@axylo/react': 'packages/react' };

/** What each fixture installs. `links` come from the root node_modules: third-party code, not ours. */
export const FIXTURES = {
  npm: { packages: ['axylo'], links: [], examples: ['npm.ts'] },
  script: { packages: ['axylo'], links: [], examples: ['script.html'] },
  react: {
    packages: ['axylo', '@axylo/react'],
    links: ['react', 'react-dom', '@types/react', '@types/react-dom'],
    examples: ['react.tsx'],
  },
};

const run = (command, args, options = {}) =>
  execFileSync(windows ? `${command}.cmd` : command, args, { cwd: root, encoding: 'utf8', shell: windows, ...options });

/** Extracts a gzipped tarball as npm writes it (ustar, with pax or GNU long names), dropping the `package/` prefix. */
export function untar(tarball, destination) {
  const buffer = gunzipSync(fs.readFileSync(tarball));
  const written = [];
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = parseInt(text(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const body = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'L') {
      if (type === 'L') longName = body.toString('utf8').replace(/\0[\s\S]*$/, '');
      else for (const line of body.toString('utf8').split('\n')) {
        const match = /^\d+ path=(.*)$/.exec(line);
        if (match) longName = match[1];
      }
      continue;
    }
    if (type === 'g') continue;
    const prefix = text(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    longName = null;
    const relative = name.replace(/^package\//, '');
    // A tarball is input we did not write by hand: refuse anything that would land outside the destination.
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`unsafe path in ${tarball}: ${name}`);
    const target = path.join(destination, relative);
    if (type === '5') { fs.mkdirSync(target, { recursive: true }); continue; }
    if (type !== '0') throw new Error(`unexpected entry type ${JSON.stringify(type)} for ${name} in ${tarball}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    written.push(relative.split(path.sep).join('/'));
  }
  return written;
}

function link(fixtureModules, name) {
  const source = path.join(root, 'node_modules', name);
  if (!fs.existsSync(source)) throw new Error(`${name} is not installed in the root node_modules`);
  const at = path.join(fixtureModules, name);
  fs.mkdirSync(path.dirname(at), { recursive: true });
  // A junction needs no privilege on Windows; the type is ignored elsewhere.
  fs.symlinkSync(fs.realpathSync(source), at, 'junction');
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

  for (const [fixture, plan] of Object.entries(FIXTURES)) {
    const dir = path.join(distTests, 'fixtures', fixture);
    const modules = path.join(dir, 'node_modules');
    fs.rmSync(modules, { recursive: true, force: true });
    fs.rmSync(path.join(dir, 'example'), { recursive: true, force: true });
    for (const name of plan.packages) {
      const files = untar(path.join(packed, manifest.packages[name].tarball), path.join(modules, name));
      const expected = manifest.packages[name].files;
      if (files.slice().sort().join('\n') !== expected.join('\n')) throw new Error(`${name}: unpacked files differ from npm pack's list`);
    }
    for (const name of plan.links) link(modules, name);
    fs.mkdirSync(path.join(dir, 'example'), { recursive: true });
    for (const file of plan.examples) fs.copyFileSync(path.join(root, 'examples/first-chart', file), path.join(dir, 'example', file));
  }
  fs.writeFileSync(path.join(packed, 'manifest.json'), JSON.stringify(manifest, null, 1));
  log(`fixtures ready: ${Object.keys(FIXTURES).join(', ')}`);
  return manifest;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  pack({ build: !process.argv.includes('--no-build') });
}
