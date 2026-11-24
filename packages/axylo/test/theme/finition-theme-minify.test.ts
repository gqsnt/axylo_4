import { expect, it } from 'vitest';
import fc from 'fast-check';
import { minifyCss } from '../../src/theme/minify';

it('keeps compound selectors compound and descendant selectors descendants', () => {
  fc.assert(fc.property(fc.constantFrom('div', '.a'), fc.stringMatching(/^[a-z]{1,12}$/), (prefix, name) => {
    const rule = (selector: string) => selector + '{color:red}';
    expect(minifyCss(rule(prefix + '/**/.' + name))).toBe(rule(prefix + '.' + name));
    expect(minifyCss(rule(prefix + ' /**/.' + name))).toBe(rule(prefix + ' .' + name));
  }));
});

it('preserves token boundaries without turning adjacent type selectors into a valid descendant', () => {
  expect(minifyCss('a/**/b {border:1px/**/solid}')).toBe('a/**/b{border:1px/**/solid}');
});
