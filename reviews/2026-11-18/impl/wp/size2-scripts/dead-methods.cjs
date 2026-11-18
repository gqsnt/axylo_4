// Class members of the library source with no reference in the production code (instrument.ts excluded):
// esbuild keeps every member of a class that is kept, so these reach the shipped files.
const fs = require('fs'); const path = require('path');
const ts = require('/home/canarit/.bun/install/global/node_modules/typescript');
const dir = path.join(__dirname, process.argv[2] || 'base');
const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } })(dir);
const prod = files.filter(f => !f.endsWith('instrument.ts'));
const texts = new Map(prod.map(f => [f, fs.readFileSync(f, 'utf8')]));
const out = [];
for (const f of files) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.ES2022, true);
  const visit = n => {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      for (const m of n.members) {
        if (!(ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isPropertyDeclaration(m)) || !m.name || !ts.isIdentifier(m.name)) continue;
        const name = m.name.text;
        const re = new RegExp(`(\\.|\\?\\.)${name}\\b|\\b${name}\\s*:|\\[['"]${name}['"]\\]|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`, 'g');
        let refs = 0;
        for (const [g, t] of texts) refs += (t.match(re) || []).length;
        if (refs === 0) out.push(`${path.relative(dir, f)}: ${n.name ? n.name.text : '(class)'}.${name} (${m.end - m.pos} chars)`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
console.log(out.join('\n'));
