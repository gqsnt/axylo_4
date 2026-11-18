/**
 * Runs in Node, after `npm run build`, with the browser suite (it needs the built package, not a browser).
 * The Node examples quoted on the Diagnostics page (apps/docs/examples/node) type-check against the package's
 * declarations and run against its built files: chart-data.test.ts is itself a Vitest test and runs with this
 * suite; validate.ts is a script and is run here. Also checks the React page's statement about server
 * rendering, through the package as an application imports it.
 */
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { docsRoot, repoRoot } from '../lib/examples.mjs';

describe('Node examples', () => {
  it('type-check (examples/node/tsconfig.json)', () => {
    let output = '';
    try {
      // Through node itself, so the same call works on Windows.
      const tsc = path.join(repoRoot, 'node_modules/typescript/bin/tsc');
      execFileSync(process.execPath, [tsc, '-p', path.join(docsRoot, 'examples/node/tsconfig.json')], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ''}${e.stderr ?? ''}` || String(error);
    }
    expect(output).toBe('');
  });

  it('validate.ts runs and finds nothing blocking', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../examples/node/validate');
    expect(log).toHaveBeenCalledWith('Checked "Orders per day": 0 diagnostics, none blocking.');
    log.mockRestore();
  });
});

describe('React server rendering', () => {
  it('renders only the empty container, with its own attributes', async () => {
    const { Line } = await import('@axylo/react');
    const html = renderToString(createElement(Line as never, {
      id: 'sessions', 'data-card': 'kpi', title: 'Sessions',
      data: [{ day: '2026-03-02', sessions: 3120 }], x: 'day', y: 'sessions',
    }));
    const element = /^<div((?: [\w-]+="[^"]*")*)><\/div>$/.exec(html);
    expect(element, html).not.toBeNull();
    const attributes = Object.fromEntries([...element![1]!.matchAll(/ ([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    expect(attributes).toEqual({ id: 'sessions', class: 'axylo', 'data-card': 'kpi' });
  });
});
