// Class members with no reference outside their own declarations and core/instrument.ts (type-aware, through
// the TypeScript language service): esbuild keeps every member of a kept class, so these ship in production.
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
const members = [];
for (const f of files) {
  const sf = program.getSourceFile(f);
  const visit = n => {
    if (ts.isClassLike(n)) for (const m of n.members) {
      if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isPropertyDeclaration(m)) && m.name && ts.isIdentifier(m.name)) members.push({ f, cls: n.name ? n.name.text : '(anonymous)', name: m.name.text, pos: m.name.getStart(), span: [m.getStart(), m.end] });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const inside = (r, m) => r.fileName === m.f && r.textSpan.start >= m.span[0] && r.textSpan.start < m.span[1];
const results = [];
for (const m of members) {
  const refs = (ls.getReferencesAtPosition(m.f, m.pos) || []).filter(r => !r.isDefinition);
  const live = refs.filter(r => !r.fileName.endsWith('instrument.ts') && !members.some(o => o !== m && o.dead && inside(r, o)));
  m.refs = refs; m.liveCount = live.length;
  if (live.length === 0) { m.dead = true; results.push(m); }
}
// a second pass: members referenced only from dead members
let changed = true;
while (changed) {
  changed = false;
  for (const m of members) if (!m.dead) {
    const live = m.refs.filter(r => !r.fileName.endsWith('instrument.ts') && !inside(r, m) && !members.some(o => o.dead && inside(r, o)));
    if (live.length === 0) { m.dead = true; results.push(m); changed = true; }
  }
}
for (const m of results) console.log(`${path.relative(dir, m.f)}: ${m.cls}.${m.name} (${m.span[1] - m.span[0]} chars) refs-in-instrument=${m.refs.filter(r => r.fileName.endsWith('instrument.ts')).length}`);
