/**
 * The default colours of Axylo's stylesheet, per scheme, from whichever form the sheet uses: fixed blocks
 * selected by `.axylo[data-axylo-scheme="light"|"dark"]`, and/or one `.axylo` block whose values are
 * `light-dark(light, dark)` pairs. When both forms are present they must agree. Every value must be a hex
 * colour, and both schemes must define the same names; anything else throws, so a changed stylesheet stops
 * the build instead of publishing a wrong table.
 */
const HEX = /^#[0-9a-f]{3,8}$/i;
const PAIR = /^light-dark\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/i;

function block(css, selector) {
  // The selector followed directly by its declaration block; the first occurrence is the token block.
  const at = css.indexOf(selector + ' {');
  if (at === -1) return null;
  const start = at + selector.length + 2;
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--axylo-default-[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}

export function readThemeDefaults(css) {
  const fixed = { light: block(css, '.axylo[data-axylo-scheme="light"]'), dark: block(css, '.axylo[data-axylo-scheme="dark"]') };
  const following = block(css, '.axylo');
  const fromPairs = { light: {}, dark: {} };
  let pairs = 0;
  for (const [name, value] of Object.entries(following ?? {})) {
    const m = PAIR.exec(value);
    if (m) {
      fromPairs.light[name] = m[1];
      fromPairs.dark[name] = m[2];
      pairs++;
    } else if (HEX.test(value) && !fixed.light) {
      // An older sheet: the `.axylo` block holds the light set, and the dark set has its own block.
      fromPairs.light[name] = value;
    }
  }
  const result = {
    light: fixed.light ?? fromPairs.light,
    dark: fixed.dark ?? fromPairs.dark,
  };
  const problems = [];
  for (const scheme of ['light', 'dark']) {
    const names = Object.keys(result[scheme]);
    if (names.length === 0) problems.push(`no ${scheme} defaults found`);
    for (const [name, value] of Object.entries(result[scheme])) {
      if (!HEX.test(value)) problems.push(`${name} (${scheme}) is ${JSON.stringify(value)}, not a hex colour`);
      if (pairs && fromPairs[scheme][name] !== undefined && fromPairs[scheme][name].toLowerCase() !== value.toLowerCase()) {
        problems.push(`${name} (${scheme}): the light-dark() pair says ${fromPairs[scheme][name]}, the fixed block ${value}`);
      }
    }
  }
  const light = Object.keys(result.light).sort().join();
  const dark = Object.keys(result.dark).sort().join();
  if (light !== dark) problems.push(`the light and dark schemes define different names (${light} / ${dark})`);
  if (problems.length) throw new Error('axylo.css defaults cannot be read:\n  ' + problems.join('\n  '));
  return result;
}
