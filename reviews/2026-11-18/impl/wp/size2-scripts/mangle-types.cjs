// Type-checked classification of every property name in the library source: a name may be mangled only when
// every occurrence resolves to a declaration in the library's own internal files (not public.ts, not TypeScript's
// lib, not @types), and it never appears inside a string literal (dynamic lookup), and it is not a protocol name.
// Uses the TypeScript 6 compiler API from a local global install (the project's TypeScript 7 has no JS API).
//   node .scratch-size/mangle-types.cjs <variant>   writes .scratch-size/mangle-types-<variant>.json
const fs = require('fs');
const path = require('path');
const ts = require('/home/canarit/.bun/install/global/node_modules/typescript');

const here = __dirname;
const variant = path.join(here, process.argv[2] || 'base');
const options = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], strict: true, noUncheckedIndexedAccess: true,
  skipLibCheck: true, types: ['node'], noEmit: true, typeRoots: [path.join(here, '../node_modules/@types')],
};
const program = ts.createProgram([path.join(variant, 'index.ts'), path.join(variant, 'core/globals.d.ts')], options);
const checker = program.getTypeChecker();
const own = f => f.startsWith(variant + path.sep) && !f.endsWith(path.sep + 'public.ts');
const PROTOCOL = new Set(['constructor', 'prototype', 'then', 'toJSON', 'toString', 'valueOf', 'length', 'default', 'raw', 'next', 'done', 'value', 'handleEvent']);

const stats = new Map(); // name -> { internal, external, why: Set }
const note = (name, internal, why) => {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { internal: 0, external: 0, why: new Set() }));
  if (internal) s.internal++; else { s.external++; if (s.why.size < 4) s.why.add(why); }
};
const strings = new Set();
const ident = /^[A-Za-z_$][\w$]*$/;
const STRICT = process.argv.includes('--strict-strings');

function declaredInternally(symbol) {
  if (!symbol) return [false, 'no symbol'];
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const decls = symbol.declarations || [];
  if (decls.length === 0) return [false, 'no declaration (index signature, mapped, any)'];
  for (const d of decls) {
    const f = d.getSourceFile().fileName;
    if (!own(f)) return [false, path.basename(f)];
  }
  return [true, ''];
}

function propertyOf(type, name) {
  if (!type) return undefined;
  const t = checker.getApparentType(type);
  return t.getProperty(name) || (t.isUnion() ? undefined : undefined);
}

function heritageExternal(cls, name) {
  for (const h of cls.heritageClauses || []) for (const t of h.types) {
    const p = propertyOf(checker.getTypeAtLocation(t), name);
    if (p && !declaredInternally(p)[0]) return true;
  }
  return false;
}

