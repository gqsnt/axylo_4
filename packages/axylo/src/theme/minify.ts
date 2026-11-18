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
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) throw new Error('minifyCss: unterminated comment');
      i = end + 1;
      space = true;
      continue;
    }
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f') {
      space = true;
      continue;
    }
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
