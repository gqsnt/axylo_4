/**
 * Runs in Node, after `npm run build`, with the browser suite (it needs the packed packages, not a browser).
 * The Node examples quoted on the Diagnostics page (apps/docs/examples/node, copied into the packed consumer)
 * run against the installed tarball: validate.ts as a script, chart-data.test.ts as a Vitest test in a run of
 * its own rooted in the consumer. And the React page's statement about server rendering, through the
 * installed @axylo/react.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildSite } from '../lib/site.mjs';
import { repoRoot } from '../lib/examples.mjs';
import { consumerDir, installed } from '../lib/consumer.mjs';

beforeAll(async () => { await buildSite(); }, 180_000);

describe('Node examples, against the packed package', () => {
  it('validate.ts runs and finds nothing blocking', () => {
    const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(consumerDir, 'src/node/validate.ts')], { cwd: consumerDir, encoding: 'utf8' });
    expect(out.trim()).toBe('Checked "Orders per day": 0 diagnostics, none blocking.');
  });

  it('chart-data.test.ts passes as a test', () => {
    fs.writeFileSync(path.join(consumerDir, 'vitest.config.mjs'), "export default { test: { include: ['src/node/*.test.ts'] } };\n");
    const vitest = path.join(repoRoot, 'node_modules/vitest/vitest.mjs');
    const out = execFileSync(process.execPath, [vitest, 'run', '--root', consumerDir, '--config', path.join(consumerDir, 'vitest.config.mjs')], { cwd: consumerDir, encoding: 'utf8', env: { ...process.env, AXYLO_BROWSER: '' } });
    expect(out).toMatch(/Tests\s+1 passed \(1\)/);
  });

  it('the example resolves the installed tarball, not the workspace', () => {
    const require = createRequire(path.join(consumerDir, 'src/node/validate.ts'));
    const resolved = fs.realpathSync(require.resolve('axylo'));
    expect(path.dirname(path.dirname(resolved))).toBe(fs.realpathSync(installed('axylo')));
  });
});

describe('React server rendering, through the installed adapter', () => {
  it('renders only the empty container, with its own attributes', async () => {
    const require = createRequire(path.join(consumerDir, 'package.json'));
    const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
    const { renderToString } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
    const { Line } = await import(pathToFileURL(path.join(installed('@axylo/react'), 'dist/index.js')).href);
    const html: string = renderToString(createElement(Line, {
      id: 'sessions', 'data-card': 'kpi', title: 'Sessions',
      data: [{ day: '2026-03-02', sessions: 3120 }], x: 'day', y: 'sessions',
    }));
    const element = /^<div((?: [\w-]+="[^"]*")*)><\/div>$/.exec(html);
    expect(element, html).not.toBeNull();
    const attributes = Object.fromEntries([...element![1]!.matchAll(/ ([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    expect(attributes).toEqual({ id: 'sessions', class: 'axylo', 'data-card': 'kpi' });
  });
});
