// Checks a built package directory against what its package.json promises, without packing it: every file the
// manifest names exists and is shipped, every declaration the exported `types` entries import is in dist/ and in
// the `files` allowlist, the declarations import no package that is not a peer, and dist/ holds no source maps
// or build state. It is the fast, offline counterpart of tests/dist/package-contents.test.ts (which reads the
// unpacked tarball): a declaration re-export to a file the tarball leaves out is caught right after the build.
//
// Importing this file checks nothing: it exports `checkDistClosure(pkgDir)`. Run directly
// (`node scripts/check-dist-closure.mjs [packageDir]`, default packages/axylo), it exits 0 with one summary line,
// or 1 with one line per problem.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/**
 * The script-tag flavours (plan 1.6). They are not in `exports`, because a bundler never imports them, so the
 * manifest alone does not name them.
 */
export const SCRIPT_TAG_FILES = ['dist/axylo.iife.js', 'dist/axylo.iife.min.js'];

/** npm's `files` accepts globs and negations; matching them faithfully needs npm, so they are refused. */
const GLOB = /[*?[\]{}!]/;
/** The files through which npm lets a subdirectory drop entries that a directory in `files` would otherwise ship. */
const IGNORE_FILES = ['.npmignore', '.gitignore'];

const isIdentifierStart = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
const isIdentifierPart = c => isIdentifierStart(c) || (c >= 48 && c <= 57);
const isSpace = c => c === 32 || (c >= 9 && c <= 13) || (c > 127 && /\s/.test(String.fromCharCode(c)));
/** Words after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
/** Words whose parenthesised condition is followed by a statement, which may start with a regular expression. */
const CONTROL_WORDS = new Set(['if', 'while', 'for', 'with']);

/**
 * Splits JavaScript or declaration text into tokens, skipping whitespace and comments (each comment is passed to
 * `onComment`, its text without the delimiters). It knows only what tells code apart from comments and literals:
 * strings, template literals with nested substitutions, and regular expressions (a `/` after a value is taken as
 * division, which is the usual heuristic and cannot be exact without a parser). Tokens are `{ kind, value }` with
 * kind 'word' (identifiers, keywords, numbers), 'string' (its unescaped-enough text), 'template' or 'punct'.
 *
 * @param {string} text
 * @param {(body: string) => void} [onComment]
 */
