import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const kinds = new Set(['unit', 'property', 'browser']);
const sha = value => createHash('sha256').update(value).digest('hex');

export const hashFile = file => sha(readFileSync(file));

/** The browser engines the browser harness can run (AXYLO_ENGINE), and how a report names each one. */
export const ENGINES = ['chromium', 'firefox', 'webkit'];
const ENGINE_LABELS = { chromium: 'Chrome', firefox: 'Firefox (Playwright)', webkit: 'WebKit (Playwright), not Safari' };
export const engineLabel = (engine, version) => `${ENGINE_LABELS[engine] ?? engine}${version ? ' ' + version : ''}`;

/**
 * The engines a Vitest JSON report declares: the harness writes `meta.engine` and `meta.engineVersion` on
 * every test it runs. A test without them was not run through that harness.
 */
export function declaredEngines(results) {
  const engines = new Set();
  const versions = new Set();
  for (const suite of results?.testResults ?? []) for (const test of suite?.assertionResults ?? []) {
    const engine = test?.meta?.engine;
    if (engine === undefined) continue;
    if (!ENGINES.includes(engine)) throw new Error(`unknown engine ${JSON.stringify(engine)} in ${suite.name}: ${test.title}`);
    engines.add(engine);
    if (typeof test.meta.engineVersion === 'string' && test.meta.engineVersion !== '') versions.add(`${engine} ${test.meta.engineVersion}`);
  }
  return { engines: [...engines].sort(), versions: [...versions].sort() };
}

/**
 * The Vitest configurations acceptance/run.mjs records, each with its Vitest arguments. `browser` runs on the
 * engine AXYLO_ENGINE names; `dist-browser` launches system Chrome itself; `unit` and `dist` run in Node.
 */
export const CONFIGURATIONS = Object.freeze({
  unit: Object.freeze([]),
  browser: Object.freeze([]),
  dist: Object.freeze(['--config', 'tests/dist/vitest.config.ts']),
  'dist-browser': Object.freeze(['--config', 'tests/dist/vitest.config.ts']),
});
export const CONFIGS = Object.freeze(Object.keys(CONFIGURATIONS));

/** Where a configuration's results go by default: the browser configuration gets one file per engine. */
export const defaultResultFile = (name, engine = 'chromium') =>
  `acceptance/results/${name === 'browser' && engine !== 'chromium' ? `${name}-${engine}` : name}.json`;

/**
 * Every default result file run.mjs can write, repository-relative, with its configuration and the engine
 * its tests run on (null: Node).
 */
export function resultFiles() {
  return CONFIGS.flatMap(config => config === 'browser'
    ? ENGINES.map(engine => ({ config, engine, file: defaultResultFile(config, engine) }))
    : [{ config, engine: config === 'dist-browser' ? 'chromium' : null, file: defaultResultFile(config) }]);
}

export function citedTestFiles(matrix) {
  const files = new Set();
  for (const row of matrix) {
    for (const citations of [row.evidence, row.weak]) {
      for (const refs of Object.values(citations ?? {})) {
        for (const { kind, file } of refs) if (kinds.has(kind)) files.add(file);
      }
    }
  }
  return [...files].sort();
}

export function snapshot(root, files) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
  const commit = git('rev-parse', 'HEAD').trim();
  const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':(exclude)acceptance/report.md');
  const tree = createHash('sha256').update(status);
  // A dirty flag alone cannot distinguish two edits to the same library file.
  const changed = new Set(git('ls-files', '-m', '-o', '--exclude-standard', '-z').split('\0'));
  for (const file of [...changed].sort()) {
    if (!file || file === 'acceptance/report.md') continue;
    const path = resolve(root, file);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    const content = stat?.isSymbolicLink() ? readlinkSync(path) : stat?.isFile() ? readFileSync(path) : '';
    tree.update(JSON.stringify([file, stat?.mode, sha(content)]));
  }
  // Include edits staged against HEAD even when the index matches the working file.
  tree.update(git('diff', '--cached', '--binary', 'HEAD', '--', '.', ':(exclude)acceptance/report.md'));
  // A cited file that is gone is the matrix's structural error, which the checker reports; the run still records.
  const hashes = Object.fromEntries(files.map(file => [file, lstatSync(resolve(root, file), { throwIfNoEntry: false })?.isFile() ? hashFile(resolve(root, file)) : null]));
  return { commit, dirty: status.length > 0, tree: tree.digest('hex'), hashes };
}
