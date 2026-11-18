/**
 * Development and production flavours (plan 1.6): the `development` export condition and the default
 * resolve to different files, in Node and in esbuild, and neither refers to the build-time __DEV__ constant.
 *
 * The behaviour that must differ between the flavours is pinned in flavours.browser.test.ts, from a list
 * written by hand from the spec and the plan. The last test here is supplementary only: it derives
 * development-only text from the current source (every `if (__DEV__) …` statement in packages/<pkg>/src,
 * found by a small scanner, cut out of a second bundle of the source; text only the first bundle has is
 * development-only) and checks it is in the packed development file and absent from the production one. It
 * follows the guard syntax, so a guard removed from the source also leaves this check; it is not evidence on
 * its own that development-only behaviour is absent from production.
 */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, fixtureGuard, installed, nodeJson, packedJson, repo } from './paths';

type Name = 'axylo' | '@axylo/react';
const SOURCE: Record<Name, string> = { axylo: 'packages/axylo/src', '@axylo/react': 'packages/react/src' };
const FIXTURE: Record<Name, 'npm' | 'react'> = { axylo: 'npm', '@axylo/react': 'react' };

const targetOf = (name: Name, condition: string): string => {
  const entry = packedJson(name).exports?.['.'];
  if (!entry || typeof entry === 'string' || !entry[condition]) throw new Error(`${name} has no "${condition}" export`);
  return installed(name, entry[condition]!.replace(/^\.\//, ''));
};

/** Index just past the end of the string, template, comment or regex-free region starting at `i`. */
function skipLiteral(src: string, i: number): number {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') return src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i);
  if (c === '/' && src[i + 1] === '*') return src.indexOf('*/', i + 2) + 2;
  if (c === "'" || c === '"' || c === '`') {
    let j = i + 1;
    while (j < src.length && src[j] !== c) {
      if (src[j] === '\\') j++;
      else if (c === '`' && src[j] === '$' && src[j + 1] === '{') j = matchBrace(src, j + 1);
      j++;
    }
    return j + 1;
  }
  return i;
}

/** Index of the brace that closes the one at `open`. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const next = skipLiteral(src, i);
    if (next !== i) { i = next - 1; continue; }
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces');
}

/** The [start, end) ranges of `if (__DEV__) …` statements. */
function devRegions(src: string): [number, number][] {
  const regions: [number, number][] = [];
  for (const m of src.matchAll(/\bif\s*\(\s*__DEV__\s*\)\s*/g)) {
    const start = m.index!;
    let at = start + m[0].length;
    if (src[at] === '{') { regions.push([start, matchBrace(src, at) + 1]); continue; }
    let depth = 0;
    for (; at < src.length; at++) {
      const next = skipLiteral(src, at);
      if (next !== at) { at = next - 1; continue; }
      if ('([{'.includes(src[at]!)) depth++;
      else if (')]}'.includes(src[at]!)) depth--;
      else if (src[at] === ';' && depth === 0) break;
    }
    regions.push([start, at + 1]);
  }
  return regions;
}

/**
 * Text a minifier keeps, from esbuild's unminified output: the static parts of string and template literals
 * (each part up to its first escape) and property names (after a dot, or before a colon). A small lexer, so
 * that quotes inside comments, templates and regular expressions do not split the code wrongly.
 */
function tokens(code: string): Set<string> {
  const out = new Set<string>();
  const keep = (text: string) => { const head = text.split('\\')[0]!; if (head.trim().length >= 5) out.add(head); };
  let i = 0;
  let previous = '';
  const template = (): void => {
    // At the opening backtick; leaves i just past the closing one.
    let chunk = '';
    for (i++; i < code.length && code[i] !== '`'; i++) {
      if (code[i] === '\\') { chunk += code[i]! + code[i + 1]!; i++; continue; }
      if (code[i] === '$' && code[i + 1] === '{') {
        keep(chunk); chunk = '';
        let depth = 0;
        for (i++; i < code.length; i++) {
          if (code[i] === '`') { template(); i--; continue; }
          if (code[i] === "'" || code[i] === '"') { const q = code[i]; for (i++; code[i] !== q; i++) if (code[i] === '\\') i++; continue; }
          if (code[i] === '{') depth++;
          else if (code[i] === '}' && --depth === 0) break;
        }
        continue;
      }
      chunk += code[i];
    }
    keep(chunk);
    i++;
  };
  while (i < code.length) {
    const c = code[i]!;
    if (c === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && (previous === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(previous) || /\b(return|typeof|case|in|of)$/.test(code.slice(Math.max(0, i - 8), i).trimEnd()))) {
      let inClass = false;
      for (i++; i < code.length; i++) {
        if (code[i] === '\\') { i++; continue; }
        if (code[i] === '[') inClass = true;
        else if (code[i] === ']') inClass = false;
        else if (code[i] === '/' && !inClass) break;
      }
      i++; previous = 'x'; continue;
    }
    if (c === "'" || c === '"') {
      let text = '';
      for (i++; i < code.length && code[i] !== c; i++) { if (code[i] === '\\') { text += code[i]! + code[i + 1]!; i++; } else text += code[i]; }
      keep(text); i++; previous = 'x'; continue;
    }
    if (c === '`') { template(); previous = 'x'; continue; }
    if (!/\s/.test(c)) previous = c;
    i++;
  }
  for (const m of code.matchAll(/\.\s*([A-Za-z_$][\w$]{4,})\b/g)) out.add(m[1]!);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]{4,})\s*:/g)) out.add(m[1]!);
  return out;
}

