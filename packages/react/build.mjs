// Builds packages/react/dist, as the core's build does for packages/axylo/dist (development and production
// flavours, chosen through the `development` export condition):
//   index.js      production: identifiers and syntax minified, the development hint removed
//   index.dev.js  development: with the memoization hint
//   index.d.ts    declarations. They need the core's declarations: packages/axylo/dist/index.d.ts (the root
//                 build makes it first), or the directory named by AXYLO_CORE_TYPES (the tests build one).
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

const coreTypes = process.env.AXYLO_CORE_TYPES;
let project = path.join(pkg, 'tsconfig.build.json');
if (coreTypes) {
  // The same project, with `axylo` resolved to the given declarations; the emitted files still import 'axylo'.
  project = path.join(coreTypes, 'tsconfig.react-build.json');
  fs.writeFileSync(project, JSON.stringify({ extends: path.join(pkg, 'tsconfig.build.json'), compilerOptions: {
    paths: { axylo: [path.join(coreTypes, 'index.d.ts')] },
    // Type packages are looked up next to the config by default; this one lives outside the repository.
    typeRoots: [path.join(pkg, '../../node_modules/@types')],
  } }));
} else if (!fs.existsSync(path.join(pkg, '../axylo/dist/index.d.ts'))) {
  throw new Error('@axylo/react build: packages/axylo/dist/index.d.ts is missing. Build the core first (`npm run build` builds the core, then this package), or set AXYLO_CORE_TYPES to a directory holding its declarations.');
}
execFileSync('npx', ['tsc', '-p', project], { stdio: 'inherit', cwd: pkg });
console.log('built', fs.readdirSync(dist).join(', '));
