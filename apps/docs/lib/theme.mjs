/**
 * The default colours of Axylo's stylesheet, per scheme, from whichever form the sheet uses (as written in
 * src/theme/css.ts, or minified as the build ships it in dist/axylo.css): fixed blocks
 * selected by `.axylo[data-axylo-scheme="light"|"dark"]`, and/or one `.axylo` block whose values are
 * `light-dark(light, dark)` pairs. When both forms are present they must agree. Every value must be a hex
 * colour, and both schemes must define the same names; anything else throws, so a changed stylesheet stops
 * the build instead of publishing a wrong table.
 */
const HEX = /^#[0-9a-f]{3,8}$/i;
const PAIR = /^light-dark\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/i;

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function block(css, selector) {
  // The selector followed by its declaration block, with or without a space before the brace (the minified
  // form has none); the first occurrence is the token block. The last declaration of a minified block has
  // no semicolon, so declarations are split on semicolons rather than matched up to one.
  const open = new RegExp(`${escape(selector)}\\s*\\{`).exec(css);
  if (!open) return null;
  const start = open.index + open[0].length;
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(body.split(';')
    .map(part => /^\s*(--axylo-default-[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part))
    .filter(Boolean)
    .map(m => [m[1], m[2]]));
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
