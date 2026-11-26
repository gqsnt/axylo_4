// This is a source scanner, not a TypeScript interpreter. It recognizes conventional Vitest
// calls, literal titles, scalar it.each lists with %s/%d/%i/%# titles, and simple template
// substitutions from for-of literal lists (including named relative imports of such lists).
// It does not resolve renamed test APIs, arbitrary expressions, shared registration functions,
// tagged tables, complex template expressions, or generated files. Unexpanded test templates can
// still anchor exact reported titles without evaluating the expression.
//
// What the scanner cannot know is recorded rather than guessed:
// - a registration inside an `if`/`else` block or statement, or after `&&`, `||`, `?` or `:`, is
//   `conditional` (it may never run for some or all of its expanded titles);
// - a `describe.each` whose rows are not a literal list is a suite of unknown title: `null` in the
//   ancestors of the tests inside it, standing for exactly one runtime suite title;
// - a `describe.each` with literal rows puts each test in one row's suite at a time, never in all of them.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ordinary = /\s+|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|=>|[\w$]+|[^\s]/y;
const regexLiteral = /\/(?:\\.|\[(?:\\.|[^\]\\\r\n])*\]|[^/\\\r\n])+\/[dgimsuvy]*/y;
const expressionStarts = new Set(['=', '(', '[', '{', ',', ':', '?', '!', '&', '|', ';', '=>', 'return']);
const beforeNegation = new Set(['+', '-', '*', '/', '%', '^', '~', '<', '>', 'await', 'case', 'delete',
  'do', 'else', 'in', 'instanceof', 'of', 'throw', 'typeof', 'void', 'yield']);

function regexContextAfter(token, previous) {
  // A TypeScript non-null assertion keeps the preceding expression's division context.
  if (token === '!' && previous && !expressionStarts.has(previous) && !beforeNegation.has(previous)) return previous;
  return token;
}

function tokenAt(source, start, previous) {
  if (source[start] === '`') return source.slice(start, scanTemplate(source, start).end);
  if (source[start] === '/' && (!previous || expressionStarts.has(previous))
    && source[start + 1] !== '/' && source[start + 1] !== '*') {
    regexLiteral.lastIndex = start;
    const regex = regexLiteral.exec(source);
    if (regex) return regex[0];
  }
  ordinary.lastIndex = start;
  return ordinary.exec(source)[0];
}

const trivia = token => /^\s|^\/[/\*]/.test(token);

function scanTemplate(source, start) {
  let end = start + 1;
  const spans = [];
  while (end < source.length) {
    const char = source[end++];
    if (char === '\\') end++;
    else if (char === '`') break;
    else if (char === '$' && source[end] === '{') {
      const from = end - 1;
      let braces = 1;
      let previous = '{';
      end++;
      while (braces && end < source.length) {
        const token = tokenAt(source, end, previous);
        end += token.length;
        if (trivia(token)) continue;
        if (token === '{') braces++;
        if (token === '}') braces--;
        previous = regexContextAfter(token, previous);
      }
      spans.push({ from, to: end });
    }
  }
  return { end, spans };
}

export function tokens(source) {
  const parts = [];
  let previous;
  for (let start = 0; start < source.length;) {
    const token = tokenAt(source, start, previous);
    start += token.length;
    if (trivia(token)) continue;
    parts.push(token);
    previous = regexContextAfter(token, previous);
  }
  return parts;
}

function unescape(text) {
  return text.replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|(\r\n|[\s\S]))/gi,
    (_, codePoint, unicode, hex, char) => {
      const code = codePoint ?? unicode ?? hex;
      if (code !== undefined) return String.fromCodePoint(parseInt(code, 16));
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '', '\r': '', '\r\n': '' })[char] ?? char;
    });
}