export function lex(text, onComment) {
  const tokens = [];
  const n = text.length;
  /** One entry per open `{`: true when it opened a template substitution, so its `}` resumes the template. */
  const braces = [];
  let i = 0;
  /** One entry per open `(`: true when it opened the condition of `if`, `while`, `for` or `with`. */
  const parens = [];
  const regexAllowed = () => {
    const last = tokens[tokens.length - 1];
    if (last === undefined) return true;
    if (last.kind === 'word') return REGEX_AFTER_WORD.has(last.value);
    if (last.kind !== 'punct') return false;
    // `if (c) /re/.test(s)` starts a statement after the condition, while `(a) / b` divides a value
    if (last.value === ')') return last.control === true;
    // `++` and `--` before a `/` can only be postfix, so the `/` divides (`i++/2`)
    return last.value !== ']' && last.value !== '++' && last.value !== '--';
  };
  const template = () => {
    // i is just past a backtick or a substitution's closing brace
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === 96) {
        i++;
        return;
      } else if (c === 36 && text.charCodeAt(i + 1) === 123) {
        i += 2;
        braces.push(true);
        return;
      } else i++;
    }
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 47 && text.charCodeAt(i + 1) === 47) {
      let end = text.indexOf('\n', i + 2);
      if (end < 0) end = n;
      const r = text.indexOf('\r', i + 2);
      if (r >= 0 && r < end) end = r;
      onComment?.(text.slice(i + 2, end));
      i = end;
      continue;
    }
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      let end = text.indexOf('*/', i + 2);
      if (end < 0) end = n;
      onComment?.(text.slice(i + 2, end));
      i = end + 2;
      continue;
    }
    if (c === 39 || c === 34) {
      let j = i + 1;
      let value = '';
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === c || d === 10 || d === 13) break;
        if (d === 92) {
          value += text[j + 1] ?? '';
          j += 2;
        } else {
          value += text[j];
          j++;
        }
      }
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    if (c === 96) {
      i++;
      template();
      tokens.push({ kind: 'template', value: '' });
      continue;
    }
    if (c === 123) {
      braces.push(false);
      tokens.push({ kind: 'punct', value: '{' });
      i++;
      continue;
    }
    if (c === 125) {
      i++;
      if (braces.pop() === true) template();
      else tokens.push({ kind: 'punct', value: '}' });
      continue;
    }
    if (c === 47 && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      for (; j < n; j++) {
        const d = text.charCodeAt(j);
        if (d === 10 || d === 13) break;
        if (d === 92) j++;
        else if (d === 91) inClass = true;
        else if (d === 93) inClass = false;
        else if (d === 47 && !inClass) break;
      }
      if (j < n && text.charCodeAt(j) === 47) {
        j++;
        while (j < n && isIdentifierPart(text.charCodeAt(j))) j++;
        tokens.push({ kind: 'template', value: '' });
        i = j;
        continue;
      }
      // not a well-formed regular expression on this line, so a division after all
    }
    if (isIdentifierPart(c)) {
      let j = i + 1;
      while (j < n && isIdentifierPart(text.charCodeAt(j))) j++;
      tokens.push({ kind: 'word', value: text.slice(i, j) });
      i = j;
      continue;
    }
    if (c === 40) {
      const last = tokens[tokens.length - 1];
      parens.push(last !== undefined && last.kind === 'word' && CONTROL_WORDS.has(last.value));
      tokens.push({ kind: 'punct', value: '(' });
      i++;
      continue;
    }
    if (c === 41) {
      tokens.push({ kind: 'punct', value: ')', control: parens.pop() === true });
      i++;
      continue;
    }
    if ((c === 43 || c === 45) && text.charCodeAt(i + 1) === c) {
      tokens.push({ kind: 'punct', value: text.slice(i, i + 2) });
      i += 2;
      continue;
    }
    tokens.push({ kind: 'punct', value: text[i] });
    i++;
  }
  return tokens;
}

/** Punctuation that cannot occur in an import clause outside its named list, so the clause has no `from`. */
const CLAUSE_STOPS = new Set([';', '=', ':', '}', '(', ')']);

/**
 * The module specifiers a declaration file names, in the forms `import '…'`, `import … from '…'`,
 * `export {…} from '…'`, `export * [as name] from '…'` and `import('…')`, read from tokens so that text in
 * comments, string and template literal types does not count and comments between the tokens do not hide one.
 * `from` counts only where a module clause expects it, since it is also an ordinary property or type name, and
 * the words of an import clause or a named list are bindings, so `class` or `interface` there ends nothing.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function declarationSpecifiers(text) {
  const specs = [];
  const tokens = lex(text);
  const is = (t, kind, value) => t !== undefined && t.kind === kind && (value === undefined || t.value === value);
  /** The specifier when tokens[k] is `from` followed by a string, else undefined. */
  const fromAt = k => (is(tokens[k], 'word', 'from') && is(tokens[k + 1], 'string') ? tokens[k + 1].value : undefined);
  /** The index just past the `}` closing the named list whose `{` is at k (named lists do not nest). */
  const pastNamedList = k => {
    while (k < tokens.length && !is(tokens[k], 'punct', '}')) k++;
    return k + 1;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== 'word' || (t.value !== 'import' && t.value !== 'export') || is(tokens[k - 1], 'punct', '.')) continue;
    const next = tokens[k + 1];
    if (t.value === 'import') {
      if (is(next, 'string')) {
        specs.push(next.value);
        k++;
      } else if (is(next, 'punct', '(') && is(tokens[k + 2], 'string')) {
        specs.push(tokens[k + 2].value);
        k += 2;
      } else if (is(next, 'word') || is(next, 'punct', '{') || is(next, 'punct', '*')) {
        // an import clause holds only bindings, then `from '…'`; `import X = require(…)` has no from
        let j = k + 1;
        while (j < tokens.length && !(tokens[j].kind === 'punct' && CLAUSE_STOPS.has(tokens[j].value))) {
          if (is(tokens[j], 'punct', '{')) j = pastNamedList(j);
          else if (fromAt(j) !== undefined) break;
          else j++;
        }
        const spec = fromAt(j);
        if (spec !== undefined) specs.push(spec);
        k = j;
      }
      continue;
    }
    // export: only a named list or a star re-exports; any other export declares something locally
    let j = k + 1;
    if (is(tokens[j], 'word', 'type') && (is(tokens[j + 1], 'punct', '{') || is(tokens[j + 1], 'punct', '*'))) j++;
    if (is(tokens[j], 'punct', '{')) j = pastNamedList(j);
    else if (is(tokens[j], 'punct', '*')) {
      j++;
      if (is(tokens[j], 'word', 'as') && (is(tokens[j + 1], 'word') || is(tokens[j + 1], 'string'))) j += 2;
    } else continue;
    const spec = fromAt(j);
    if (spec !== undefined) {
      specs.push(spec);
      k = j + 1;
    } else k = j - 1;
  }
  return specs;
}

