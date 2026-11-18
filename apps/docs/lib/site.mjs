/**
 * Builds the documentation site from the Markdown pages, the runnable examples, the diagnostics data file
 * and the packed packages, installed into a consumer of their own (lib/consumer.mjs).
 *
 * - Every example is bundled from the consumer by esbuild under the `development` condition, as an
 *   application would bundle it, and runs in its own page (examples/<name>.html), framed beside its source.
 * - The stylesheet, the script-tag file and `validate()` come from the installed tarball. Two inputs are read
 *   from the library's source because the bundle does not export them (the built-in messages and the
 *   registry's message templates); the build checks that the installed files were built from that source.
 * - Every link stays inside the site: a link to a file of the repository publishes that file as a source page
 *   under source/, with one anchor per line, at the revision the site was built from.
 * - The site is built into a temporary directory, checked (links, anchors, unique ids), and only then
 *   replaces the previous output, so a failed build leaves the last good site in place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { checkHref, codeBlock, escapeHtml, markdownToHtml, renderInline, uniqueId, wordCount } from './markdown.mjs';
import { docsRoot, hostOf, htmlScripts, listExamples, listHelpers, repoRoot, writeConsumerSources } from './examples.mjs';
import { consumerDir, guard, installed, prepareConsumer } from './consumer.mjs';
import { readThemeDefaults } from './theme.mjs';
import { nav, pages } from '../data/nav.mjs';

const pagesDir = path.join(docsRoot, 'pages');
const siteDir = path.join(docsRoot, 'site');
const HEX = /^#[0-9a-f]{3,8}$/i;

/** Generated tables, and the one file each `[table: …](target)` directive must name. */
const TABLES = {
  'diagnostic codes': 'apps/docs/data/diagnostics.mjs',
  'theme tokens': 'apps/docs/data/tokens.mjs',
  'internal tokens': 'apps/docs/data/tokens.mjs',
  messages: 'packages/axylo/src/messages/index.ts',
  palette: 'packages/axylo/src/theme/palette.ts',
};
/** Where `[source: …]` may quote from. */
const SOURCE_ROOTS = ['examples/first-chart/', 'research/harness/src/libs/', 'apps/docs/examples/'];

/** Bundles a TypeScript source of the library and imports it, to read data the built bundle does not export. */
export async function importSource(relative) {
  const { DEVELOPMENT } = await import(pathToFileURL(path.join(repoRoot, 'scripts/build.mjs')).href);
  const result = await build({
    entryPoints: [path.join(repoRoot, relative)], bundle: true, format: 'esm', write: false, platform: 'neutral',
    define: DEVELOPMENT, logLevel: 'silent',
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
}

export { readThemeDefaults };

function gitRevision() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '';
    return { sha, short: sha.slice(0, 7), dirty };
  } catch {
    return { sha: 'unknown', short: 'unknown', dirty: true };
  }
}

/**
 * The installed files and the source the build also reads (the built-in messages and the registry's
 * templates, which the bundle does not export) must be one revision. The check takes what it compares from
 * scripts/build.mjs itself, so it follows the library's build by construction: the stylesheet must equal
 * `stylesheets().minified` (dist/axylo.css is that text), and the development bundle, rebuilt from
 * packages/axylo/src in memory with the build's DEVELOPMENT constants and the options it uses for
 * axylo.dev.js, must equal the installed file byte for byte. Anything else means packages/axylo/dist is older
 * or newer than its source.
 */
async function checkSameRevision(css, bundle) {
  const problems = [];
  const { stylesheets, DEVELOPMENT } = await import(pathToFileURL(path.join(repoRoot, 'scripts/build.mjs')).href);
  const { minified } = await stylesheets();
  if (minified !== css) problems.push('the installed axylo.css differs from the minified packages/axylo/src/theme/css.ts');
  const rebuilt = await build({
    entryPoints: [path.join(repoRoot, 'packages/axylo/src/index.ts')], bundle: true, target: 'es2022', legalComments: 'none',
    logLevel: 'silent', format: 'esm', define: DEVELOPMENT, write: false, outfile: path.join(repoRoot, 'packages/axylo/dist/axylo.dev.js'),
    absWorkingDir: repoRoot,
  });
  if (Buffer.from(rebuilt.outputFiles[0].contents).toString('utf8') !== bundle) {
    problems.push('the installed axylo.dev.js differs from what packages/axylo/src builds to now');
  }
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/axylo/package.json'), 'utf8')).version;
  const shipped = JSON.parse(fs.readFileSync(path.join(installed('axylo'), 'package.json'), 'utf8')).version;
  if (source !== shipped) problems.push(`version ${shipped} installed, ${source} in source`);
  if (problems.length) {
    throw new Error(`The packed library and its source differ (run \`npm run build\`, then build the site again):\n  ${problems.join('\n  ')}`);
  }
  return (await importSource('packages/axylo/src/messages/index.ts')).defaultMessages;
}