const closer = { '(': ')', '[': ']', '{': '}' };
function closing(parts, start) {
  const stack = [];
  for (let index = start; index < parts.length; index++) {
    const token = parts[index];
    if (Object.hasOwn(closer, token)) stack.push(closer[token]);
    else if (token === stack.at(-1)) stack.pop();
    if (!stack.length) return index;
  }
  return parts.length;
}

function literalList(parts, start) {
  if (parts[start] !== '[') return null;
  const values = [];
  let index = start + 1;
  while (index < parts.length && parts[index] !== ']') {
    const token = parts[index];
    if (token === '[') {
      const nested = literalList(parts, index);
      if (!nested) return null;
      values.push(nested);
      index = closing(parts, index);
    } else {
      const value = token === '-' ? token + parts[++index] : token;
      if (/^['"]/.test(value)) values.push(unescape(value.slice(1, -1)));
      else if (/^-?\d+$|^(true|false|null|NaN|Infinity|-Infinity)$/.test(value)) values.push(value);
      else return null;
    }
    index++;
    if (parts[index] === ',') index++;
    else if (parts[index] !== ']') return null;
  }
  return parts[index] === ']' ? values : null;
}

function listByName(source, file, name) {
  if (!/^\w+$/.test(name)) return null;
  const declaration = new RegExp('\\bconst\\s+' + name + '\\s*(?::[^=;]+)?=\\s*(?=\\[)');
  const list = content => {
    const match = declaration.exec(content);
    return match && literalList(tokens(content.slice(match.index + match[0].length)), 0);
  };
  const local = list(source);
  if (local) return local;
  const imports = source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/gm);
  for (const [, names, specifier] of imports) {
    if (!names.split(',').some(imported => imported.trim() === name)) continue;
    const base = resolve(dirname(file), specifier);
    for (const candidate of [base, base + '.ts', base + '.js', base + '.mjs']) {
      try {
        return list(readFileSync(candidate, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
      }
    }
  }
  return null;
}

function expandTitles(token, rows, loops) {
  if (!token || !/^['"`]/.test(token)) return [];
  const raw = token.slice(1, -1);
  let titles = [raw];
  if (token.startsWith('`')) {
    const spans = scanTemplate(token, 0).spans.map(({ from, to }) =>
      ({ from, to, name: token.slice(from + 2, to - 1).trim() }));
    let bindings = [new Map()];
    for (const name of new Set(spans.map(span => span.name))) {
      const loop = loops.findLast(item => item.name === name);
      if (!loop || !loop.values || loop.values.some(Array.isArray)) return [];
      bindings = bindings.flatMap(binding => loop.values.map(value => new Map([...binding, [name, value]])));
    }
    titles = bindings.map(binding => {
      let start = 1;
      const parts = [];
      for (const { from, to, name } of spans) {
        parts.push(token.slice(start, from), binding.get(name));
        start = to;
      }
      return parts.join('') + token.slice(start, -1);
    });
  }
  if (rows) {
    titles = titles.flatMap(title => rows.map((row, index) => {
      const values = Array.isArray(row) ? row : [row];
      let column = 0;
      return title.replace(/%[sdi#%]/g, match => {
        if (match === '%#') return index;
        if (match === '%%') return '%';
        return values[column++] ?? match;
      });
    }));
  }
  return titles.map(unescape);
}

export function readTitles(source, file) {
  const parts = tokens(source);
  const suites = [];
  const tests = [];
  const templates = [];
  const loops = [];
  const conditions = [];
  for (let index = 0; index < parts.length; index++) {
    const token = parts[index];
    if ((token === 'if' && parts[index + 1] === '(') || token === 'else') {
      const body = token === 'if' ? closing(parts, index + 1) + 1 : index + 1;
      if (parts[body] !== 'if') conditions.push({ start: body, end: parts[body] === '{' ? closing(parts, body) : statementEnd(parts, body) });
    }
    if (token === 'for' && parts[index + 1] === '(' && parts[index + 2] === 'const' && parts[index + 4] === 'of') {
      const start = closing(parts, index + 1) + 1;
      if (parts[start] === '{') {
        const values = literalList(parts, index + 5) ?? listByName(source, file, parts[index + 5]);
        loops.push({ name: parts[index + 3], start, end: closing(parts, start), values });
      }
    }
    if (!['it', 'test', 'describe'].includes(token) || parts[index - 1] === '.') continue;
    let call = index + 1;
    let rows;
    const modifiers = [];
    while (parts[call] === '.') {
      const modifier = parts[call + 1];
      modifiers.push(modifier);
      call += 2;
      if (['each', 'skipIf', 'runIf'].includes(modifier) && parts[call] === '(') {
        // A literal list, or a const declared as one (here or in a named relative import), as for-of loops.
        if (modifier === 'each') rows = literalList(parts, call + 1) ?? (parts[call + 2] === ')' ? listByName(source, file, parts[call + 1]) : null) ?? [];
        call = closing(parts, call) + 1;
      }
    }
    if (parts[call] !== '(') continue;
    const titles = [',', ')'].includes(parts[call + 2])
      ? expandTitles(parts[call + 1], rows, loops.filter(loop => loop.start < index && index < loop.end))
      : [];
    const containing = suites.filter(suite => suite.start < index && index < suite.end);
    const forbidden = [...new Set([...containing.flatMap(suite => suite.forbidden),
      ...modifiers.filter(modifier => ['fails', 'todo', 'skip'].includes(modifier))])];
    const conditional = ['&&', '||', '?', ':'].includes(parts[index - 1])
      || conditions.some(range => range.start <= index && index <= range.end) || containing.some(suite => suite.conditional);
    if (token === 'describe') {
      const end = closing(parts, call);
      // The callback's block ends just before the last argument or closing parenthesis.
      const start = parts.indexOf('{', call + 3);
      // A describe.each over rows the scanner cannot list is one suite whose runtime title is unknown.
      const names = titles.length ? titles : modifiers.includes('each') ? [null] : [];
      if (start !== -1 && start < end) for (const title of names) suites.push({ title, start, end: closing(parts, start), forbidden, conditional });
    } else {
      // Suites over the same block are the rows of one describe.each: a test is in one of them at a time.
      const levels = [];
      for (const suite of containing) {
        const level = levels.find(group => group[0].start === suite.start && group[0].end === suite.end);
        if (level) level.push(suite);
        else levels.push([suite]);
      }
      const paths = levels.reduce((all, level) => all.flatMap(path => level.map(suite => [...path, suite.title])), [[]]);
      for (const ancestors of paths) {
        if (!titles.length && parts[call + 1]?.startsWith('`') && [',', ')'].includes(parts[call + 2])) {
          templates.push({ template: parts[call + 1].slice(1, -1), ancestors, forbidden, conditional });
        }
        // An unresolved case must stop a partially reported suite from appearing to pass.
        for (const title of titles.length ? titles : [null]) tests.push({ title, ancestors, forbidden, conditional });
      }
    }
  }
  return { suites, tests, templates };
}

/** The last token of the statement that starts at `start`: a `;` or the token before an unmatched closer. */
function statementEnd(parts, start) {
  for (let index = start; index < parts.length; index++) {
    const token = parts[index];
    if (Object.hasOwn(closer, token)) index = closing(parts, index);
    else if (token === ';') return index;
    else if (token === ')' || token === ']' || token === '}') return index - 1;
  }
  return parts.length;
}

export function matchesTemplate(title, template) {
  const source = '`' + template + '`';
  const { spans } = scanTemplate(source, 0);
  if (!spans.length) return false;
  const literals = [];
  let start = 1;
  for (const { from, to } of spans) {
    literals.push(unescape(source.slice(start, from)));
    start = to;
  }
  literals.push(unescape(source.slice(start, -1)));
  const pattern = literals.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?');
  return new RegExp('^' + pattern + '$').test(title);
}