/** A source-map directive is a comment whose text starts `#` or `@`, then `sourceMappingURL=` (ECMA-426). */
const SOURCE_MAP_DIRECTIVE = /^[#@][ \t]*sourceMappingURL=/;

/**
 * Whether JavaScript text carries a source-map directive in an actual line or block comment. Mentions in
 * strings, property names or explanatory comments do not count. Text that never spells the name is not lexed.
 *
 * @param {string} text
 */
export function hasSourceMapDirective(text) {
  if (!text.includes('sourceMappingURL')) return false;
  let found = false;
  lex(text, body => {
    if (SOURCE_MAP_DIRECTIVE.test(body)) found = true;
  });
  return found;
}

/** A package-relative posix path without `./`, or null when it leaves the package or is absolute. */
function packagePath(p) {
  if (typeof p !== 'string' || p === '' || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\\')) return null;
  const normal = path.posix.normalize(p);
  if (normal === '..' || normal.startsWith('../') || normal === '.') return null;
  return normal.replace(/^\.\//, '');
}

const inDist = rel => rel.startsWith('dist/');
const peerRoot = spec => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/**
 * Declaration files a relative specifier may name, in TypeScript's order. An explicit JavaScript or TypeScript
 * extension maps to its own declaration only; an extensionless specifier (or one whose last dot is part of the
 * name) may also name a directory's index.
 */
function declarationCandidates(base) {
  let m;
  if ((m = /^(.*)\.d\.(m|c)?ts$/.exec(base))) return [`${m[1]}.d.${m[2] ?? ''}ts`];
  if ((m = /^(.*)\.(?:js|jsx|ts|tsx)$/.exec(base))) return [`${m[1]}.d.ts`];
  if ((m = /^(.*)\.(?:mjs|mts)$/.exec(base))) return [`${m[1]}.d.mts`];
  if ((m = /^(.*)\.(?:cjs|cts)$/.exec(base))) return [`${m[1]}.d.cts`];
  return [`${base}.d.ts`, `${base}/index.d.ts`];
}

/**
 * Checks `pkgDir` (a directory holding package.json and a built dist/). Returns every problem found, each a
 * self-contained line naming the file and, for declarations, the importing file and the exact specifier.
 *
 * @param {string} pkgDir
 * @param {{ scriptTagFiles?: string[] }} [options]
 * @returns {{ ok: boolean, errors: string[], targets: number, declarations: number, scripts: number }}
 */
export function checkDistClosure(pkgDir, options = {}) {
  const errors = [];
  const result = () => ({ ok: errors.length === 0, errors, targets: targetCount, declarations: closure.size, scripts: scriptCount });
  const closure = new Set();
  let targetCount = 0;
  let scriptCount = 0;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch (e) {
    errors.push(`package.json: cannot read (${e instanceof Error ? e.message : String(e)})`);
    return result();
  }
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    errors.push('package.json: not a JSON object');
    return result();
  }

  // npm packs with lstat and never follows a link: a link, or anything beneath a linked directory, does not
  // ship. So every component below the package directory is examined without following links.
  const lstats = new Map();
  const lstat = rel => {
    let st = lstats.get(rel);
    if (st === undefined) {
      try {
        st = fs.lstatSync(path.join(pkgDir, rel));
      } catch {
        st = null;
      }
      lstats.set(rel, st);
    }
    return st;
  };
  /** { kind: 'file' | 'dir' | 'missing' | 'other' } or { kind: 'link', at } naming the first linked component. */
  const status = rel => {
    const parts = rel.split('/');
    for (let k = 1; k <= parts.length; k++) {
      const prefix = parts.slice(0, k).join('/');
      const st = lstat(prefix);
      if (st === null) return { kind: 'missing' };
      if (st.isSymbolicLink()) return { kind: 'link', at: prefix };
      if (k < parts.length && !st.isDirectory()) return { kind: 'missing' };
      if (k === parts.length) return { kind: st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other' };
    }
    return { kind: 'missing' };
  };
  const linkNote = (rel, at) =>
    at === rel ? `${rel} is a symbolic link, which npm pack skips` : `${rel} lies under ${at}, a symbolic link npm pack does not follow`;

  // What npm ships. Without an allowlist npm falls back to .npmignore/.gitignore rules this check does not
  // reproduce, so a missing or unreadable allowlist is a problem rather than "everything ships". A file listed
  // by name always ships (npm makes it a strict rule); a listed directory ships its files minus whatever an
  // ignore file at or below it, or in a directory above it, excludes, which this check does not evaluate.
  const allowFiles = new Set();
  const allowDirs = [];
  const ignoreFilesUnder = dir => {
    const found = [];
    const walk = d => {
      let entries;
      try {
        entries = fs.readdirSync(path.join(pkgDir, d), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(`${d}/${e.name}`);
        else if (IGNORE_FILES.includes(e.name)) found.push(`${d}/${e.name}`);
      }
    };
    const parts = dir.split('/');
    // the package root's own ignore files do not apply once package.json has "files"
    for (let k = 1; k < parts.length; k++) {
      const above = parts.slice(0, k).join('/');
      for (const name of IGNORE_FILES) if (lstat(`${above}/${name}`) !== null) found.push(`${above}/${name}`);
    }
    walk(dir);
    return found;
  };
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    errors.push('package.json: no "files" allowlist; what npm pack ships cannot be decided without it');
  } else {
    for (const entry of pkg.files) {
      if (typeof entry !== 'string' || GLOB.test(entry)) {
        errors.push(`package.json: files entry ${JSON.stringify(entry)} is a pattern this check cannot match exactly; list paths`);
        continue;
      }
      const rel = packagePath(entry.replace(/\/+$/, ''));
      if (rel === null) {
        errors.push(`package.json: files entry ${JSON.stringify(entry)} leaves the package`);
        continue;
      }
      const s = status(rel);
      if (s.kind === 'missing') errors.push(`package.json: files entry ${JSON.stringify(entry)} matches nothing on disk (${rel})`);
      else if (s.kind === 'link') errors.push(`package.json: files entry ${JSON.stringify(entry)}: ${linkNote(rel, s.at)}`);
      else if (s.kind === 'other') errors.push(`package.json: files entry ${JSON.stringify(entry)} is neither a file nor a directory, so npm pack skips it`);
      else if (s.kind === 'file') allowFiles.add(rel);
      else {
        allowDirs.push(rel);
        const ignores = ignoreFilesUnder(rel);
        if (ignores.length > 0) {
          errors.push(
            `package.json: files entry ${JSON.stringify(entry)} is a directory, and ${ignores.join(', ')} can drop files from it, so what npm pack ships from it is uncertain; list the files it must ship individually in "files" (npm always ships a listed file)`,
          );
        }
      }
    }
  }
  const shipped = rel => allowFiles.has(rel) || allowDirs.some(a => rel.startsWith(`${a}/`));

  /** A file the manifest names: present on disk, a regular file reached without links, and shipped. */
  const requireShipped = (label, target) => {
    targetCount++;
    const rel = packagePath(target);
    if (rel === null) {
      errors.push(`${label} → ${target}: not a path inside the package`);
      return null;
    }
    const s = status(rel);
    if (s.kind === 'missing') errors.push(`${label} → ${target}: missing (${rel} does not exist)`);
    else if (s.kind === 'link') errors.push(`${label} → ${target}: ${linkNote(rel, s.at)}`);
    else if (s.kind !== 'file') errors.push(`${label} → ${target}: ${rel} is not a file`);
    else if (!shipped(rel)) errors.push(`${label} → ${target}: ${rel} exists but is not in package.json "files", so npm pack leaves it out`);
    else return rel;
    return null;
  };

  // Every target of `exports`, under every condition (nested conditions and fallback arrays included). A target
  // anywhere beneath a `types` condition (or TypeScript's versioned `types@…`) is a declaration entry, however
  // deeply further conditions or arrays nest it.
  const typeSeeds = [];
  const isTypesCondition = c => c === 'types' || c.startsWith('types@');
  const visitTarget = (label, value, underTypes) => {
    if (value === null) return; // an explicit exclusion
    if (typeof value === 'string') {
      if (!value.startsWith('./')) {
        targetCount++;
        errors.push(`${label} → ${value}: an exports target must start with "./"`);
        return;
      }
      if (value.includes('*')) {
        targetCount++;
        errors.push(`${label} → ${value}: subpath patterns are not supported by this check`);
        return;
      }
      const rel = requireShipped(label, value);
      if (underTypes) typeSeeds.push({ label, rel: rel ?? packagePath(value) });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => visitTarget(`${label}[${i}]`, v, underTypes));
      return;
    }
    if (typeof value === 'object') {
      for (const [c, v] of Object.entries(value)) visitTarget(`${label}.${c}`, v, underTypes || isTypesCondition(c));
      return;
    }
    targetCount++;
    errors.push(`${label}: unexpected ${typeof value} in exports`);
  };
  const exportsField = pkg.exports;
  if (exportsField === undefined) {
    errors.push('package.json: no "exports" map');
  } else if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    visitTarget('exports["."]', exportsField, false);
  } else if (exportsField !== null && typeof exportsField === 'object') {
    const keys = Object.keys(exportsField);
    const subpaths = keys.filter(k => k.startsWith('.'));
    if (subpaths.length > 0 && subpaths.length !== keys.length) {
      errors.push('package.json: exports mixes subpaths and conditions at the top level');
    } else if (subpaths.length === 0) {
      visitTarget('exports["."]', exportsField, false);
    } else {
      for (const k of keys) {
        if (k.includes('*')) errors.push(`exports["${k}"]: subpath patterns are not supported by this check`);
        else visitTarget(`exports["${k}"]`, exportsField[k], false);
      }
    }
  } else {
    errors.push('package.json: "exports" is not a string, array or object');
  }
  if (exportsField !== undefined && typeSeeds.length === 0) errors.push('package.json: exports names no "types" entry');

  for (const field of ['types', 'typings', 'main', 'module']) {
    const value = pkg[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      errors.push(`package.json: "${field}" is not a string`);
      continue;
    }
    const rel = requireShipped(field, value);
    if (field === 'types' || field === 'typings') typeSeeds.push({ label: field, rel: rel ?? packagePath(value) });
  }
  for (const file of options.scriptTagFiles ?? SCRIPT_TAG_FILES) requireShipped('script tag', file);

  // The declarations the type entries reach. An entry that already failed above is not walked again; one that
  // exists and ships is walked even if it lies outside dist/, which is itself reported.
  const peers = new Set(Object.keys(pkg.peerDependencies ?? {}));
  const queue = [];
  for (const { label, rel } of typeSeeds) {
    if (rel === null) continue;
    if (!inDist(rel)) errors.push(`${label} → ${rel}: a declaration entry outside dist/`);
    if (status(rel).kind === 'file' && shipped(rel)) queue.push(rel);
  }
  while (queue.length > 0) {
    const file = queue.pop();
    if (closure.has(file)) continue;
    closure.add(file);
    const text = fs.readFileSync(path.join(pkgDir, file), 'utf8');
    for (const spec of declarationSpecifiers(text)) {
      if (!spec.startsWith('.')) {
        const name = peerRoot(spec);
        if (!peers.has(name)) errors.push(`${file}: imports '${spec}', and ${name} is not a peer dependency (declarations may import only peers)`);
        continue;
      }
      const base = packagePath(path.posix.join(path.posix.dirname(file), spec));
      if (base === null) {
        errors.push(`${file}: '${spec}' resolves outside the package`);
        continue;
      }
      const candidates = declarationCandidates(base);
      const found = candidates.find(c => inDist(c) && status(c).kind === 'file' && shipped(c));
      if (found !== undefined) {
        if (!closure.has(found)) queue.push(found);
        continue;
      }
      // Name the first candidate that exists, since that is the one the author most likely meant.
      const present = candidates.find(c => status(c).kind !== 'missing');
      if (present === undefined) {
        errors.push(`${file}: '${spec}' names a declaration that does not exist (tried ${candidates.join(', ')})`);
      } else {
        const s = status(present);
        if (s.kind === 'link') errors.push(`${file}: '${spec}' resolves to ${present}, but ${linkNote(present, s.at)}`);
        else if (s.kind !== 'file') errors.push(`${file}: '${spec}' resolves to ${present}, which is not a file`);
        else if (!inDist(present)) errors.push(`${file}: '${spec}' resolves to ${present}, which is outside dist/`);
        else errors.push(`${file}: '${spec}' resolves to ${present}, which is in dist/ but not in package.json "files", so npm pack leaves it out`);
      }
    }
  }

  // Source maps and build state anywhere in dist/, and source-map directives in the JavaScript that ships. A
  // linked dist/ is not entered: nothing beneath it ships, which the manifest checks above already report.
  const dist = status('dist');
  if (dist.kind === 'link') {
    errors.push('dist/: a symbolic link, which npm pack does not follow; build into a real directory');
    return result();
  }
  if (dist.kind !== 'dir') {
    errors.push('dist/: missing; build first');
    return result();
  }
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(pkgDir, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (/\.map$/.test(entry.name)) errors.push(`${rel}: a source map in dist/`);
      else if (/\.tsbuildinfo$/.test(entry.name)) errors.push(`${rel}: TypeScript build state in dist/`);
      else if (/\.[cm]?js$/.test(entry.name) && entry.isFile() && shipped(rel)) {
        scriptCount++;
        if (hasSourceMapDirective(fs.readFileSync(path.join(pkgDir, rel), 'utf8'))) {
          errors.push(`${rel}: shipped JavaScript refers to a source map (sourceMappingURL)`);
        }
      }
    }
  };
  walk('dist');
  return result();
}

async function main() {
  const pkgDir = path.resolve(process.argv[2] ?? path.join(root, 'packages/axylo'));
  const start = performance.now();
  const r = checkDistClosure(pkgDir);
  const ms = (performance.now() - start).toFixed(1);
  const where = path.relative(process.cwd(), pkgDir) || '.';
  if (r.ok) {
    console.log(`dist closure ok: ${where}: ${r.targets} manifest files, ${r.declarations} declarations, ${r.scripts} scripts (${ms} ms)`);
    return;
  }
  console.error(`dist closure failed: ${where}: ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}`);
  for (const e of r.errors) console.error(`  ${e}`);
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) await main();
