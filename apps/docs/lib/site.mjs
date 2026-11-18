/**
 * Builds the documentation site into apps/docs/dist from the Markdown pages, the runnable examples, the
 * diagnostics data file and the library's built files (packages/axylo/dist, packages/react/dist).
 *
 * Every example runs live in its own page (dist/examples/<name>.html) against the built library, loaded
 * through an import map, and is embedded in the documentation page beside its source. Each example page is
 * its own document so that its ids, its console and Axylo's once-per-page printing of diagnostics belong to
 * that example alone; the browser test opens the same pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { escapeHtml, markdownToHtml, codeBlock, renderInline, wordCount, slug } from './markdown.mjs';
import { cacheDir, docsRoot, listExamples, repoRoot } from './examples.mjs';
import { nav, pages } from '../data/nav.mjs';

const libDist = path.join(repoRoot, 'packages/axylo/dist');
const reactDist = path.join(repoRoot, 'packages/react/dist');
const pagesDir = path.join(docsRoot, 'pages');
const siteDir = path.join(docsRoot, 'site');

const REQUIRED = [
  [libDist, ['axylo.js', 'axylo.dev.js', 'axylo.iife.js', 'axylo.iife.min.js', 'axylo.css', 'index.d.ts']],
  [reactDist, ['index.js', 'index.dev.js', 'index.d.ts']],
];

/** Fails with the command to run when the library has not been built. */
export function checkLibraryBuilt() {
  const missing = REQUIRED.flatMap(([dir, files]) => files.map(f => path.join(dir, f)).filter(f => !fs.existsSync(f)));
  if (missing.length) {
    throw new Error(`The library is not built (missing ${missing.map(f => path.relative(repoRoot, f)).join(', ')}). Run \`npm run build\` first.`);
  }
}

