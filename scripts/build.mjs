// Builds packages/axylo/dist: ESM (production and development flavours), script-tag files, CSS and type declarations.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const pkg = 'packages/axylo';
fs.rmSync(`${pkg}/dist`, { recursive: true, force: true });
const common = { entryPoints: [`${pkg}/src/index.ts`], bundle: true, target: 'es2022', legalComments: 'none', logLevel: 'warning' };
await Promise.all([
  build({ ...common, format: 'esm', minify: true, define: { __DEV__: 'false' }, outfile: `${pkg}/dist/axylo.js` }),
  build({ ...common, format: 'esm', define: { __DEV__: 'true' }, outfile: `${pkg}/dist/axylo.dev.js` }),
  build({ ...common, format: 'iife', globalName: 'Axylo', define: { __DEV__: 'true' }, outfile: `${pkg}/dist/axylo.iife.js` }),
  build({ ...common, format: 'iife', globalName: 'Axylo', minify: true, define: { __DEV__: 'false' }, outfile: `${pkg}/dist/axylo.iife.min.js` }),
]);
// The stylesheet's source of truth is a string in the library (it is also applied at run time without a <style> element);
// the standalone file is for pages that prefer to load it themselves, for example under a strict Content Security Policy.
{
  const r = await build({ entryPoints: [`${pkg}/src/theme/css.ts`], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].contents).toString('base64'));
  fs.writeFileSync(`${pkg}/dist/axylo.css`, mod.AXYLO_CSS);
}
execFileSync('npx', ['tsc', '-p', `${pkg}/tsconfig.build.json`], { stdio: 'inherit' });
console.log('built', fs.readdirSync(`${pkg}/dist`).filter(f => !fs.statSync(`${pkg}/dist/${f}`).isDirectory()).join(', '));
