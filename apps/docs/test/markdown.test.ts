// The documentation's Markdown converter, on the subset the pages use. Expected HTML is written by hand.
import { describe, expect, it } from 'vitest';
import { checkHref, escapeHtml, markdownToHtml, renderInline, slug, splitRow, wordCount } from '../lib/markdown.mjs';

describe('inline', () => {
  it('escapes every special character in text', () => {
    expect(renderInline(`a < b & "c" > 'd'`)).toBe('a &lt; b &amp; &quot;c&quot; &gt; &#39;d&#39;');
  });
  it('never passes HTML through', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderInline('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
  it('renders code spans with their content escaped', () => {
    expect(renderInline('use `<div>` here')).toBe('use <code>&lt;div&gt;</code> here');
  });
  it('renders a code span that contains a backtick with a double fence', () => {
    expect(renderInline('`` `AX${number}` ``')).toBe('<code>`AX${number}`</code>');
  });
  it('renders strong and emphasis, and leaves a lone asterisk alone', () => {
    expect(renderInline('**bold** and *em*')).toBe('<strong>bold</strong> and <em>em</em>');
    expect(renderInline('2 * 3 = 6')).toBe('2 * 3 = 6');
  });
  it('renders links, rewrites their targets and escapes them', () => {
    const link = (url: string) => url.replace(/\.md/, '.html');
    expect(renderInline('see [the data page](data.md#gaps)', link)).toBe('see <a href="data.html#gaps">the data page</a>');
    expect(renderInline('[x](a.md?b=1&c=2)')).toBe('<a href="a.md?b=1&amp;c=2">x</a>');
    expect(() => renderInline('[x](a"b)')).toThrow();
  });
  it('allows code inside link text', () => {
    expect(renderInline('[`zoom`](updating.md)')).toBe('<a href="updating.md"><code>zoom</code></a>');
  });
  it('allows only relative paths, fragments, https: and mailto: as link destinations', () => {
    for (const ok of ['data.md#gaps', '#top', '../x/y.ts', 'https://example.org/a', 'mailto:someone@example.org']) expect(checkHref(ok)).toBe(ok);
    for (const bad of ['javascript:alert(1)', 'custom:chapter', 'data:text/html,x', '//evil.example/x', 'http://example.org', 'JavaScript:x', 'a b']) {
      expect(() => checkHref(bad), bad).toThrow();
    }
    expect(() => renderInline('[Custom](custom:chapter)')).toThrow(/not allowed/);
  });
  it('reads a link destination with balanced parentheses', () => {
    expect(renderInline('[Guide](guide(v2).md) then')).toBe('<a href="guide(v2).md">Guide</a> then');
  });
  it('honours backslash escapes', () => {
    expect(renderInline('\\*not em\\* and a \\| pipe')).toBe('*not em* and a | pipe');
  });
});

describe('blocks', () => {
  it('turns headings into elements with GitHub-style ids, unique per page', () => {
    const headings: { level: number; text: string; id: string }[] = [];
    const html = markdownToHtml('# Title\n\n## What is not in 1.0\n\n## Notes\n\n## Notes', { headings });
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<h2 id="what-is-not-in-10">What is not in 1.0</h2>');
    expect(headings.map(h => h.id)).toEqual(['title', 'what-is-not-in-10', 'notes', 'notes-2']);
  });
  it('keeps heading ids unique across the page, block quotes and literal suffixes included', () => {
    const headings: { id: string }[] = [];
    markdownToHtml('## Notes\n\n## Notes\n\n## Notes-2\n\n> ## Notes', { headings: headings as never });
    expect(headings.map(h => h.id)).toEqual(['notes', 'notes-2', 'notes-2-2', 'notes-3']);
  });
  it('slugs drop code markers and punctuation like GitHub', () => {
    expect(slug('validate() in Node and in tests')).toBe('validate-in-node-and-in-tests');
    expect(slug('update: change options')).toBe('update-change-options');
    expect(slug('`compact`')).toBe('compact');
  });
  it('joins paragraph lines and separates paragraphs', () => {
    expect(markdownToHtml('one\ntwo\n\nthree')).toBe('<p>one two</p>\n<p>three</p>');
  });
  it('keeps fenced code verbatim and escaped, with its language', () => {
    expect(markdownToHtml('```ts\nconst a = 1 < 2;\n  **not bold**\n```'))
      .toBe('<pre tabindex="0"><code class="language-ts">const a = 1 &lt; 2;\n  **not bold**</code></pre>');
  });
  it('renders bulleted and numbered lists, with indented continuation lines', () => {
    expect(markdownToHtml('- a\n- b\n  more')).toBe('<ul><li>a</li><li>b more</li></ul>');
    expect(markdownToHtml('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
    expect(markdownToHtml('3. third')).toBe('<ol start="3"><li>third</li></ol>');
  });
  it('renders block quotes', () => {
    expect(markdownToHtml('> note\n> more')).toBe('<blockquote><p>note more</p></blockquote>');
  });
  it('drops whole-line HTML comments', () => {
    expect(markdownToHtml('<!-- options: Title -->\ntext')).toBe('<p>text</p>');
  });
  it('renders pipe tables with headers, alignment and escaped pipes', () => {
    const html = markdownToHtml('| Key | Type |\n|---|---:|\n| `a` | `1 \\| 2` |');
    expect(html).toContain('<th scope="col">Key</th><th scope="col" style="text-align: right">Type</th>');
    expect(html).toContain('<td><code>a</code></td><td style="text-align: right"><code>1 | 2</code></td>');
    expect(html).toMatch(/^<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table>/);
  });
  it('names each table region after its heading, uniquely', () => {
    const html = markdownToHtml('## Keys\n\n| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |');
    expect(html).toContain('aria-label="Table: Keys"');
    expect(html).toContain('aria-label="Table 2: Keys"');
  });
  it('splits rows only on unescaped pipes', () => {
    expect(splitRow('| a | `b \\| c` | d |')).toEqual(['a', '`b \\| c`', 'd']);
  });
  it('treats each directive line as a block of its own, also without blank lines around it', () => {
    const seen: string[] = [];
    const html = markdownToHtml('Text before\n[example: a](a.ts)\n[example: b](b.ts)\nText after', {
      directive: d => { seen.push(d.name); return `<div>${d.name}</div>`; },
    });
    expect(seen).toEqual(['a', 'b']);
    expect(html).toBe('<p>Text before</p>\n<div>a</div>\n<div>b</div>\n<p>Text after</p>');
  });
  it('hands directive lines to the caller and keeps other links inline', () => {
    const seen: unknown[] = [];
    const html = markdownToHtml('[example: first](../examples/first.ts)\n\n[a link](x.md)', {
      directive: d => { seen.push(d); return '<div>live</div>'; },
    });
    expect(seen).toEqual([{ kind: 'example', name: 'first', target: '../examples/first.ts' }]);
    expect(html).toBe('<div>live</div>\n<p><a href="x.md">a link</a></p>');
  });
  it('knows the four directive kinds and no other', () => {
    const seen: unknown[] = [];
    markdownToHtml('[source: s](s.ts)\n[table: t](t.mjs)\n[output: AX103](d.mjs)\n[render: r](r.ts)', {
      directive: d => { seen.push(d.kind); return '<div></div>'; },
    });
    expect(seen).toEqual(['source', 'table', 'output']);
  });
});

describe('helpers', () => {
  it('escapeHtml escapes quotes for attributes', () => {
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });
  it('wordCount counts prose, not code, comments or directives', () => {
    expect(wordCount('# Two words\n\n```\nnot counted at all\n```\n<!-- skip -->\n[example: x](y.ts)\nthree more words')).toBe(5);
  });
});
