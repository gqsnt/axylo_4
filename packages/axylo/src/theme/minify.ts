/**
 * Build-time only (scripts/build.mjs): the stylesheet without its comments and layout whitespace, for the
 * production files. It removes only what carries no meaning: comments, runs of whitespace (kept as one space
 * where a space separates tokens), and the whitespace around `{`, `}` and `;` and a `;` before `}`. Every
 * selector, property, value and token is kept as written, commas and colons with their spaces included
 * (a space before `:` in a selector is a descendant combinator, and custom property values keep their text).
 * The library never imports this module, so no bundle carries it.
 */
export function minifyCss(css: string): string {
  let out = '';
  let space = false;
  let comment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) throw new Error('minifyCss: unterminated comment');
      i = end + 1;
      comment = true;
      continue;
    }
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f') {
      space = true;
      continue;
    }
    // A comment is a token boundary, never a descendant combinator. Before a class selector
    // it can vanish. At an ambiguous boundary keep an empty comment so tokens cannot fuse.
    const classDot = c === '.' && !/[0-9]/.test(css[i + 1] ?? '');
    if (comment && !space && out && !/[{};]$/.test(out) && !/[{};]/.test(c) && !classDot) {
      out += '/**/';
    }
    comment = false;
    if (c === '"' || c === "'") {
      let j = i + 1;
      for (; j < css.length && css[j] !== c; j++) if (css[j] === '\\') j++;
      if (j >= css.length) throw new Error('minifyCss: unterminated string');
      if (space && out !== '' && !/[{};]$/.test(out)) out += ' ';
      space = false;
      out += css.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '{' || c === '}' || c === ';') {
      // The last declaration of a block needs no `;`.
      if (c === '}' && out.endsWith(';')) out = out.slice(0, -1);
      out += c;
      space = false;
      continue;
    }
    if (space && out !== '' && !/[{};]$/.test(out)) out += ' ';
    space = false;
    out += c;
  }
  return out;
}
