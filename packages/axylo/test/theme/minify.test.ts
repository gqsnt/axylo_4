/**
 * The production files and dist/axylo.css carry the stylesheet minified at build time (scripts/build.mjs,
 * src/theme/minify.ts). Minifying may remove comments and layout whitespace only: both forms are parsed into
 * the same tree of rules (at-rule preludes and selectors, each block's declarations as property and value, in
 * order), with whitespace runs read as one space, as CSS reads them.
 */
import { describe, expect, it } from 'vitest';
import { AXYLO_CSS } from '../../src/theme/css';
import { minifyCss } from '../../src/theme/minify';

type Node =
  | { readonly kind: 'rule'; readonly prelude: string; readonly block: readonly Node[] }
  | { readonly kind: 'declaration'; readonly property: string; readonly value: string }
  | { readonly kind: 'statement'; readonly text: string };

/** Whitespace runs as one space, trimmed; comments are whitespace. Strings are kept as written. */
function normalize(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; out += ' '; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      for (; text[j] !== c; j++) if (text[j] === '\\') j++;
      out += text.slice(i, j + 1);
      i = j;
      continue;
    }
    out += /\s/.test(c) ? ' ' : c;
  }
  return out.replace(/ +/g, ' ').trim();
}

/** A small CSS parser: enough for the library's own stylesheet (rules, at-rules with blocks, declarations). */
function parse(css: string): Node[] {
  let i = 0;
  const block = (): Node[] => {
    const nodes: Node[] = [];
    let start = i;
    let depth = 0;
    while (i < css.length) {
      const c = css[i]!;
      if (c === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 2; continue; }
      if (c === '"' || c === "'") {
        for (i++; css[i] !== c; i++) if (css[i] === '\\') i++;
        i++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (depth === 0 && c === '{') {
        const prelude = normalize(css.slice(start, i));
        i++;
        nodes.push({ kind: 'rule', prelude, block: block() });
        start = i;
        continue;
      } else if (depth === 0 && (c === ';' || c === '}')) {
        const text = normalize(css.slice(start, i));
        if (text !== '') {
          const colon = text.indexOf(':');
          // A declaration starts with a property name; anything else (an at-rule statement) is kept whole.
          if (colon > 0 && /^-?-?[a-zA-Z][\w-]*$/.test(text.slice(0, colon).trim())) {
            nodes.push({ kind: 'declaration', property: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() });
          } else nodes.push({ kind: 'statement', text });
        }
        i++;
        start = i;
        if (c === '}') return nodes;
        continue;
      }
      i++;
    }
    const rest = normalize(css.slice(start));
    if (rest !== '') nodes.push({ kind: 'statement', text: rest });
    return nodes;
  };
  return block();
}

function count(nodes: readonly Node[], kind: Node['kind']): number {
  return nodes.reduce((n, node) => n + (node.kind === kind ? 1 : 0) + (node.kind === 'rule' ? count(node.block, kind) : 0), 0);
}

describe('the minified stylesheet', () => {
  const minified = minifyCss(AXYLO_CSS);
  const readable = parse(AXYLO_CSS);

  it('has the same rules, selectors, at-rules and declarations, in the same order', () => {
    // The parse found the stylesheet's structure, not one undivided block.
    expect(count(readable, 'rule')).toBeGreaterThan(50);
    expect(count(readable, 'declaration')).toBeGreaterThan(150);
    expect(parse(minified)).toEqual(readable);
  });

  it('keeps every property name and custom property of the readable form', () => {
    const names = (css: string) => [...css.matchAll(/(--[\w-]+|[a-z-]+)\s*:/g)].map(m => m[1]).sort();
    const withoutComments = AXYLO_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(names(minified)).toEqual(names(withoutComments));
  });

  it('has no comments and no layout whitespace left, and is smaller', () => {
    expect(minified).not.toMatch(/\/\*/);
    expect(minified).not.toMatch(/\n|\s{2,}|\s[{};]|[{};]\s/);
    expect(minified.length).toBeLessThan(AXYLO_CSS.length * 0.8);
  });

  it('minifies a stylesheet that is already minified to itself', () => {
    expect(minifyCss(minified)).toBe(minified);
  });

  it('keeps a space that separates tokens, the space before a colon in a selector included', () => {
    expect(minifyCss('.a :focus-visible ,\n .b  >  .c { color : red ;  /* x */ margin: 0 auto ; }\n')).toBe('.a :focus-visible , .b > .c{color : red;margin: 0 auto}');
    expect(minifyCss('a { content: "  ;{ } " ; }')).toBe('a{content: "  ;{ } "}');
  });
});
