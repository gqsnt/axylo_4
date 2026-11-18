/**
 * Criterion DX4: every diagnostic code has a documentation page, and every documented code exists. The pages
 * are generated from apps/docs/data/diagnostics.mjs, one per entry, so the check is on that file against the
 * registry the library reports from (packages/axylo/src/diagnostics/registry.ts) and against the registry
 * table of the specification (docs/02-product-spec.md, section 3.5). The built pages, and the reader-visible
 * outcome and strict behaviour of every minimal input, are checked in diagnostics.browser.test.ts.
 *
 * Here: each entry's level is the registry's; its condition starts with the specification's condition for
 * that code, word for word; every further case is complete (a browser case with the sample details its page
 * prints from); and each input that runs in Node, minimal or not, raises its code through validate(), with
 * the field and rows its documented outcome gives.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { diagnosticRegistry, createDiagnostic } from '../../../packages/axylo/src/diagnostics/registry';
import { validate } from '../../../packages/axylo/src/index';
import { repoRoot } from '../lib/examples.mjs';
import { diagnostics } from '../data/diagnostics.mjs';

const registryCodes = Object.keys(diagnosticRegistry).sort();
const documented = diagnostics.map(d => d.code);

/** Condition per code from the specification's registry table (section 3.5). */
function specConditions(): Map<string, string> {
  const spec = fs.readFileSync(path.join(repoRoot, 'docs/02-product-spec.md'), 'utf8');
  const section = spec.slice(spec.indexOf('### 3.5 Diagnostic registry'), spec.indexOf('### 3.6'));
  const out = new Map<string, string>();
  for (const m of section.matchAll(/^\| (AX\d{3}) \| \w+ \| (.+?) \| .+ \|$/gm)) out.set(m[1]!, m[2]!);
  return out;
}
const normal = (text: string) => text.replace(/\.$/, '').trim();

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
    expect(typeof d.outcome?.because === 'string' && d.outcome.because.length > 0, `${code}.outcome.because`).toBe(true);
  });
  it.each(diagnostics.filter(d => 'cases' in d).map(d => [d.code, d] as const))('%s: every further case is complete', (code, d) => {
    for (const c of (d as { cases: readonly Case[] }).cases) {
      expect(typeof c.label === 'string' && c.label.length > 0, `${code}: a case without a label`).toBe(true);
      expect(['node', 'browser'], `${code}, ${c.label}: run`).toContain(c.run);
      expect(typeof c.input === 'string' && c.input.length > 0, `${code}, ${c.label}: input`).toBe(true);
      expect(typeof c.outcome?.because === 'string' && c.outcome.because.length > 0, `${code}, ${c.label}: outcome.because`).toBe(true);
      if (c.run === 'browser') expect(c.sample, `${code}, ${c.label}: a browser case needs sample details`).toBeDefined();
    }
  });
  it.each(diagnostics.map(d => [d.code, d] as const))('%s: the condition starts with the specification\'s', (code, d) => {
    const spec = specConditions().get(code);
    expect(spec, `${code} is in the specification's table`).toBeDefined();
    expect(normal(d.condition).startsWith(normal(spec!)), `"${d.condition}" starts with "${spec}"`).toBe(true);
  });
});

interface Case { label: string; run: string; input: string; sample?: object; outcome: { field: string | null; rows?: readonly number[]; because: string } }

describe('inputs that run in Node raise their code, with the documented field and rows', () => {
  const inNode = diagnostics.flatMap(d => [[d.code, d] as const, ...((d as { cases?: readonly Case[] }).cases ?? [])
    .map(c => [`${d.code}, ${c.label}`, { ...c, code: d.code }] as const)])
    .filter(([, d]) => d.run === 'node');
  it.each(inNode)('%s', (_, d) => {
    const code = d.code;
    const found = new Function('validate', `return ${d.input}`)(validate) as { code: string; field?: string; rows?: readonly number[] }[];
    const mine = found.filter(f => f.code === code);
    expect(mine.length, `${code} raised`).toBeGreaterThan(0);
    expect(mine.map(f => f.field ?? null)).toContain(d.outcome.field);
    if (d.outcome.rows) expect(mine.map(f => f.rows ?? null)).toContainEqual(d.outcome.rows);
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
