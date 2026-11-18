/**
 * Runnable examples: files in apps/docs/examples, each one a complete program a reader can copy.
 *
 * - `name.ts`: a module that imports from 'axylo' and draws into elements it names by id, as in
 *   `line('#chart', …)`. The example page creates one empty <div> per id it finds in such a call.
 * - `name.tsx`: a React module that renders into `#root`.
 * - `name.html`: markup and scripts for the body of the page, for examples that need their own markup.
 *
 * What an example promises is written in its own comments, in words the reader sees too:
 * - "Raises AX111 on purpose" (or "Raises AX102, AX103 and AX106 on purpose") lists the diagnostics it
 *   demonstrates; the browser test fails on any other code, and on a listed code that does not appear.
 * - "Draws no marks on purpose" marks an example whose charts show a state (loading, empty, error) instead.
 */
import fs from 'node:fs';
import path from 'node:path';

export const docsRoot = path.resolve(import.meta.dirname, '..');
export const repoRoot = path.resolve(docsRoot, '../..');
export const examplesDir = path.join(docsRoot, 'examples');
/** Scratch output that is not the site: generated type-check inputs and the vendor shims. Git-ignored. */
export const cacheDir = path.join(docsRoot, '.cache');

const CHART_CALL = /\b(?:line|area|bar|scatter|donut)\(\s*(['"])#([\w-]+)\1/g;
const RAISES = /Raises ((?:AX\d{3})(?:(?:, | and )AX\d{3})*) on purpose/;
const NO_MARKS = /Draws no marks on purpose/;
const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/g;
const CLASSIC_SCRIPT = /<script>([\s\S]*?)<\/script>/g;

export function listExamples() {
  return fs.readdirSync(examplesDir)
    // A file whose name starts with an underscore is a helper shared by examples, not an example.
    .filter(file => /\.(ts|tsx|html)$/.test(file) && !file.endsWith('.d.ts') && !file.startsWith('_'))
    .sort()
    .map(file => readExample(file));
}

export function readExample(file) {
  const ext = path.extname(file).slice(1);
  const name = path.basename(file, path.extname(file));
  const source = fs.readFileSync(path.join(examplesDir, file), 'utf8');
  const raises = RAISES.exec(source)?.[1].split(/, | and /) ?? [];
  const targets = ext === 'ts' ? [...new Set([...source.matchAll(CHART_CALL)].map(m => m[2]))] : [];
  if (ext === 'ts' && targets.length === 0) throw new Error(`${file}: no chart call with a '#id' target`);
  return { file, name, ext, source, raises, noMarks: NO_MARKS.test(source), targets };
}

/**
 * The scripts of an .html example as JavaScript files, so `tsc` checks them against the package's
 * declarations like the .ts examples (with `checkJs`; see examples/tsconfig.html.json). A module script
 * imports 'axylo' itself; a classic script uses the `Axylo` global of the script-tag build, declared in
 * globals.d.ts from the same types.
 */
export function htmlScripts(example) {
  const out = [];
  let n = 0;
  for (const m of example.source.matchAll(MODULE_SCRIPT)) {
    out.push({ file: `${example.name}.${++n}.js`, line: lineOf(example.source, m.index), code: m[1] });
  }
  for (const m of example.source.matchAll(CLASSIC_SCRIPT)) {
    // `export {}` gives each classic script its own scope, as separate pages would.
    out.push({ file: `${example.name}.${++n}.js`, line: lineOf(example.source, m.index), code: m[1] + '\nexport {};\n' });
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** Writes the extracted scripts where apps/docs/examples/tsconfig.html.json includes them. */
export function writeTypecheckInputs() {
  const dir = path.join(cacheDir, 'html-scripts');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'globals.d.ts'), "declare const Axylo: typeof import('axylo');\n");
  const map = {};
  for (const example of listExamples().filter(e => e.ext === 'html')) {
    for (const script of htmlScripts(example)) {
      fs.writeFileSync(path.join(dir, script.file), script.code);
      map[script.file] = { example: example.file, line: script.line };
    }
  }
  return map;
}