/** Bundles a TypeScript source of the library and imports it, to read data the built bundle does not export. */
export async function importSource(relative) {
  const result = await build({
    entryPoints: [path.join(repoRoot, relative)], bundle: true, format: 'esm', write: false, platform: 'neutral',
    define: { __DEV__: 'true' }, logLevel: 'silent',
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
}

/**
 * The default token values of the built stylesheet, per scheme: `--axylo-default-axis` → `#5f6470`. Read from
 * dist/axylo.css, so the site shows what ships.
 */
export function readThemeDefaults(css = fs.readFileSync(path.join(libDist, 'axylo.css'), 'utf8')) {
  const block = selector => {
    const at = css.indexOf(selector + ' {');
    if (at === -1) throw new Error(`axylo.css has no "${selector}" block`);
    const body = css.slice(at + selector.length + 2, css.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/(--axylo-default-[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  };
  return { light: block('.axylo'), dark: block('.axylo[data-axylo-scheme="dark"]') };
}

const HEX = /^#[0-9a-f]{3,8}$/i;

export async function buildSite({ outDir = path.join(docsRoot, 'dist'), log = () => {} } = {}) {
  checkLibraryBuilt();
  const warnings = [];
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const dir of ['assets/vendor', 'examples', 'diagnostics']) fs.mkdirSync(path.join(outDir, dir), { recursive: true });

  const theme = readThemeDefaults();
  writeAssets(outDir, theme);
  await buildVendor(outDir);
  const examples = await buildExamples(outDir);
  const { diagnostics } = await import(pathToFileURL(path.join(docsRoot, 'data/diagnostics.mjs')).href + `?t=${Date.now()}`);
  const { tokens, internalTokens } = await import(pathToFileURL(path.join(docsRoot, 'data/tokens.mjs')).href + `?t=${Date.now()}`);
  const messages = (await importSource('packages/axylo/src/messages/index.ts')).defaultMessages;
  const seen = await diagnosticOutput(diagnostics);
  const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/axylo/package.json'), 'utf8')).version;

  const context = { outDir, examples, diagnostics, seen, tokens, internalTokens, messages, theme, warnings, version };
  const report = [];
  for (const [index, entry] of pages.entries()) {
    const file = path.join(pagesDir, `${entry.page}.md`);
    const source = fs.readFileSync(file, 'utf8');
    const html = renderPage(entry, source, index, context);
    fs.writeFileSync(path.join(outDir, `${entry.page}.html`), html);
    report.push({ page: entry.page, words: wordCount(source) });
  }
  for (const d of diagnostics) {
    fs.writeFileSync(path.join(outDir, 'diagnostics', `${d.code}.html`), renderDiagnosticPage(d, context));
  }
  const broken = checkLinks(outDir);
  if (broken.length) throw new Error('Broken links:\n' + broken.join('\n'));
  for (const w of warnings) log('warning: ' + w);
  return { pages: report, examples, warnings, diagnostics: diagnostics.length };
}

// ---------- assets ----------

function writeAssets(outDir, theme) {
  const pick = (scheme, name) => {
    const value = theme[scheme][`--axylo-default-${name}`];
    if (!value || !HEX.test(value)) throw new Error(`axylo.css: no colour for --axylo-default-${name} (${scheme})`);
    return value;
  };
  // The site's surfaces use the chart's own default tokens, so the pages and the charts match.
  const vars = scheme => ['background', 'axis', 'grid', 'muted', 'focus', 'reference']
    .map(name => `  --site-${name}: ${pick(scheme, name)};`).join('\n');
  const tokens = `/* Generated from packages/axylo/dist/axylo.css by apps/docs/lib/site.mjs. */
:root {
${vars('light')}
}
@media (prefers-color-scheme: dark) {
  :root {
${vars('dark')}
  }
}
`;
  fs.writeFileSync(path.join(outDir, 'assets/site.css'), tokens + fs.readFileSync(path.join(siteDir, 'site.css'), 'utf8'));
  for (const file of ['page.js', 'frame.js']) fs.copyFileSync(path.join(siteDir, file), path.join(outDir, 'assets', file));
  // The development flavour, so example pages print hints as an application in development would.
  fs.copyFileSync(path.join(libDist, 'axylo.dev.js'), path.join(outDir, 'assets/axylo.js'));
  fs.copyFileSync(path.join(reactDist, 'index.dev.js'), path.join(outDir, 'assets/axylo-react.js'));
  // Next to the example pages, so the script-tag example reads `<script src="axylo.iife.js">` as a reader would write it.
  fs.copyFileSync(path.join(libDist, 'axylo.iife.js'), path.join(outDir, 'examples/axylo.iife.js'));
  fs.copyFileSync(path.join(libDist, 'axylo.css'), path.join(outDir, 'examples/axylo.css'));
}

/**
 * React and React DOM as ES modules for the import map. Both packages are CommonJS, so each entry is a small
 * module that re-exports the names the package has, read from the package itself.
 */
async function buildVendor(outDir) {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const dir = path.join(cacheDir, 'vendor');
  fs.mkdirSync(dir, { recursive: true });
  const entries = { react: 'react', 'jsx-runtime': 'react/jsx-runtime', 'react-dom-client': 'react-dom/client' };
  const entryPoints = {};
  for (const [out, specifier] of Object.entries(entries)) {
    const names = Object.keys(require(specifier)).filter(n => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
    const file = path.join(dir, `${out}.mjs`);
    fs.writeFileSync(file, `import m from '${specifier}';\nexport default m;\n${names.map(n => `export const ${n} = m.${n};`).join('\n')}\n`);
    entryPoints[out] = file;
  }
  await build({
    entryPoints, bundle: true, format: 'esm', splitting: true, outdir: path.join(outDir, 'assets/vendor'), target: 'es2022',
    define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning', nodePaths: [path.join(repoRoot, 'node_modules')],
    absWorkingDir: repoRoot,
  });
}

// ---------- examples ----------

const IMPORT_MAP = JSON.stringify({ imports: {
  axylo: '../assets/axylo.js',
  '@axylo/react': '../assets/axylo-react.js',
  react: '../assets/vendor/react.js',
  'react/jsx-runtime': '../assets/vendor/jsx-runtime.js',
  'react-dom/client': '../assets/vendor/react-dom-client.js',
} }, null, 2);

async function buildExamples(outDir) {
  const examples = listExamples();
  const compiled = examples.filter(e => e.ext !== 'html');
  if (compiled.length) {
    await build({
      entryPoints: compiled.map(e => path.join(docsRoot, 'examples', e.file)), bundle: true, format: 'esm', target: 'es2022',
      outdir: path.join(outDir, 'examples'), jsx: 'automatic', logLevel: 'warning',
      external: ['axylo', '@axylo/react', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    });
  }
  const manifest = [];
  for (const e of examples) {
    fs.writeFileSync(path.join(outDir, 'examples', `${e.name}.html`), examplePage(e));
    manifest.push({ name: e.name, file: e.file, ext: e.ext, raises: e.raises, noMarks: e.noMarks });
  }
  fs.writeFileSync(path.join(outDir, 'examples/manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function examplePage(e) {
  // An .html example's own <style> goes to the head, where it belongs; the reader sees it in the source as written.
  const styles = e.ext === 'html' ? [...e.source.matchAll(/<style>[\s\S]*?<\/style>\n?/g)].map(m => m[0]).join('') : '';
  const body = e.ext === 'html'
    ? e.source.replace(/<style>[\s\S]*?<\/style>\n?/g, '')
    : e.ext === 'tsx'
      ? '<div id="root"></div>\n<script type="module" src="' + e.name + '.js"></script>'
      : e.targets.map(id => `<div id="${escapeHtml(id)}" class="example-target"></div>`).join('\n') +
        `\n<script type="module" src="${e.name}.js"></script>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Example: ${escapeHtml(e.name)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="../assets/site.css">
<script type="importmap">
${IMPORT_MAP}
</script>
<script src="../assets/frame.js" defer></script>
${styles}</head>
<body class="example-page">
${body}
</body>
</html>
`;
}

// ---------- pages ----------

function renderPage(entry, source, index, ctx) {
  const headings = [];
  const where = path.join(pagesDir, `${entry.page}.md`);
  const body = markdownToHtml(source, {
    headings,
    link: url => pageLink(url),
    directive: d => directive(d, where, ctx),
  });
  const title = headings.find(h => h.level === 1)?.text ?? entry.label;
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const pager = `<nav class="pager" aria-label="Previous and next page">${prev ? `<a rel="prev" href="${prev.page}.html">← ${escapeHtml(prev.label)}</a>` : '<span></span>'}${next ? `<a rel="next" href="${next.page}.html">${escapeHtml(next.label)} →</a>` : ''}</nav>`;
  return layout({
    title, body: body + pager, current: entry.page, base: '', ctx,
    sourcePath: `apps/docs/pages/${entry.page}.md`,
  });
}

const PAGE_NAMES = new Set(pages.map(p => p.page));

/** Rewrites a link written for the Markdown sources (readable on a code host) to its place in the site. */
export function pageLink(url, base = '') {
  if (/^[a-z]+:/i.test(url) || url.startsWith('#')) return url;
  const [file, hash] = url.split('#');
  const code = file === 'diagnostics.md' && hash && /^ax\d{3}$/i.test(hash) ? hash.toUpperCase() : null;
  if (code) return `${base}diagnostics/${code}.html`;
  const name = file.endsWith('.md') && !file.includes('/') ? file.slice(0, -3) : null;
  if (name !== null && PAGE_NAMES.has(name)) return `${base}${name}.html${hash ? '#' + hash : ''}`;
  // A path into the repository: pages/ and dist/ sit at the same depth, so it resolves the same from both
  // when the site is served from the repository root.
  return base + url;
}

function directive({ kind, name, target }, where, ctx) {
  if (kind === 'example') return exampleBlock(name, target, where, ctx);
  if (kind === 'source') return sourceBlock(name, target, where, ctx);
  if (kind === 'table') return generatedTable(name, ctx);
  throw new Error(`Unknown directive ${kind}`);
}

function exampleBlock(name, target, where, ctx) {
  const file = path.resolve(path.dirname(where), target);
  const example = ctx.examples.find(e => path.join(docsRoot, 'examples', e.file) === file);
  if (!example) throw new Error(`${path.relative(repoRoot, where)}: example ${target} does not exist`);
  if (example.name !== name) throw new Error(`${path.relative(repoRoot, where)}: example link text "${name}" does not match ${example.file}`);
  const source = fs.readFileSync(file, 'utf8');
  const targets = example.ext === 'ts' ? Math.max(1, (source.match(/\b(?:line|area|bar|scatter|donut)\(\s*['"]#/g) ?? []).length) : 1;
  const raises = example.raises.length
    ? `<p class="example-note">This example raises ${listText(example.raises.map(c => `<a href="diagnostics/${c}.html">${c}</a>`))} on purpose.</p>`
    : '';
  const height = example.ext === 'ts' ? targets * 470 : 470;
  return `<figure class="example" id="example-${escapeHtml(example.name)}">
<div class="example-live"><iframe src="examples/${escapeHtml(example.name)}.html" title="Live example: ${escapeHtml(example.name)}" loading="lazy" style="height: ${height}px"></iframe></div>
${raises}<figcaption><span>Source</span> <a href="../examples/${escapeHtml(example.file)}">examples/${escapeHtml(example.file)}</a> · <a href="examples/${escapeHtml(example.name)}.html">open on its own</a></figcaption>
${codeBlock(source, example.ext)}
</figure>`;
}

/** "a", "a and b", "a, b and c". */
function listText(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sourceBlock(label, target, where, ctx) {
  const [file, range] = target.split('#');
  const absolute = path.resolve(path.dirname(where), file);
  const shown = path.relative(repoRoot, absolute);
  if (!fs.existsSync(absolute)) {
    ctx.warnings.push(`${path.relative(repoRoot, where)}: ${shown} does not exist yet; the page shows a placeholder`);
    return `<figure class="source source-missing"><figcaption>${escapeHtml(label)}</figcaption><p>This snippet is quoted from <code>${escapeHtml(shown)}</code>, which did not exist when this site was built.</p></figure>`;
  }
  let text = fs.readFileSync(absolute, 'utf8').replace(/\n$/, '');
  const lines = range && /^L(\d+)-L(\d+)$/.exec(range);
  if (range && !lines) throw new Error(`${path.relative(repoRoot, where)}: bad line range ${range}`);
  if (lines) {
    const all = text.split('\n');
    const [from, to] = [Number(lines[1]), Number(lines[2])];
    if (from < 1 || to > all.length || from > to) throw new Error(`${path.relative(repoRoot, where)}: ${shown} has no lines ${from}–${to}`);
    text = all.slice(from - 1, to).join('\n');
  }
  const ext = path.extname(file).slice(1);
  const named = label === shown || label === file ? '' : `${escapeHtml(label)} · `;
  return `<figure class="source"><figcaption>${named}<a href="${escapeHtml(target)}">${escapeHtml(shown)}${lines ? `, lines ${lines[1]}–${lines[2]}` : ''}</a></figcaption>${codeBlock(text, ext)}</figure>`;
}

function generatedTable(name, ctx) {
  if (name === 'diagnostic codes') return diagnosticsTable(ctx);
  if (name === 'theme tokens') return tokensTable(ctx);
  if (name === 'internal tokens') return internalTokensTable(ctx);
  if (name === 'messages') return messagesTable(ctx);
  if (name === 'palette') return paletteTable(ctx);
  throw new Error(`Unknown generated table "${name}"`);
}

function htmlTable(head, rows, caption) {
  const th = head.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(caption)}"><table><thead><tr>${th}</tr></thead><tbody>${rows.map(r => `<tr>${r.join('')}</tr>`).join('')}</tbody></table></div>`;
}

function diagnosticsTable(ctx) {
  const rows = ctx.diagnostics.map(d => [
    `<th scope="row"><a href="diagnostics/${d.code}.html">${d.code}</a></th>`,
    `<td><span class="level level-${d.level}">${escapeHtml(d.level)}</span></td>`,
    `<td>${renderInline(d.condition)}</td>`,
    `<td>${renderInline(d.drawn)}</td>`,
  ]);
  return htmlTable(['Code', 'Level', 'When', 'What is drawn'], rows, 'Diagnostic codes');
}

function swatch(value) {
  // Only a colour read from the library's own stylesheet reaches a style attribute, and only as a hex value.
  if (!HEX.test(value)) return `<code>${escapeHtml(value)}</code>`;
  return `<span class="swatch" style="background: ${value}" aria-hidden="true"></span><code>${escapeHtml(value)}</code>`;
}

function tokensTable(ctx) {
  const rows = ctx.tokens.map(t => {
    const cell = scheme => t.default
      ? `<td>${swatch(ctx.theme[scheme][t.default] ?? missing(t.default, scheme))}</td>`
      : `<td>${renderInline(t.unset)}</td>`;
    // What it affects comes before the defaults, so a phone shows it without scrolling the table.
    return [`<th scope="row"><code>${escapeHtml(t.name)}</code></th>`, `<td class="wide">${renderInline(t.affects)}</td>`, cell('light'), cell('dark')];
  });
  return htmlTable(['Property', 'What it affects', 'Light default', 'Dark default'], rows, 'Theme custom properties');
}

function missing(name, scheme) {
  throw new Error(`axylo.css has no ${name} in the ${scheme} scheme`);
}

function internalTokensTable(ctx) {
  const rows = ctx.internalTokens.map(t => [`<th scope="row"><code>${escapeHtml(t.name)}</code></th>`, `<td>${renderInline(t.why)}</td>`]);
  return htmlTable(['Property', 'Why it exists'], rows, 'Internal custom properties');
}

function messagesTable(ctx) {
  const rows = Object.entries(ctx.messages).map(([key, text]) => [
    `<th scope="row"><code>${escapeHtml(key)}</code></th>`, `<td>${escapeHtml(text)}</td>`,
  ]);
  return htmlTable(['Key', 'Built-in English text'], rows, 'Built-in messages');
}

function paletteTable(ctx) {
  const rows = [];
  for (let slot = 1; ; slot++) {
    const name = `--axylo-default-series-${slot}`;
    if (!(name in ctx.theme.light)) break;
    rows.push([`<th scope="row">${slot}</th>`, `<td>${swatch(ctx.theme.light[name])}</td>`, `<td>${swatch(ctx.theme.dark[name])}</td>`]);
  }
  return htmlTable(['Slot', 'Light', 'Dark'], rows, 'Default palette');
}

// ---------- diagnostics ----------

/**
 * What each code's minimal input prints. Inputs that run in Node go through the built library's `validate()`,
 * so the page shows the message exactly as the library writes it; the others need a browser (contrast, size,
 * labels, formatters, appends) and show the registry's message for the sample details in the data file.
 */
async function diagnosticOutput(diagnostics) {
  const lib = await import(pathToFileURL(path.join(libDist, 'axylo.js')).href);
  const registry = await importSource('packages/axylo/src/diagnostics/registry.ts');
  const out = new Map();
  for (const d of diagnostics) {
    if (d.run === 'node') {
      const found = new Function('validate', `return ${d.input}`)(lib.validate);
      const mine = found.filter(x => x.code === d.code);
      if (mine.length === 0) throw new Error(`${d.code}: the minimal input does not raise it (got ${found.map(x => x.code).join(', ') || 'nothing'})`);
      out.set(d.code, mine.map(x => `[axylo ${x.code}] ${JSON.stringify(x.chart)}: ${x.message}`));
    } else {
      const made = registry.createDiagnostic(d.code, d.sample?.effect ?? 'none', d.sample?.details ?? {});
      out.set(d.code, [`[axylo ${d.code}] ${JSON.stringify(d.sample?.chart ?? 'Chart title')}: ${made.message}`]);
    }
  }
  return out;
}

function renderDiagnosticPage(d, ctx) {
  const md = s => markdownToHtml(s, { link: url => pageLink(url, '../') });
  const index = ctx.diagnostics.indexOf(d);
  const prev = ctx.diagnostics[index - 1];
  const next = ctx.diagnostics[index + 1];
  const how = d.run === 'node'
    ? 'Checked with <code>validate()</code> in Node when this site was built; the message above is its output.'
    : 'This code needs a browser to arise. The browser test renders this input and checks that the code is reported; the message above is the registry text for sample details.';
  const body = `<p class="crumb"><a href="../diagnostics.html">Diagnostics</a> › ${d.code}</p>
<h1 id="top">${d.code}: ${escapeHtml(d.title)}</h1>
<p><span class="level level-${d.level}">${escapeHtml(d.level)}</span> ${renderInline(levelText(d.level), url => pageLink(url, '../'))}</p>
<h2 id="what-you-see">What you see</h2>
${md(d.see)}
${codeBlock(ctx.seen.get(d.code).join('\n'), 'text')}
<h2 id="why">Why</h2>
${md(d.why)}
<h2 id="how-to-fix">How to fix it</h2>
${md(d.fix)}
<h2 id="minimal-input">A minimal input that raises it</h2>
${codeBlock(d.input, 'js')}
<p class="small">${how}</p>
<nav class="pager" aria-label="Previous and next code">${prev ? `<a rel="prev" href="${prev.code}.html">← ${prev.code}</a>` : '<span></span>'}${next ? `<a rel="next" href="${next.code}.html">${next.code} →</a>` : ''}</nav>`;
  return layout({ title: `${d.code}: ${d.title}`, body, current: 'diagnostics', base: '../', ctx, sourcePath: `apps/docs/data/diagnostics.mjs` });
}

function levelText(level) {
  if (level === 'error') return 'The chart, or the affected series, cannot be drawn: the chart shows its error state. Printed in every build; thrown by a `strict` chart.';
  if (level === 'warning') return 'Something is not drawn as given; when values were left out or changed, the reader sees a note. Printed in every build; thrown by a `strict` chart when it comes from a call.';
  return 'Advice for the author. Printed in development builds only; never thrown.';
}

// ---------- layout ----------

function layout({ title, body, current, base, ctx, sourcePath }) {
  const links = mobile => nav.map(group => `<li><span class="nav-section">${escapeHtml(group.section)}</span><ul>${group.pages.map(p =>
    `<li><a href="${base}${p.page}.html"${p.page === current ? ' aria-current="page"' : ''}>${escapeHtml(p.label)}</a></li>`).join('')}</ul></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · Axylo</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${base}assets/site.css">
<script src="${base}assets/page.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<a class="brand" href="${base}index.html">Axylo</a><span class="tagline">Documentation for 1.0</span>
</header>
<details class="nav-mobile"><summary>Pages</summary><nav aria-label="Documentation"><ul class="nav-list">${links(true)}</ul></nav></details>
<div class="layout">
<nav class="nav-side" aria-label="Documentation"><ul class="nav-list">${links(false)}</ul></nav>
<main id="main">
<article>
${body}
</article>
<footer class="page-footer"><p>Source of this page: <code>${escapeHtml(sourcePath)}</code>. The live examples run the library's built files (package version ${escapeHtml(ctx.version)}, development flavour).</p></footer>
</main>
</div>
</body>
</html>
`;
}

// ---------- links ----------

/** Every link in the built site resolves: pages and their anchors in dist, other paths in the repository. */
export function checkLinks(outDir) {
  const broken = [];
  const files = [];
  const walk = dir => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.html')) files.push(p);
    }
  };
  walk(outDir);
  const ids = new Map();
  const idsOf = file => {
    if (!ids.has(file)) ids.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
    return ids.get(file);
  };
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const url = m[1].replace(/&amp;/g, '&');
      if (/^[a-z]+:/i.test(url)) continue;
      const [target, hash] = url.split('#');
      const resolved = target === '' ? file : path.resolve(path.dirname(file), decodeURIComponent(target));
      if (!fs.existsSync(resolved)) { broken.push(`${path.relative(outDir, file)} → ${url}`); continue; }
      if (hash && resolved.endsWith('.html') && resolved.startsWith(outDir) && !/^L\d+/.test(hash) && !idsOf(resolved).has(hash)) {
        broken.push(`${path.relative(outDir, file)} → ${url} (no such anchor)`);
      }
    }
  }
  return broken;
}

export { slug };
