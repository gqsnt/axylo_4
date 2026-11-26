import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citedTestFiles, CONFIGURATIONS as configs, declaredEngines, defaultResultFile, ENGINES, hashFile, snapshot } from './provenance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [name, ...args] = process.argv.slice(2);
// The browser harness (packages/axylo/test/browser/harness.ts) reads AXYLO_ENGINE; the distribution suite's
// own harness always launches system Chrome, so another engine there would be recorded but not used.
const engine = process.env.AXYLO_ENGINE || 'chromium';
const customOutput = args[0] === '--output';
const result = customOutput ? args[1] : defaultResultFile(name, engine);
const filters = customOutput ? args.slice(2) : args;
if (!Object.hasOwn(configs, name) || !result?.endsWith('.json') || filters.some(filter => filter.startsWith('-'))) {
  console.error('Usage: [AXYLO_ENGINE=chromium|firefox|webkit] node acceptance/run.mjs <unit|browser|dist|dist-browser> [--output result.json] [test file filters…]');
  process.exitCode = 1;
} else if (!ENGINES.includes(engine) || (engine !== 'chromium' && name !== 'browser')) {
  console.error(`AXYLO_ENGINE=${engine}: the browser configuration takes ${ENGINES.join(', ')}; the other configurations run on Chrome or Node only.`);
  process.exitCode = 1;
} else {
  const matrix = JSON.parse(readFileSync(resolve(root, 'acceptance/matrix.json'), 'utf8'));
  const journeysPath = resolve(root, 'acceptance/journeys.json');
  const journeys = existsSync(journeysPath) ? JSON.parse(readFileSync(journeysPath, 'utf8')) : null;
  const files = citedTestFiles(matrix, journeys);
  const before = snapshot(root, files);
  const output = resolve(root, result);
  const provenance = output.slice(0, -5) + '.provenance.json';
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  rmSync(provenance, { force: true });
  const env = { ...process.env };
  if (name.includes('browser')) env.AXYLO_BROWSER = '1';
  else delete env.AXYLO_BROWSER;
  if (name === 'browser') env.AXYLO_ENGINE = engine;
  const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
  // The browser configuration runs every browser suite one file at a time and takes about a quarter of an hour.
  const limit = String(Number(process.env.AXYLO_RUN_TIMEOUT) || (name === 'browser' ? 2400 : 400));
  const run = spawnSync('timeout', ['--kill-after=5', limit, process.execPath, vitest, 'run', ...configs[name],
    '--reporter=json', '--outputFile=' + output, ...filters], { cwd: root, env, stdio: 'inherit' });
  const after = snapshot(root, files);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  let mismatch = null;
  if (existsSync(output) && (run.status === 0 || run.status === 1)) {
    // The engine the results declare, not the one asked for: the checker compares the two.
    const declared = name === 'browser' ? declaredEngines(JSON.parse(readFileSync(output, 'utf8'))) : null;
    if (declared && (declared.engines.length !== 1 || declared.engines[0] !== engine || declared.versions.length > 1)) {
      mismatch = `asked for ${engine}, the results declare ${declared.versions.join(', ') || declared.engines.join(', ') || 'no engine'}`;
    }
    writeFileSync(provenance, JSON.stringify({
      ...before, resultSha256: hashFile(output), changedDuringRun: changed,
      ...(declared ? { engine, engineVersion: declared.versions.length === 1 ? declared.versions[0].slice(engine.length + 1) : null } : {}),
    }, null, 2) + '\n');
  }
  if (changed) console.error('The working tree changed during Vitest. The release checker will reject this result.');
  if (mismatch) console.error(`Engine mismatch: ${mismatch}. The checker will refuse this result.`);
  if (run.error) console.error(run.error.message);
  process.exitCode = changed || mismatch ? 1 : run.status ?? 1;
}
