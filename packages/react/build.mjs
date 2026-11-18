// Builds packages/react/dist, as the core's build does for packages/axylo/dist (development and production
// flavours, chosen through the `development` export condition):
//   index.js      production: identifiers and syntax minified, the development hint removed
//   index.dev.js  development: with the memoization hint
//   index.d.ts    declarations (needs packages/axylo/dist/index.d.ts, so the core is built first)
// Neither file contains a bare __DEV__, and both start with the 'use client' directive.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkg = import.meta.dirname;
const dist = path.join(pkg, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

const common = {
  entryPoints: [path.join(pkg, 'src/index.ts')], bundle: true, format: 'esm', target: 'es2022', legalComments: 'none',
  logLevel: 'warning', tsconfig: path.join(pkg, 'tsconfig.json'), external: ['react', 'react/jsx-runtime', 'react-dom', 'axylo'],
  // esbuild keeps the entry's directive; the banner is the fallback if a later version does not.
  banner: { js: "'use client';" },
};
await Promise.all([
  // Whitespace is kept: minifying it drops the /* @__PURE__ */ marks on the five component definitions, and
  // without them a consumer that imports only Line keeps all five chart types.
  build({ ...common, minifyIdentifiers: true, minifySyntax: true, define: { __DEV__: 'false' }, outfile: path.join(dist, 'index.js') }),
  build({ ...common, define: { __DEV__: 'true' }, outfile: path.join(dist, 'index.dev.js') }),
]);

for (const file of ['index.js', 'index.dev.js']) {
  const at = path.join(dist, file);
  // One directive, first: the banner and the kept source directive must not both remain.
  let code = fs.readFileSync(at, 'utf8').replace(/^(?:\s*(['"])use client\1;?\s*)+/, '');
  code = `'use client';\n${code}`;
  if (/\b__DEV__\b/.test(code)) throw new Error(`${file} still refers to __DEV__`);
  fs.writeFileSync(at, code);
}

execFileSync('npx', ['tsc', '-p', path.join(pkg, 'tsconfig.build.json')], { stdio: 'inherit', cwd: pkg });
console.log('built', fs.readdirSync(dist).join(', '));
