/**
 * The theming page documents exactly the CSS custom properties the library's stylesheet uses, and how each
 * public one falls back. Against packages/axylo/src/theme:
 *
 * - names: a property in the stylesheet (css.ts) that is not in apps/docs/data/tokens.mjs fails, and so does a
 *   documented one that is not in the stylesheet; the private defaults (`--axylo-default-*`) are the values
 *   behind the public names, not properties of their own;
 * - bindings: every `var(--axylo-x, …)` the stylesheet and the paint bindings (resolve.ts) write for a
 *   documented public property falls back to exactly the documented fallback, which for a colour names the
 *   documented private default;
 * - schemes: each documented default exists, as a hex colour, in the light and the dark set.
 * theme.browser.test.ts checks the colours actually painted in both schemes.
 */
import { describe, expect, it } from 'vitest';
import { AXYLO_CSS } from '../../../packages/axylo/src/theme/css';
import { TOKEN_BINDINGS, seriesBinding } from '../../../packages/axylo/src/theme/resolve';
import { minifyCss } from '../../../packages/axylo/src/theme/minify';
import { readThemeDefaults } from '../lib/theme.mjs';
import { internalTokens, tokens } from '../data/tokens.mjs';

const inStylesheet = [...new Set([...AXYLO_CSS.matchAll(/--axylo-[a-z0-9-]+/g)].map(m => m[0]))]
  .filter(name => !name.startsWith('--axylo-default-'))
  .sort();
const documented = [...tokens, ...internalTokens].map(t => t.name).sort();

/** Every `var(--name, fallback)` in `text`, with its fallback read to the matching parenthesis. */
function uses(text: string): { name: string; fallback: string }[] {
  const out: { name: string; fallback: string }[] = [];
  for (const m of text.matchAll(/var\((--axylo-[a-z0-9-]+),\s*/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    out.push({ name: m[1]!, fallback: text.slice(start, i - 1).trim() });
  }
  return out;
}

const bindings = [
  ...uses(AXYLO_CSS),
  ...Object.values(TOKEN_BINDINGS).flatMap(uses),
  ...Array.from({ length: 8 }, (_, i) => uses(seriesBinding(i))).flat(),
];

describe('theme custom properties', () => {
  it('every custom property in the stylesheet is documented', () => {
    expect(inStylesheet.filter(name => !documented.includes(name))).toEqual([]);
  });
  it('every documented custom property is in the stylesheet', () => {
    expect(documented.filter(name => !inStylesheet.includes(name))).toEqual([]);
  });
  it('no property is documented twice', () => {
    expect(documented.filter((name, i) => documented.indexOf(name) !== i)).toEqual([]);
  });
  it.each(tokens.map(t => [t.name, t] as const))('%s falls back to its documented fallback wherever the library reads it', (name, t) => {
    const found = bindings.filter(b => b.name === name);
    expect(found.length, `${name} is read with a fallback`).toBeGreaterThan(0);
    expect([...new Set(found.map(b => b.fallback))]).toEqual([t.fallback]);
    if (t.default) expect(t.fallback).toContain(`var(${t.default})`);
  });
  it('every documented default exists as a hex colour in the light and the dark set', () => {
    const { light, dark } = readThemeDefaults(AXYLO_CSS);
    for (const t of tokens.filter(t => t.default)) {
      expect(light[t.default!], `${t.default} (light)`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(dark[t.default!], `${t.default} (dark)`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('the defaults read the same from the stylesheet as written and as the build minifies it', () => {
    // dist/axylo.css is the minified text (scripts/build.mjs), and the site reads its table from it.
    expect(readThemeDefaults(minifyCss(AXYLO_CSS))).toEqual(readThemeDefaults(AXYLO_CSS));
  });
  it('every private default in the stylesheet belongs to a documented property', () => {
    const { light, dark } = readThemeDefaults(AXYLO_CSS);
    const used = new Set(tokens.map(t => t.default).filter(Boolean));
    expect([...new Set([...Object.keys(light), ...Object.keys(dark)])].filter(name => !used.has(name))).toEqual([]);
  });
  it('a property without a colour default says what happens when it is unset', () => {
    for (const t of tokens.filter(t => !t.default)) expect(t.unset, t.name).toBeTruthy();
  });
});
