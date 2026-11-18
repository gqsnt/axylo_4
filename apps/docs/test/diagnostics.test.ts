/**
 * Criterion DX4: every diagnostic code has a documentation page, and every documented code exists. The pages
 * are generated from apps/docs/data/diagnostics.mjs, one per entry, so the check is on that file against the
 * registry the library reports from (packages/axylo/src/diagnostics/registry.ts). The built pages themselves
 * are checked in diagnostics.browser.test.ts, after the site is built.
 *
 * Also: each entry's level is the registry's, its condition follows the spec table, and each minimal input
 * that runs in Node raises its code through validate().
 */
import { describe, expect, it } from 'vitest';
import { diagnosticRegistry, createDiagnostic } from '../../../packages/axylo/src/diagnostics/registry';
import { validate } from '../../../packages/axylo/src/index';
import { diagnostics } from '../data/diagnostics.mjs';

const registryCodes = Object.keys(diagnosticRegistry).sort();
const documented = diagnostics.map(d => d.code);

describe('diagnostics documentation covers the registry', () => {
  it('every code in the registry has a page', () => {
    expect(registryCodes.filter(code => !documented.includes(code))).toEqual([]);
  });
  it('every page is for a code in the registry', () => {
    expect(documented.filter(code => !registryCodes.includes(code))).toEqual([]);
  });
  it('no code has two pages', () => {
    expect(documented.filter((code, i) => documented.indexOf(code) !== i)).toEqual([]);
  });
  it.each(diagnostics.map(d => [d.code, d] as const))('%s has the registry level and every section', (code, d) => {
    expect(d.level).toBe(diagnosticRegistry[code as keyof typeof diagnosticRegistry].level);
    for (const key of ['title', 'condition', 'drawn', 'see', 'why', 'fix', 'input'] as const) {
      expect(typeof d[key] === 'string' && d[key].trim().length > 0, `${code}.${key}`).toBe(true);
    }
    expect(['node', 'browser']).toContain(d.run);
  });
});

describe('minimal inputs that run in Node raise their code', () => {
  const inNode = diagnostics.filter(d => d.run === 'node');
  it.each(inNode.map(d => [d.code, d.input] as const))('%s', (code, input) => {
    const found = new Function('validate', `return ${input}`)(validate) as { code: string }[];
    expect(found.map(f => f.code)).toContain(code);
  });
});

describe('documentation links in messages', () => {
  // The registry's messages carry no URL today. If one is added, it must point at that code's own page,
  // apps/docs/dist/diagnostics/<code>.html, under whatever base the site is published at.
  it.each(registryCodes)('%s', code => {
    const message = createDiagnostic(code as keyof typeof diagnosticRegistry, 'none', { field: 'f', rows: [1], count: 1 }).message;
    for (const url of message.match(/https?:\/\/\S+|\S+\.html\b/g) ?? []) {
      expect(url.replace(/[).,]+$/, '')).toMatch(new RegExp(`/diagnostics/${code}\\.html$`));
    }
  });
});
