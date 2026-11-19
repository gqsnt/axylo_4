/**
 * The Markdown subset the documentation pages use, and nothing more: ATX headings (# to ####), paragraphs,
 * fenced code blocks, pipe tables, flat bulleted and numbered lists, block quotes, whole-line HTML comments
 * (dropped), and the inline forms `code`, **strong**, *emphasis*, [links](url) and backslash escapes.
 *
 * Raw HTML is never passed through: every character of text is escaped, so a page cannot inject markup. Link
 * destinations are limited to site-relative paths, fragments, `https:` and `mailto:`; anything else throws.
 * A line that is only a link whose text starts with `example:`, `source:`, `table:` or `output:` is a directive, always
 * a block of its own; the caller decides what it becomes.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ESCAPES[c]);
}

/**
 * A link destination the site may emit: a relative path (no scheme, not protocol-relative), a fragment, an
 * `https:` URL or a `mailto:` address. Throws otherwise, naming the destination.
 */
export function checkHref(url) {
  const value = String(url);
  if (/[\s<>"'`\\]/.test(value) || value === '') throw new Error(`Link destination ${JSON.stringify(value)} is not allowed: it contains a space, quote or angle bracket, or is empty`);
  if (value.startsWith('#')) return value;
  if (/^https:\/\/[^/]/i.test(value) || /^mailto:[^:/]+@[^:/]+$/i.test(value)) return value;
  if (value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error(`Link destination ${JSON.stringify(value)} is not allowed: only relative paths, fragments, https: and mailto: are`);
  }
  return value;
}

/**
 * A heading's id, made the way GitHub makes it, so that a link to `data.md#three-kinds-of-time` works on a
 * code host and on the site alike: lower case, punctuation dropped, each space a hyphen.
 */
export function slug(text) {
  return plainText(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-') || 'section';
}

/** The text a reader sees in inline Markdown: markers and link targets removed. */
export function plainText(text) {
  return text
    .replace(/\\([\\`*_[\]()|#<>!-])/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

export const DIRECTIVE = /^\[(example|source|table|output):\s*([^\]]+)\]\(([^)\s]+)\)$/;
const FENCE = /^(`{3,})\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^(\d+)\.\s+(.*)$/;
const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const COMMENT = /^<!--.*-->$/;

/**
 * Converts `source` to HTML.
 * - `link(url)` rewrites a link destination (for example `data.md#gaps` to `data.html#gaps`); its result is
 *   checked with `checkHref`.
 * - `directive({ kind, name, target })` returns the HTML for a directive line.
 * - `headings` receives each heading as { level, text, id } in order.
 * - `ids` is the set of ids already used on the page; headings get ids not in it, block quotes included.
 */
export function markdownToHtml(source, { link = url => url, directive, headings = [], ids = new Set() } = {}) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const inline = text => renderInline(text, link);
  // Each table's scroll region is named after the heading it sits under, so that no two share a name.
  let section = null;
  const tableNames = new Map();
  const tableName = () => {
    const n = (tableNames.get(section) ?? 0) + 1;
    tableNames.set(section, n);
    const table = n === 1 ? 'Table' : `Table ${n}`;
    return section === null ? table : `${table}: ${section}`;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || COMMENT.test(trimmed)) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence[1])) body.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(codeBlock(body.join('\n'), fence[2]));
      continue;
    }

    const d = DIRECTIVE.exec(trimmed);
    if (d) {
      if (!directive) throw new Error(`A directive is not allowed here: ${trimmed}`);
      out.push(directive({ kind: d[1], name: d[2].trim(), target: d[3] }));
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const id = uniqueId(slug(heading[2]), ids);
      headings.push({ level, text: plainText(heading[2]), id });
      section = plainText(heading[2]);
      out.push(`<h${level} id="${escapeHtml(id)}">${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const rows = [];
      const align = splitRow(lines[i + 1]).map(cell => cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : null);
      const header = splitRow(line);
      i += 2;
      while (i < lines.length && lines[i].startsWith('|')) rows.push(splitRow(lines[i++]));
      out.push(table(header, rows, align, inline, tableName()));
      continue;
    }

    if (line.startsWith('>')) {
      const body = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(body.join('\n'), { link, directive: undefined, headings, ids })}</blockquote>`);
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const marker = ordered ? NUMBERED : BULLET;
      const items = [];
      const start = ordered ? Number(numbered[1]) : 1;
      while (i < lines.length) {
        const m = marker.exec(lines[i]);
        if (m) { items.push(ordered ? m[2] : m[1]); i++; continue; }
        // A continuation line is indented; a blank line or anything else ends the list.
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
      out.push(`<${tag}${startAttr}>${items.map(item => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && (paragraph.length === 0 || !startsBlock(lines, i))) paragraph.push(lines[i++].trim());
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}

/** `base`, or `base-2`, `base-3` … : the first not yet used on the page. Reserves it. */
export function uniqueId(base, ids) {
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  ids.add(id);
  return id;
}

function startsBlock(lines, i) {
  const line = lines[i];
  return FENCE.test(line) || HEADING.test(line) || line.startsWith('>') || BULLET.test(line) || NUMBERED.test(line) ||
    COMMENT.test(line.trim()) || DIRECTIVE.test(line.trim()) ||
    (line.startsWith('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]));
}

/** Splits a table row on pipes that are not escaped; `\|` stays in the cell as a literal pipe. */
export function splitRow(line) {
  const cells = [];
  let cell = '';
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && body[i + 1] === '|') { cell += '\\|'; i++; continue; }
    if (c === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function table(header, rows, align, inline, name = 'Table') {
  const style = index => align[index] ? ` style="text-align: ${align[index]}"` : '';
  const head = header.map((cell, index) => `<th scope="col"${style(index)}>${inline(cell)}</th>`).join('');
  const body = rows.map(row => `<tr>${header.map((_, index) => `<td${style(index)}>${inline(row[index] ?? '')}</td>`).join('')}</tr>`).join('\n');
  // The wrapper scrolls a wide table on a narrow screen, so the page itself never scrolls sideways.
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(name)}"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

export function codeBlock(code, language = '') {
  const cls = language ? ` class="language-${escapeHtml(language)}"` : '';
  return `<pre tabindex="0"><code${cls}>${escapeHtml(code)}</code></pre>`;
}

/**
 * The end of a link destination that starts at `open` (the index of its `(`): balanced parentheses, so
 * `guide(v2).md` is one destination. -1 when it does not close.
 */
function destinationEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
    else if (/\s/.test(text[i])) return -1;
  }
  return -1;
}

/** Inline Markdown to HTML. Unmatched markers are kept as text. */
export function renderInline(text, link = url => url) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && /[\\`*_[\]()|#<>!-]/.test(text[i + 1])) {
      out += escapeHtml(text[i + 1]);
      i += 2;
      continue;
    }
    if (c === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const end = text.indexOf(fence, i + run);
      if (end !== -1) {
        // Inside a table cell a literal pipe is written `\|`; the backslash is not part of the code.
        const code = text.slice(i + run, end).replace(/\\\|/g, '|');
        out += `<code>${escapeHtml(run > 1 ? code.trim() : code)}</code>`;
        i = end + run;
        continue;
      }
    }
    if (c === '[') {
      const close = matchBracket(text, i);
      if (close !== -1 && text[close + 1] === '(') {
        const end = destinationEnd(text, close + 1);
        if (end !== -1) {
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, end).trim();
          out += `<a href="${escapeHtml(checkHref(link(url)))}">${renderInline(label, link)}</a>`;
          i = end + 1;
          continue;
        }
      }
    }
    if (c === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        out += `<strong>${renderInline(text.slice(i + 2, end), link)}</strong>`;
        i = end + 2;
        continue;
      }
    }
    if (c === '*' && text[i + 1] !== ' ' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1 && text[end - 1] !== ' ') {
        out += `<em>${renderInline(text.slice(i + 1, end), link)}</em>`;
        i = end + 1;
        continue;
      }
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

function matchBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) { i = end; continue; }
    }
    if (text[i] === '[') depth++;
    if (text[i] === ']' && --depth === 0) return i;
  }
  return -1;
}

/** Words of prose in a page, for the report: code blocks, comments and table rules are not counted. */
export function wordCount(source) {
  let inCode = false;
  let words = 0;
  for (const line of source.split('\n')) {
    if (FENCE.test(line)) { inCode = !inCode; continue; }
    if (inCode || COMMENT.test(line.trim()) || TABLE_RULE.test(line) || DIRECTIVE.test(line.trim())) continue;
    words += plainText(line.replace(/\|/g, ' ')).split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  }
  return words;
}