export async function buildSite({ outDir = path.join(docsRoot, 'dist'), log = () => {} } = {}) {
  const revision = gitRevision();
  const packed = prepareConsumer({ log });
  const lib = installed('axylo');
  const css = fs.readFileSync(path.join(lib, 'dist/axylo.css'), 'utf8');
  const bundle = fs.readFileSync(path.join(lib, 'dist/axylo.dev.js'), 'utf8');
  const messages = await checkSameRevision(css, bundle);
  const theme = readThemeDefaults(css);

  const tmp = `${outDir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    for (const dir of ['assets', 'examples/js', 'diagnostics', 'source']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    const warnings = [];
    writeAssets(tmp, theme);
    for (const file of ['axylo.iife.js', 'axylo.iife.min.js', 'axylo.css']) fs.copyFileSync(path.join(lib, 'dist', file), path.join(tmp, 'examples', file));
    const examples = await buildExamples(tmp);
    const { diagnostics } = await import(pathToFileURL(path.join(docsRoot, 'data/diagnostics.mjs')).href + `?t=${Date.now()}`);
    const { tokens, internalTokens } = await import(pathToFileURL(path.join(docsRoot, 'data/tokens.mjs')).href + `?t=${Date.now()}`);
    const seen = await diagnosticOutput(diagnostics);
    const version = packed.axylo.version;
    const ctx = { outDir: tmp, examples, diagnostics, seen, tokens, internalTokens, messages, theme, warnings, version, revision, published: new Set() };

    const report = [];
    for (const [index, entry] of pages.entries()) {
      const source = fs.readFileSync(path.join(pagesDir, `${entry.page}.md`), 'utf8');
      fs.writeFileSync(path.join(tmp, `${entry.page}.html`), renderPage(entry, source, index, ctx));
      report.push({ page: entry.page, words: wordCount(source) });
    }
    for (const d of diagnostics) fs.writeFileSync(path.join(tmp, 'diagnostics', `${d.code}.html`), renderDiagnosticPage(d, ctx));
    // Example sources and helpers are linked from every example block; publish them all.
    for (const e of examples) ctx.published.add(e.repoFile);
    for (const helper of listHelpers()) ctx.published.add(`apps/docs/examples/${helper}`);
    for (const file of ctx.published) writeSourcePage(tmp, file, ctx);

    const problems = checkSite(tmp);
    if (problems.length) throw new Error('The site has broken links or duplicate ids:\n' + problems.join('\n'));
    fs.writeFileSync(path.join(tmp, 'build.json'), JSON.stringify({ revision, packed: Object.fromEntries(Object.entries(packed).map(([n, p]) => [n, { tarball: p.tarball, integrity: p.integrity }])), examples }, null, 1));

    // Replace the previous site only now.
    const old = `${outDir}.old-${process.pid}`;
    if (fs.existsSync(outDir)) fs.renameSync(outDir, old);
    fs.renameSync(tmp, outDir);
    fs.rmSync(old, { recursive: true, force: true });
    for (const w of warnings) log('warning: ' + w);
    return { pages: report, examples, warnings, diagnostics: diagnostics.length, published: ctx.published.size, revision };
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
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
  const tokens = `/* Generated from the packed axylo.css by apps/docs/lib/site.mjs. */
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
}

// ---------- examples ----------

/**
 * Bundles every example from the consumer, resolving the installed tarball under the `development`
 * condition, with shared chunks, and writes one page
 * per example. Nothing may resolve outside the consumer.
 */
