import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citedTestFiles, hashFile, snapshot } from './provenance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const configs = {
  unit: [],
  browser: [],
  dist: ['--config', 'tests/dist/vitest.config.ts'],
  'dist-browser': ['--config', 'tests/dist/vitest.config.ts'],
};
const [name, ...args] = process.argv.slice(2);
const customOutput = args[0] === '--output';
const result = customOutput ? args[1] : `acceptance/results/${name}.json`;
const filters = customOutput ? args.slice(2) : args;
if (!Object.hasOwn(configs, name) || !result?.endsWith('.json') || filters.some(filter => filter.startsWith('-'))) {
  console.error('Usage: node acceptance/run.mjs <unit|browser|dist|dist-browser> [--output result.json] [test file filters…]');
  process.exitCode = 1;
} else {
  const matrix = JSON.parse(readFileSync(resolve(root, 'acceptance/matrix.json'), 'utf8'));
  const files = citedTestFiles(matrix);
  const before = snapshot(root, files);
  const output = resolve(root, result);
  const provenance = output.slice(0, -5) + '.provenance.json';
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  rmSync(provenance, { force: true });
  const env = { ...process.env };
  if (name.includes('browser')) env.AXYLO_BROWSER = '1';
  else delete env.AXYLO_BROWSER;
  const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
  const run = spawnSync('timeout', ['--kill-after=5', '400', process.execPath, vitest, 'run', ...configs[name],
    '--reporter=json', '--outputFile=' + output, ...filters], { cwd: root, env, stdio: 'inherit' });
  const after = snapshot(root, files);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (existsSync(output) && (run.status === 0 || run.status === 1)) {
    writeFileSync(provenance, JSON.stringify({
      ...before, resultSha256: hashFile(output), changedDuringRun: changed,
    }, null, 2) + '\n');
  }
  if (changed) console.error('The working tree changed during Vitest. The release checker will reject this result.');
  if (run.error) console.error(run.error.message);
  process.exitCode = changed ? 1 : run.status ?? 1;
}
