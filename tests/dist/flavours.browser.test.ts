/**
 * Development-only behaviour, pinned by what each flavour does in a browser rather than by how the source
 * guards it (review finding 24). The list is written by hand from the spec, the plan and the documentation:
 *
 * | Behaviour                                                        | Source                                   | development | production |
 * |------------------------------------------------------------------|------------------------------------------|-------------|------------|
 * | A hint is printed (console.info "[axylo AX104] …")              | spec 3.5; plan 1.6; docs "Diagnostics"   | once        | never      |
 * | The same hint still reaches onDiagnostic and chart.diagnostics   | spec 3.5 (only printing depends on build) | yes         | yes        |
 * | A warning is printed (console.warn "[axylo AX140] …")           | spec 3.5 ("in every build")              | once        | once       |
 *
 * Each row runs on all four packed core files: the ESM development and default files (through the
 * export conditions, bundled from the npm fixture) and both script-tag files. conditions.test.ts holds a
 * check that no shipped file refers to the build-time constants.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { bundle, closeBrowser, drawn, launch, open, startServer, type Server } from './browser';
import { fixture, here } from './paths';

let server: Server;
const pages = path.join(here, 'pages');
let classic = '';
beforeAll(async () => {
  server = await startServer();
  await launch();
  classic = (await bundle({ name: 'flavour-classic', cwd: pages, contents: `import { run } from './flavour';\nrun((window as unknown as { Axylo: Parameters<typeof run>[0] }).Axylo);` })).url;
});
afterAll(async () => { await closeBrowser(); await server?.close(); });

const page = (body: string) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>flavour</title><link rel="stylesheet" href="/pages/page.css"></head><body>${body}</body></html>`;

const CORE = {
  'ESM, development condition (axylo.dev.js)': { development: true, script: async () => `<script type="module" src="${(await bundle({ name: 'flavour-esm-dev', cwd: fixture('npm'), format: 'esm', conditions: ['development'], allow: [pages], contents: `import * as A from 'axylo';\nimport { run } from ${JSON.stringify(path.join(pages, 'flavour'))};\nrun(A);` })).url}"></script>` },
  'ESM, production condition (axylo.js)': { development: false, script: async () => `<script type="module" src="${(await bundle({ name: 'flavour-esm-prod', cwd: fixture('npm'), format: 'esm', conditions: ['production'], allow: [pages], contents: `import * as A from 'axylo';\nimport { run } from ${JSON.stringify(path.join(pages, 'flavour'))};\nrun(A);` })).url}"></script>` },
  'script tag, development (axylo.iife.js)': { development: true, script: async () => `<script src="/script/node_modules/axylo/dist/axylo.iife.js"></script><script src="${classic}"></script>` },
  'script tag, production (axylo.iife.min.js)': { development: false, script: async () => `<script src="/script/node_modules/axylo/dist/axylo.iife.min.js"></script><script src="${classic}"></script>` },
};

describe.each(Object.entries(CORE))('%s', (label, flavour) => {
  it(`hints print ${flavour.development ? 'once' : 'never'}, are delivered either way, and warnings print once`, async () => {
    const at = `/flavour/${label.replace(/\W+/g, '-')}.html`;
    server.pages.set(at, { html: page(`<div class="chart" id="hinted"></div><div class="chart" id="untitled"></div>${await flavour.script()}`) });
    const w = await open(server);
    await w.page.goto(`${server.origin}${at}`);
    expect((await drawn(w.page, '#hinted')).marks).toBeGreaterThan(0);
    expect((await drawn(w.page, '#untitled')).marks).toBeGreaterThan(0);
    const printed = w.console.filter(m => m.text.startsWith('[axylo'));
    expect(printed.filter(m => m.type === 'info' && m.text.startsWith('[axylo AX104]'))).toHaveLength(flavour.development ? 1 : 0);
    expect(printed.filter(m => m.type === 'warning' && m.text.startsWith('[axylo AX140]'))).toHaveLength(1);
    expect(printed.filter(m => !/^\[axylo AX(104|140)\]/.test(m.text)), 'nothing else printed').toEqual([]);
    const seen = await w.page.evaluate(() => ({ delivered: (window as unknown as { __delivered: string[] }).__delivered, diagnostics: (window as unknown as { __diagnostics: string[] }).__diagnostics }));
    expect(seen.delivered).toContain('AX104');
    expect(seen.delivered).toContain('AX140');
    expect(seen.diagnostics).toContain('AX104');
    expect(w.errors).toEqual([]);
    await w.context.close();
  });
});
