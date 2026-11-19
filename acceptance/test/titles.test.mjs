import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { matchesTemplate, readTitles } from '../titles.mjs';

test('division after a non-null assertion keeps the following describe at the top level', () => {
  const file = fileURLToPath(new URL('./fixtures/non-null-division.test.ts', import.meta.url));
  const { tests } = readTitles(readFileSync(file, 'utf8'), file);
  assert.deepEqual(tests.map(({ title, ancestors }) => [title, ancestors]), [
    ['divides a value', ['first suite']],
    ['has its own suite', ['second suite']],
    ['follows a template with division', ['second suite']],
  ]);
});

test('the pointer browser tests have the ancestors recorded by Vitest', t => {
  const report = new URL('../results/browser.json', import.meta.url);
  if (!existsSync(report)) {
    t.skip('acceptance/results/browser.json is missing');
    return;
  }
  const relativeFile = 'packages/axylo/test/browser/acceptance/i1-pointer.browser.test.ts';
  const file = fileURLToPath(new URL('../../' + relativeFile, import.meta.url));
  const { testResults } = JSON.parse(readFileSync(report, 'utf8'));
  const recorded = testResults.find(({ name }) => {
    const path = name.replaceAll('\\', '/');
    return path === relativeFile || path.endsWith('/' + relativeFile);
  });
  assert.ok(recorded?.assertionResults.length, `No tests recorded for ${relativeFile}`);

  const { tests, templates } = readTitles(readFileSync(file, 'utf8'), file);
  for (const { title, ancestorTitles } of recorded.assertionResults) {
    const candidates = [
      ...tests.filter(candidate => candidate.title === title),
      ...templates.filter(candidate => matchesTemplate(title, candidate.template)),
    ];
    const paths = candidates.map(candidate => candidate.ancestors);
    assert.ok(paths.some(ancestors =>
      ancestors.length === ancestorTitles.length && ancestors.every((name, i) => name === ancestorTitles[i])),
    `${title}: Vitest recorded ${JSON.stringify(ancestorTitles)}, scanner found ${JSON.stringify(paths)}`);
  }
});