const LIB_NAMES = new Set();
for (const f of program.getSourceFiles()) if (!own(f.fileName) && !f.fileName.startsWith(variant)) {
  // names declared in lib and @types: used to distrust literal keys that have no contextual type
  const walk = n => { if ((ts.isPropertySignature(n) || ts.isMethodSignature(n) || ts.isPropertyDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) LIB_NAMES.add(n.name.text); ts.forEachChild(n, walk); };
  walk(f);
}

function visit(node) {
  // A string that is one identifier may be a property name used as data (a key list, a compared key, a
  // literal-typed argument); a string of text is not.
  if (ts.isStringLiteralLike(node) && ident.test(node.text) && (STRICT || !ts.isTemplateLiteral(node))) strings.add(node.text);
  else if (STRICT && ts.isStringLiteralLike(node)) for (const m of node.text.matchAll(/[A-Za-z_$][\w$]*/g)) strings.add(m[0]);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const [ok, why] = declaredInternally(checker.getSymbolAtLocation(node.name));
    note(node.name.text, ok, `access: ${why}`);
  } else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.parent && ts.isObjectLiteralExpression(node.parent) && node.name && ts.isIdentifier(node.name)) {
    const name = node.name.text;
    const ct = checker.getContextualType(node.parent);
    if (ct && (ct.isUnion() ? ct.types : [ct]).some(t => checker.getIndexInfoOfType(checker.getApparentType(t), ts.IndexKind.String))) note(name, false, 'key of a dictionary (string index signature)');
    else if (ct) {
      const types = ct.isUnion() ? ct.types : [ct];
      let any = false; let ext = null;
      for (const t of types) {
        const p = propertyOf(t, name);
        if (p) { any = true; const [ok, why] = declaredInternally(p); if (!ok) ext = why; }
      }
      if (ext) note(name, false, `literal key, contextual ${ext}`);
      else if (any) note(name, true);
      else note(name, !LIB_NAMES.has(name), 'literal key, contextual type lacks it, lib name');
    } else note(name, !LIB_NAMES.has(name), 'literal key without contextual type, lib name');
  } else if ((ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.parent && ts.isClassLike(node.parent) && node.name && ts.isIdentifier(node.name)) {
    note(node.name.text, !heritageExternal(node.parent, node.name.text), 'class member implementing an external type');
  } else if ((ts.isPropertySignature(node) || ts.isMethodSignature(node)) && node.name && ts.isIdentifier(node.name)) {
    const f = node.getSourceFile().fileName;
    let external = !own(f);
    if (!external && ts.isInterfaceDeclaration(node.parent)) external = heritageExternal(node.parent, node.name.text);
    note(node.name.text, !external, external ? 'declared in public.ts or extends an external type' : '');
  } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const name = node.propertyName && ts.isIdentifier(node.propertyName) ? node.propertyName.text : ts.isIdentifier(node.name) ? node.name.text : null;
    if (name) {
      const p = propertyOf(checker.getTypeAtLocation(node.parent), name);
      const [ok, why] = declaredInternally(p);
      note(name, ok, `destructuring: ${why}`);
    }
  }
  // Reflection: the property names of these objects become data, so they keep their names.
  let reflected = null;
  if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression) && !ts.isNumericLiteral(node.argumentExpression)) reflected = node.expression;
  else if (ts.isForInStatement(node)) reflected = node.expression;
  else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && !ts.isStringLiteralLike(node.left)) reflected = node.right;
  else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.arguments.length > 0) {
    const callee = node.expression.expression.getText() + '.' + node.expression.name.text;
    if (['Object.keys', 'Object.entries', 'Object.values', 'JSON.stringify'].includes(callee)) reflected = node.arguments[0];
  }
  if (reflected) {
    const t = checker.getApparentType(checker.getTypeAtLocation(reflected));
    const types = t.isUnion() ? t.types : [t];
    for (const u of types) {
      const sym = u.getSymbol();
      const name = sym && sym.getName();
      if (['Array', 'ReadonlyArray', 'Map', 'Set', 'Float64Array', 'Float32Array', 'Int32Array', 'Uint8Array', 'Uint32Array', 'Int8Array', 'Uint16Array', 'Int16Array'].includes(name)) continue;
      for (const p of checker.getPropertiesOfType(u)) if (declaredInternally(p)[0]) note(p.getName(), false, `reflected (${ts.SyntaxKind[node.kind]})`);
    }
  }
  ts.forEachChild(node, visit);
}
for (const f of program.getSourceFiles()) if (f.fileName.startsWith(variant + path.sep) && !f.isDeclarationFile) visit(f);

const mangle = []; const kept = [];
for (const [name, s] of stats) {
  if (PROTOCOL.has(name) || name.startsWith('__')) { kept.push([name, 'protocol']); continue; }
  if (s.external > 0) { kept.push([name, [...s.why].join('; ')]); continue; }
  if (strings.has(name)) { kept.push([name, 'appears in a string literal']); continue; }
  mangle.push(name);
}
const diag = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
fs.writeFileSync(path.join(here, `mangle-types-${path.basename(variant)}${STRICT ? '-strict' : ''}.json`), JSON.stringify({ names: mangle.sort(), kept }, null, 1));
console.log(`type errors: ${diag.length}${diag.length ? ' first: ' + ts.flattenDiagnosticMessageText(diag[0].messageText, ' ') : ''}`);
console.log(`names: ${stats.size}; mangle ${mangle.length}; keep ${kept.length}`);
