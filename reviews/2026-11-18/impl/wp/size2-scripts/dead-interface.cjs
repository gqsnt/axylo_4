// Interface members (internal files) that production code never reads: every reference is an implementation
// (an object-literal property or class member that writes it) or sits in core/instrument.ts. The implementing
// functions are kept by the bundler because they are properties of live objects.
const fs = require('fs'); const path = require('path');
const ts = require('/home/canarit/.bun/install/global/node_modules/typescript');
const dir = path.join(__dirname, process.argv[2] || 'base');
const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } })(dir);
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], strict: true, skipLibCheck: true, types: [] };
const host = {
  getScriptFileNames: () => files, getScriptVersion: () => '1', getScriptSnapshot: f => fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined,
  getCurrentDirectory: () => dir, getCompilationSettings: () => options, getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host);
const program = ls.getProgram();
const out = [];
for (const f of files) {
  if (f.endsWith('public.ts')) continue;
  const sf = program.getSourceFile(f);
  const visit = n => {
    if (ts.isInterfaceDeclaration(n) || ts.isTypeLiteralNode(n)) for (const m of n.members) {
      if (!(ts.isMethodSignature(m) || ts.isPropertySignature(m)) || !m.name || !ts.isIdentifier(m.name)) continue;
      const refs = (ls.getReferencesAtPosition(f, m.name.getStart()) || []).filter(r => !r.isDefinition);
      const reads = refs.filter(r => {
        if (r.fileName.endsWith('instrument.ts')) return false;
        if (r.isWriteAccess) return false;
        const node = findNode(program.getSourceFile(r.fileName), r.textSpan.start);
        // a property assignment / method in an object literal or a class member implements, it does not read
        const p = node && node.parent;
        if (p && (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === node) return false;
        return true;
      });
      if (reads.length === 0 && refs.length > 0) out.push(`${path.relative(dir, f)}: ${ts.isInterfaceDeclaration(n) ? n.name.text : '{…}'}.${m.name.text} (implementations: ${refs.length})`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
function findNode(sf, pos) { let found; const v = n => { if (pos >= n.getStart(sf) && pos < n.end) { found = n; ts.forEachChild(n, v); } }; v(sf); return found; }
console.log(out.join('\n'));