/**
 * Text that only the development regions contribute: the package's source bundled with __DEV__ true, as is,
 * against the same source with each `if (__DEV__) …` statement cut out. esbuild only erases types and drops
 * what is no longer used (a function only those statements called); the regions come from the source.
 */
async function devOnlyTokens(name: Name): Promise<string[]> {
  const dir = path.join(repo, SOURCE[name]);
  const bundle = async (cut: boolean) => {
    const r = await build({
      entryPoints: [path.join(dir, 'index.ts')], bundle: true, write: false, format: 'esm', target: 'es2022', logLevel: 'silent',
      define: { __DEV__: 'true' }, external: ['react', 'react/*', 'axylo'], legalComments: 'none', absWorkingDir: repo,
      plugins: cut ? [{
        name: 'cut-development-regions',
        setup(b) {
          b.onLoad({ filter: /\.tsx?$/ }, args => {
            if (!args.path.startsWith(dir)) return undefined;
            let src = fs.readFileSync(args.path, 'utf8');
            for (const [a, z] of devRegions(src).reverse()) src = `${src.slice(0, a)}${src.slice(z)}`;
            return { contents: src, loader: args.path.endsWith('x') ? 'tsx' : 'ts' };
          });
        },
      }] : [],
    });
    return r.outputFiles[0]!.text;
  };
  const full = tokens(await bundle(false));
  const cut = tokens(await bundle(true));
  return [...full].filter(t => !cut.has(t));
}

describe.each(['axylo', '@axylo/react'] as const)('%s', name => {
  const dev = targetOf(name, 'development');
  const prod = targetOf(name, 'default');

  it('the development condition and the default name different files with different content', () => {
    expect(dev).not.toBe(prod);
    expect(fs.readFileSync(dev, 'utf8')).not.toBe(fs.readFileSync(prod, 'utf8'));
  });

  it('Node resolves the default without conditions and the development file with --conditions=development', () => {
    const code = `console.log(JSON.stringify(import.meta.resolve(${JSON.stringify(name)})))`;
    const resolve = (args: string[]) => fs.realpathSync(new URL(nodeJson<string>(fixture(FIXTURE[name]), [...args, '--input-type=module', '-e', code])));
    expect(resolve([])).toBe(prod);
    expect(resolve(['--conditions=development'])).toBe(dev);
  });

  it('esbuild resolves the development file under the development condition and the default under production', async () => {
    const entry = async (conditions: string[]) => {
      const r = await build({
        stdin: { contents: `export * from ${JSON.stringify(name)};`, resolveDir: fixture(FIXTURE[name]) }, bundle: true, write: false,
        metafile: true, format: 'esm', conditions, absWorkingDir: fixture(FIXTURE[name]), plugins: [fixtureGuard([fixture(FIXTURE[name])])], external: ['react', 'react/*', ...(name === 'axylo' ? [] : ['axylo'])], logLevel: 'silent',
      });
      return Object.keys(r.metafile.inputs).map(p => path.resolve(fixture(FIXTURE[name]), p)).filter(p => p === dev || p === prod);
    };
    expect(await entry(['development'])).toEqual([dev]);
    expect(await entry(['production'])).toEqual([prod]);
  });

  it('neither file refers to the build-time __DEV__ constant', () => {
    for (const file of [dev, prod]) expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/\b__DEV__\b/);
  });

  it('the production file carries none of the development-only text found in the source', async () => {
    const found = await devOnlyTokens(name);
    console.info(`${name} development-only text: ${JSON.stringify(found)}`);
    expect(found.length).toBeGreaterThan(0);
    const devCode = fs.readFileSync(dev, 'utf8');
    const prodCode = fs.readFileSync(prod, 'utf8');
    expect(found.filter(t => !devCode.includes(t)), 'missing from the development file').toEqual([]);
    expect(found.filter(t => prodCode.includes(t)), 'present in the production file').toEqual([]);
  });
});