async function buildExamples(outDir) {
  const examples = listExamples();
  const { src } = writeConsumerSources(consumerDir);
  const entries = [];
  for (const e of examples) {
    if (e.ext !== 'html') entries.push(path.join(src, `${e.name}.${e.ext}`));
    else for (const s of htmlScripts(e).filter(s => s.kind === 'module')) entries.push(path.join(src, s.file));
  }
  await build({
    entryPoints: entries, bundle: true, format: 'esm', splitting: true, target: 'es2022', outdir: path.join(outDir, 'examples/js'),
    conditions: ['development'], logLevel: 'warning',
    absWorkingDir: consumerDir, plugins: [guard()], entryNames: '[name]', chunkNames: 'chunk-[hash]',
  });
  const manifest = [];
  for (const e of examples) {
    fs.writeFileSync(path.join(outDir, 'examples', `${e.name}.html`), examplePage(e));
    manifest.push({ name: e.name, file: e.file, repoFile: e.repoFile, ext: e.ext, raises: e.raises, noMarks: e.noMarks, targets: e.targets });
  }
  fs.writeFileSync(path.join(outDir, 'examples/manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function examplePage(e) {
  let body;
  let styles = '';
  if (e.documentPage) {
    // The snippet's own page, with the CDN files answered by the same files from the packed package.
    const page = e.source
      .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/axylo\/dist\/(axylo\.(?:css|iife\.min\.js|iife\.js))/g, '$1')
      .replace(/<link rel="stylesheet"/, '<link rel="icon" href="data:,">\n<link rel="stylesheet" href="../assets/site.css">\n<link rel="stylesheet"');
    if (/https?:\/\//.test(page)) throw new Error(`${e.repoFile}: a URL this site cannot serve remains in the page`);
    return `${page.replace(/\n?$/, '\n')}<script src="../assets/frame.js" defer></script>\n`;
  }
  if (e.ext === 'html') {
    // The example's own <style> goes to the head, where it belongs; each module script becomes its bundle.
    styles = [...e.source.matchAll(/<style>[\s\S]*?<\/style>\n?/g)].map(m => m[0]).join('');
    body = e.source.replace(/<style>[\s\S]*?<\/style>\n?/g, '');
    for (const s of htmlScripts(e).filter(s => s.kind === 'module')) {
      body = body.replace(s.match, `<script type="module" src="js/${escapeHtml(s.file)}"></script>`);
    }
  } else {
    body = e.targets.map(id => `<div id="${escapeHtml(id)}" class="example-target"></div>`).join('\n') +
      `\n<script type="module" src="js/${e.name}.js"></script>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Example: ${escapeHtml(e.name)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="../assets/site.css">
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
  const ids = reservedIds();
  const where = path.join(pagesDir, `${entry.page}.md`);
  const body = markdownToHtml(source, {
    headings, ids,
    link: url => pageLink(url, where, '', ctx),
    directive: d => directive(d, where, ctx, ids),
  });
  const title = headings.find(h => h.level === 1)?.text ?? entry.label;
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const pager = `<nav class="pager" aria-label="Previous and next page">${prev ? `<a rel="prev" href="${prev.page}.html">← ${escapeHtml(prev.label)}</a>` : '<span></span>'}${next ? `<a rel="next" href="${next.page}.html">${escapeHtml(next.label)} →</a>` : ''}</nav>`;
  return layout({ title, body: body + pager, current: entry.page, base: '', ctx, sourceFile: `apps/docs/pages/${entry.page}.md` });
}

/** Ids the layout itself uses, reserved before a page's headings get theirs. */
const reservedIds = () => new Set(['main']);

const PAGE_NAMES = new Set(pages.map(p => p.page));

/**
 * Rewrites a link written for the Markdown sources (readable on a code host) to its place in the site.
 * `from` is the file the link is written in; `base` is the path from the page being built to the site root.
 * A link to any other file of the repository publishes that file as a source page.
 */
export function pageLink(url, from, base, ctx) {
  checkHref(url);
  if (/^(https|mailto):/i.test(url) || url.startsWith('#')) return url;
  const [file, hash] = url.split('#');
  if (file === 'diagnostics.md' && hash && /^ax\d{3}$/i.test(hash)) return `${base}diagnostics/${hash.toUpperCase()}.html`;
  const name = file.endsWith('.md') && !file.includes('/') ? file.slice(0, -3) : null;
  if (name !== null && PAGE_NAMES.has(name)) return `${base}${name}.html${hash ? '#' + hash : ''}`;
  const absolute = path.resolve(path.dirname(from), file);
  const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${path.relative(repoRoot, from)}: link ${url} leaves the repository`);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) throw new Error(`${path.relative(repoRoot, from)}: link ${url} names no file`);
  ctx.published.add(relative);
  const line = hash && /^L(\d+)(?:-L\d+)?$/.exec(hash);
  if (hash && !line) throw new Error(`${path.relative(repoRoot, from)}: link ${url}: only line anchors (#L12, #L12-L20) are kept on source pages`);
  return `${base}${sourcePath(relative)}${line ? `#L${line[1]}` : ''}`;
}

const sourcePath = relative => `source/${relative}.html`;

function directive({ kind, name, target }, where, ctx, ids) {
  if (kind === 'example') return exampleBlock(name, target, where, ctx, ids);
  if (kind === 'source') return sourceBlock(name, target, where, ctx);
  if (kind === 'table') return generatedTable(name, target, where, ctx);
  throw new Error(`Unknown directive ${kind}`);
}

function repoPath(where, target) {
  return path.relative(repoRoot, path.resolve(path.dirname(where), target)).split(path.sep).join('/');
}

function listText(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function exampleBlock(name, target, where, ctx, ids) {
  const relative = repoPath(where, target);
  const example = ctx.examples.find(e => e.repoFile === relative);
  if (!example) throw new Error(`${path.relative(repoRoot, where)}: example ${target} does not exist`);
  if (example.name !== name) throw new Error(`${path.relative(repoRoot, where)}: example link text "${name}" does not match ${example.file}`);
  const full = listExamples().find(e => e.name === example.name);
  const raises = example.raises.length
    ? `<p class="example-note">This example raises ${listText(example.raises.map(c => `<a href="diagnostics/${c}.html">${c}</a>`))} on purpose.</p>`
    : '';
  const host = hostOf(full);
  const helpers = full.helpers.map(h => `<a href="${sourcePath(`apps/docs/examples/${h}`)}">examples/${escapeHtml(h)}</a>`);
  const hostBlock = `<div class="example-host"><p><strong>To run it yourself:</strong> ${renderInline(host.text)}${helpers.length ? ` It also imports ${listText(helpers)}, the shared fixture, which must sit beside it.` : ''}</p>${host.markup ? codeBlock(host.markup, 'html') : ''}</div>`;
  const id = uniqueId(`example-${example.name}`, ids);
  const height = example.ext === 'ts' ? example.targets.length * 470 : 470;
  return `<figure class="example" id="${escapeHtml(id)}">
<div class="example-live"><iframe src="examples/${escapeHtml(example.name)}.html" title="Live example: ${escapeHtml(example.name)}" loading="lazy" style="height: ${height}px"></iframe></div>
${raises}<figcaption><span>Source</span> <a href="${sourcePath(relative)}">${escapeHtml(relative.replace(/^apps\/docs\//, ''))}</a> · <a href="examples/${escapeHtml(example.name)}.html">open on its own</a></figcaption>
${codeBlock(full.source, example.ext)}
${hostBlock}
</figure>`;
}

function sourceBlock(label, target, where, ctx) {
  const [file, range] = target.split('#');
  const relative = repoPath(where, file);
  if (!SOURCE_ROOTS.some(root => relative.startsWith(root))) throw new Error(`${path.relative(repoRoot, where)}: [source:] may only quote ${SOURCE_ROOTS.join(', ')}; not ${relative}`);
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) throw new Error(`${path.relative(repoRoot, where)}: quoted file ${relative} does not exist`);
  let text = fs.readFileSync(absolute, 'utf8').replace(/\n$/, '');
  const lines = range && /^L(\d+)-L(\d+)$/.exec(range);
  if (range && !lines) throw new Error(`${path.relative(repoRoot, where)}: bad line range ${range}`);
  if (lines) {
    const all = text.split('\n');
    const [from, to] = [Number(lines[1]), Number(lines[2])];
    if (from < 1 || to > all.length || from > to) throw new Error(`${path.relative(repoRoot, where)}: ${relative} has no lines ${from}–${to}`);
    text = all.slice(from - 1, to).join('\n');
  }
  ctx.published.add(relative);
  const ext = path.extname(file).slice(1);
  const named = label === relative || label === file ? '' : `${escapeHtml(label)} · `;
  return `<figure class="source"><figcaption>${named}<a href="${sourcePath(relative)}${lines ? `#L${lines[1]}` : ''}">${escapeHtml(relative)}${lines ? `, lines ${lines[1]}–${lines[2]}` : ''}</a></figcaption>${codeBlock(text, ext)}</figure>`;
}

function generatedTable(name, target, where, ctx) {
  const expected = TABLES[name];
  if (!expected) throw new Error(`${path.relative(repoRoot, where)}: unknown generated table "${name}"`);
  const relative = repoPath(where, target);
  if (relative !== expected) throw new Error(`${path.relative(repoRoot, where)}: table "${name}" is generated from ${expected}, not ${relative}`);
  ctx.published.add(relative);
  const table = name === 'diagnostic codes' ? diagnosticsTable(ctx)
    : name === 'theme tokens' ? tokensTable(ctx)
      : name === 'internal tokens' ? internalTokensTable(ctx)
        : name === 'messages' ? messagesTable(ctx)
          : paletteTable(ctx);
  const from = name === 'palette' || name === 'theme tokens'
    ? ` Colours read from the packed <code>axylo/axylo.css</code>.` : '';
  return `${table}<p class="small">Generated from <a href="${sourcePath(relative)}">${escapeHtml(relative)}</a>.${from}</p>`;
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
  if (!HEX.test(value)) throw new Error(`not a hex colour: ${value}`);
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
  if (rows.length === 0) throw new Error('axylo.css: no series colours');
  return htmlTable(['Slot', 'Light', 'Dark'], rows, 'Default palette');
}

// ---------- diagnostics ----------

/**
 * What each code's minimal input prints. Inputs that run in Node go through the installed package's
 * `validate()`, so the page shows the message exactly as the library writes it; the others need a page
 * (contrast, size, labels, formatters, appends) and show the registry's message for the sample details in
 * the data file, which the browser test compares with what the page prints.
 */
async function diagnosticOutput(diagnostics) {
  const lib = await import(pathToFileURL(path.join(installed('axylo'), 'dist/axylo.js')).href);
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
  const where = path.join(docsRoot, 'data/diagnostics.mjs');
  const ids = reservedIds();
  const md = s => markdownToHtml(s, { ids, link: url => pageLink(url, path.join(pagesDir, 'x.md'), '../', ctx) });
  const index = ctx.diagnostics.indexOf(d);
  const prev = ctx.diagnostics[index - 1];
  const next = ctx.diagnostics[index + 1];
  const how = d.run === 'node'
    ? 'Checked with <code>validate()</code> from the packed package when this site was built; the message above is its output.'
    : 'This code needs a page to arise. The documentation\'s browser test renders this input and checks the code, the field and what the reader sees; the message above is the registry text for sample details.';
  for (const id of ['top', 'what-you-see', 'why', 'how-to-fix', 'minimal-input']) ids.add(id);
  const body = `<p class="crumb"><a href="../diagnostics.html">Diagnostics</a> › ${d.code}</p>
<h1 id="top">${d.code}: ${escapeHtml(d.title)}</h1>
<p><span class="level level-${d.level}">${escapeHtml(d.level)}</span> ${renderInline(levelText(d.level))}</p>
<h2 id="what-you-see">What you see</h2>
${md(d.see)}
${codeBlock(ctx.seen.get(d.code).join('\n'), 'text')}
<h2 id="why">Why</h2>
${md(d.why)}
<h2 id="how-to-fix">How to fix it</h2>
${md(d.fix)}
<h2 id="minimal-input">A minimal input that raises it</h2>
${codeBlock(d.input, 'js')}
${outcomeTable(d)}
<p class="small">${how}</p>
<nav class="pager" aria-label="Previous and next code">${prev ? `<a rel="prev" href="${prev.code}.html">← ${prev.code}</a>` : '<span></span>'}${next ? `<a rel="next" href="${next.code}.html">${next.code} →</a>` : ''}</nav>`;
  void where;
  return layout({ title: `${d.code}: ${d.title}`, body, current: 'diagnostics', base: '../', ctx, sourceFile: 'apps/docs/data/diagnostics.mjs' });
}

/** The checked facts of the minimal input: the same ones the tests assert. */
function outcomeTable(d) {
  const o = d.outcome;
  const reader = o.reader === 'nothing' ? 'No note and no message: the chart as drawn.'
    : o.reader === 'fallback' ? 'The title, a short summary and the table control, in place of the plot.'
      : o.reader.startsWith('note: ') ? `The note “${escapeHtml(o.reader.slice(6))}” in the figure.`
        : o.reader.startsWith('message: ') ? `“${escapeHtml(o.reader.slice(9))}” in place of the plot.`
          : missingReader(d.code);
  const rows = [
    ['Why it raises the code', renderInline(o.because)],
    ['Field', o.field === null ? 'None: it is about the chart as a whole.' : `<code>${escapeHtml(o.field)}</code>`],
    ...(o.rows ? [['Rows', o.rows.join(', ')]] : []),
    ['Reader sees', reader],
    ['A strict chart', o.strict ? 'Throws, from the call that gave this input.' : 'Does not throw.'],
  ];
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="What the minimal input does"><table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`;
}

function missingReader(code) {
  throw new Error(`${code}: outcome.reader must be nothing, fallback, note: … or message: …`);
}

function levelText(level) {
  if (level === 'error') return 'Something cannot be drawn as given: the chart, a series, or the donut. Printed in every build.';
  if (level === 'warning') return 'Something is not drawn as given, or an option is ignored. Printed in every build.';
  return 'Advice for the author; the chart is drawn as given unless this page says otherwise. Printed in development builds only.';
}

// ---------- source pages ----------

function writeSourcePage(outDir, relative, ctx) {
  const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\n$/, '');
  const depth = relative.split('/').length; // source/<relative>.html
  const base = '../'.repeat(depth);
  const numbered = text.split('\n').map((line, i) => `<span class="line" id="L${i + 1}">${escapeHtml(line)}\n</span>`).join('');
  const at = ctx.revision.dirty ? `revision ${ctx.revision.short} with uncommitted changes` : `revision ${ctx.revision.short}`;
  const body = `<p class="crumb">Repository file, as it was at ${escapeHtml(at)} when this site was built</p>
<h1 id="top" class="source-title"><code>${escapeHtml(relative)}</code></h1>
<pre class="source-file" tabindex="0"><code>${numbered}</code></pre>`;
  const file = path.join(outDir, sourcePath(relative));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, layout({ title: relative, body, current: null, base, ctx, sourceFile: relative }));
}

// ---------- layout ----------

function layout({ title, body, current, base, ctx, sourceFile }) {
  const links = () => nav.map(group => `<li><span class="nav-section">${escapeHtml(group.section)}</span><ul>${group.pages.map(p =>
    `<li><a href="${base}${p.page}.html"${p.page === current ? ' aria-current="page"' : ''}>${escapeHtml(p.label)}</a></li>`).join('')}</ul></li>`).join('');
  const at = ctx.revision.dirty ? `${ctx.revision.short} with uncommitted changes` : ctx.revision.short;
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
<details class="nav-mobile"><summary>Pages</summary><nav aria-label="Documentation"><ul class="nav-list">${links()}</ul></nav></details>
<div class="layout">
<nav class="nav-side" aria-label="Documentation"><ul class="nav-list">${links()}</ul></nav>
<main id="main">
<article>
${body}
</article>
<footer class="page-footer"><p>Source of this page: <code>${escapeHtml(sourceFile)}</code>. Built from revision ${escapeHtml(at)}. The live examples run the packed packages (version ${escapeHtml(ctx.version)}, development condition), installed into a clean consumer.</p></footer>
</main>
</div>
</body>
</html>
`;
}

// ---------- checks ----------

/**
 * Every link in the built site resolves inside it (the deployment root): pages, their anchors (line anchors
 * of source pages included), assets and example pages. No page has two elements with the same id.
 */
export function checkSite(outDir) {
  const problems = [];
  const files = [];
  const walk = dir => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.html')) files.push(p);
    }
  };
  walk(outDir);
  const idsCache = new Map();
  const idsOf = file => {
    if (!idsCache.has(file)) idsCache.set(file, [...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    return idsCache.get(file);
  };
  for (const file of files) {
    const ids = idsOf(file);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) problems.push(`${path.relative(outDir, file)}: duplicate ids ${[...new Set(dup)].join(', ')}`);
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const url = m[1].replace(/&amp;/g, '&');
      if (/^(https:|mailto:|data:)/i.test(url)) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) { problems.push(`${path.relative(outDir, file)} → ${url} (scheme not allowed)`); continue; }
      const [target, hash] = url.split('#');
      const resolved = target === '' ? file : path.resolve(path.dirname(file), decodeURIComponent(target));
      if (!resolved.startsWith(outDir + path.sep)) { problems.push(`${path.relative(outDir, file)} → ${url} (outside the site)`); continue; }
      if (!fs.existsSync(resolved)) { problems.push(`${path.relative(outDir, file)} → ${url}`); continue; }
      if (hash && resolved.endsWith('.html') && !idsOf(resolved).includes(hash)) problems.push(`${path.relative(outDir, file)} → ${url} (no such anchor)`);
    }
  }
  return problems;
}
