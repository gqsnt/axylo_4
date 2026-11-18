/**
 * The theming page documents exactly the CSS custom properties the library's stylesheet uses: a property in
 * packages/axylo/src/theme/css.ts that is not in apps/docs/data/tokens.mjs fails, and so does a documented one
 * that is not in the stylesheet. The private defaults (`--axylo-default-*`) are the values behind the public
 * names, not properties of their own; each documented default must exist in both schemes.
 */
import { describe, expect, it } from 'vitest';
import { AXYLO_CSS } from '../../../packages/axylo/src/theme/css';
import { readThemeDefaults } from '../lib/site.mjs';
import { internalTokens, tokens } from '../data/tokens.mjs';

const inStylesheet = [...new Set([...AXYLO_CSS.matchAll(/--axylo-[a-z0-9-]+/g)].map(m => m[0]))]
  .filter(name => !name.startsWith('--axylo-default-'))
  .sort();
const documented = [...tokens, ...internalTokens].map(t => t.name).sort();

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
  it('every documented default exists in the light and the dark scheme', () => {
    const { light, dark } = readThemeDefaults(AXYLO_CSS);
    for (const t of tokens.filter(t => 'default' in t && t.default)) {
      expect(light[t.default!], `${t.default} (light)`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(dark[t.default!], `${t.default} (dark)`).toMatch(/^#[0-9a-f]{6}$/i);
    }
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
