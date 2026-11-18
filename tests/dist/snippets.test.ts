/**
 * Spec DX1, the static half (by npm and by script tag): each documented first chart is ten lines or fewer including the import, counted
 * as a reader counts them (non-blank lines), and passes no option besides data, fields and the title. The
 * title is there because without it the chart raises AX140, a warning (spec 3.5), and a first chart should
 * not print one; first-chart.browser.test.ts shows it is not required. The fixtures and the package README
 * carry the files verbatim, so examples/first-chart stays the single source.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { examples, fixture, repo } from './paths';

const SNIPPETS = [
  { file: 'npm.ts', fixture: 'npm', readme: 'packages/axylo/README.md' },
  { file: 'script.html', fixture: 'script', readme: 'packages/axylo/README.md' },
] as const;
const ALLOWED = ['data', 'title', 'x', 'y'];

const read = (file: string): string => fs.readFileSync(path.join(examples, file), 'utf8');

/** Option names passed to the chart: keys of the object literal given to line(). */
function optionNames(code: string): string[] {
  const call = /\bline\(\s*'[^']*',\s*\{([^}]*)\}\s*\)/.exec(code);
  return call ? [...call[1]!.matchAll(/\b([A-Za-z]+)\s*:/g)].map(m => m[1]!).sort() : [];
}

describe.each(SNIPPETS)('examples/first-chart/$file', snippet => {
  const code = read(snippet.file);

  it('is ten lines or fewer, counting non-blank lines', () => {
    const lines = code.split('\n').filter(l => l.trim() !== '').length;
    console.info(`${snippet.file}: ${lines} non-blank lines`);
    expect(lines).toBeLessThanOrEqual(10);
  });

  it('starts with what loads the library (the import, or the script tag after the document head)', () => {
    if (snippet.file === 'script.html') {
      expect(code).toMatch(/<script src="[^"]*\/axylo\.iife(\.min)?\.js"><\/script>/);
      expect(code).toMatch(/<link rel="stylesheet" href="[^"]*\/axylo\.css">/);
    } else {
      expect(code.split('\n')[0]).toMatch(/^import \{ line \} from 'axylo';$/);
    }
  });

  it('passes no option besides data, fields and the title', () => {
    const names = optionNames(code);
    expect(names).toContain('data');
    expect(names.filter(n => !ALLOWED.includes(n))).toEqual([]);
  });

  it('is copied verbatim into its fixture and its package README', () => {
    expect(fs.readFileSync(fixture(snippet.fixture, 'example', snippet.file), 'utf8')).toBe(code);
    expect(fs.readFileSync(path.join(repo, snippet.readme), 'utf8')).toContain(code);
  });
});
