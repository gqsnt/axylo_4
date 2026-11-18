/**
 * Opens the React test app through the shared harness. The app is bundled here first, with what the
 * harness's own esbuild call does not set: React's NODE_ENV and `axylo` redirected to the recording wrapper
 * (which bundles the core from source). The harness then loads the result as a plain script.
 */
import { build, type BuildOptions, type Plugin } from 'esbuild';
import path from 'node:path';
import type { BrowserContextOptions, Page } from 'playwright-core';
import { openEntry } from '../../../axylo/test/browser/harness';

const here = import.meta.dirname;
const root = path.resolve(here, '../../../..');

const spyCore: Plugin = {
  name: 'axylo-spy',
  setup(b) { b.onResolve({ filter: /^axylo$/ }, () => ({ path: path.join(here, 'spy-axylo.ts') })); },
};

export async function openApp(options: BrowserContextOptions & { query?: string; html?: string } = {}, esbuild: BuildOptions = {}): Promise<Page> {
  const out = path.join(here, '.out', 'axylo-react-app.js');
  await build({
    entryPoints: [path.join(here, 'app.tsx')], bundle: true, format: 'iife', target: 'es2022', outfile: out, logLevel: 'silent',
    jsx: 'automatic', define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"' }, plugins: [spyCore], ...esbuild,
  });
  const page = await openEntry(path.relative(root, out), options);
  return page;
}

export async function closeApp(page: Page): Promise<string[]> {
  const errors = (page as Page & { errors: string[] }).errors;
  await page.context().close();
  return errors;
}
