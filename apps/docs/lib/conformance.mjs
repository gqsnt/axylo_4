/**
 * The data of the conformance page (spec A9), read when the site is built, so the page cannot say more than
 * its sources do:
 *
 * - which WCAG 2.2 success criteria the specification cites, and in which of its criterion rows
 *   (docs/02-product-spec.md; a row cites "WCAG 2.5.1, 2.5.7" in any of its cells);
 * - what the acceptance checker reports for those rows: `check()` of acceptance/check.mjs, in release mode,
 *   over the result files acceptance/run.mjs writes (acceptance/results/<config>[-<engine>].json, named by
 *   provenance.mjs), so a result counts only when its recorded provenance matches the working tree;
 * - which engine each result came from: the checker's own record of each run.
 *
 * Nothing here judges evidence: a criterion without a counted result is "not recorded", and when the checker
 * refuses its matrix nothing is counted at all. Output of the checker that this module cannot read stops the
 * build, rather than being shown as something it is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitRow } from './markdown.mjs';
import { wcag } from '../data/wcag.mjs';
import { repoRoot } from './examples.mjs';

/** acceptance/run.mjs's configurations; only `browser` runs on more than one engine. */
const CONFIGS = ['unit', 'browser', 'dist', 'dist-browser'];
/** The checker's cell statuses (acceptance/check.mjs), longest first so a prefix never wins. */
const STATUSES = ['cannot be verified here', 'not applicable', 'no evidence', 'not run', 'pass', 'fail', 'weak'];
const SC = /\d\.\d{1,2}\.\d{1,2}\b/g;

const bySc = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** Success criterion → the specification's rows that cite it, each with its criterion text (Markdown). */
export function citedCriteria(spec) {
  const cited = new Map();
  for (const line of spec.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = splitRow(line);
    const id = cells[0].replace(/[*_`]/g, '');
    if (!/^[A-Z]+\d+$/.test(id)) continue;
    for (const cell of cells.slice(1)) {
      for (const m of cell.matchAll(/WCAG((?:[\s,]+(?:and\s+)?\d\.\d{1,2}\.\d{1,2}\b)+)/g)) {
        for (const sc of m[1].match(SC)) {
          if (!wcag[sc]) throw new Error(`docs/02-product-spec.md, ${id}: WCAG ${sc} is not a level A or AA criterion of WCAG 2.2 (apps/docs/data/wcag.mjs)`);
          if (!cited.has(sc)) cited.set(sc, []);
          if (!cited.get(sc).some(row => row.id === id)) cited.get(sc).push({ id, criterion: cells[1] });
        }
      }
    }
  }
  return new Map([...cited].sort(([a], [b]) => bySc(a, b)));
}

/** One cell of the checker's table: "pass (unit.json pass, browser.json pass/fail)". */
export function parseCell(text) {
  const status = STATUSES.find(s => text === s || text.startsWith(`${s} (`));
  if (!status || (text !== status && !text.endsWith(')'))) throw new Error(`acceptance checker: a cell this page cannot read: "${text}"`);
  const inner = text === status ? '' : text.slice(status.length + 2, -1);
  const reports = inner === '' ? [] : inner.split(', ').map(item => {
    const m = /^(.+) ((?:pass|fail|skipped)(?:\/(?:pass|fail|skipped))*)$/.exec(item);
    if (!m) throw new Error(`acceptance checker: a report this page cannot read: "${item}" in "${text}"`);
    return { label: m[1], results: m[2].split('/') };
  });
  return { status, reports };
}

/** The checker's Markdown table → row id → { statement, cells: { chartType: { status, reports } } }. */
export function parseTable(table) {
  const lines = table.split('\n');
  const unescape = cell => cell.replace(/\\\|/g, '|');
  const header = splitRow(lines[0]).map(unescape);
  if (header[0] !== 'Criterion' || header[1] !== 'Statement' || header.length < 3) throw new Error('acceptance checker: an unexpected table header');
  const types = header.slice(2);
  const rows = new Map();
  for (const line of lines.slice(2)) {
    const cells = splitRow(line).map(unescape);
    if (cells.length !== header.length) throw new Error(`acceptance checker: a row with ${cells.length} cells: ${line.slice(0, 80)}`);
    rows.set(cells[0], { statement: cells[1], cells: Object.fromEntries(types.map((type, i) => [type, parseCell(cells[i + 2])])) });
  }
  return { types, rows };
}

const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Runs the checker on `root` (the repository; a test passes the checker's own fixtures). Returns what it
 * reported, or its refusal: `refused` holds its error lines, and then no row has a status. `files` are the
 * result files given, with what their sidecars record. By default the result files are those of
 * acceptance/run.mjs that exist under `root`.
 */
export async function readChecker({ root, matrixFile = path.join(root, 'acceptance/matrix.json'), resultFiles } = {}) {
  const acceptance = file => pathToFileURL(path.join(repoRoot, 'acceptance', file)).href;
  const { check } = await import(acceptance('check.mjs'));
  const { ENGINES, defaultResultFile, engineLabel } = await import(acceptance('provenance.mjs'));
  const names = resultFiles ?? CONFIGS.flatMap(name => name === 'browser' ? ENGINES.map(engine => defaultResultFile(name, engine)) : [defaultResultFile(name)])
    .map(file => path.join(root, file));
  const present = names.filter(file => fs.existsSync(file)).map(file => path.relative(root, file).split(path.sep).join('/'));
  const files = present.map(file => {
    const sidecar = path.join(root, file.replace(/\.json$/, '.provenance.json'));
    const provenance = fs.existsSync(sidecar) ? json(sidecar) : null;
    // run.mjs's browser configurations launch a browser; Chrome unless the sidecar names another engine.
    const browser = /(?:^|\/)(?:dist-)?browser(?:-\w+)?\.json$/.test(file);
    return { file, provenance, engine: provenance?.engine ?? (browser ? 'chromium' : null) };
  });
  const label = engine => engine === null ? 'Node' : engineLabel(engine);
  let result;
  try {
    result = check({ root, matrixFile, resultFiles: present.map(file => path.join(root, file)), release: true });
  } catch (error) {
    return { refused: String(error.message).split('\n').filter(Boolean), types: [], rows: new Map(), runs: new Map(), citations: new Map(), files, label };
  }
  const { types, rows } = parseTable(result.table);
  // The tests each row cites, once the checker has accepted the matrix (so every citation names a real test).
  const citations = new Map();
  for (const row of json(matrixFile)) {
    const seen = new Map();
    for (const refs of Object.values(row.evidence ?? {})) for (const ref of refs) {
      const test = ref.title ?? (ref.prefix ? `${ref.prefix}…` : null);
      const entry = { kind: ref.kind, file: ref.file, test, engine: ref.kind === 'browser' ? ref.engine ?? 'chromium' : null };
      seen.set(JSON.stringify(entry), entry);
    }
    citations.set(row.id, [...seen.values()]);
  }
  // A cell names a report by its file's base name, or by its path from the root when two share a name.
  const runs = new Map();
  for (const run of result.runs) {
    const relative = path.relative(root, run.file).split(path.sep).join('/');
    const known = files.find(f => f.file === relative);
    const entry = { file: relative, engine: run.engine ?? known?.engine ?? null, commit: run.provenance?.commit ?? null, counted: !run.provenanceError, why: run.provenanceError ?? null };
    runs.set(path.basename(run.file), entry);
    runs.set(relative, entry);
    if (known) Object.assign(known, { counted: entry.counted, why: entry.why });
  }
  return { refused: null, types, rows, runs, citations, files, label };
}

/**
 * For one criterion: the checker's verdict over the specification rows that cite it, and what each engine's
 * results said, for this revision only. Every answer is the checker's or "not recorded".
 */
export function evidenceFor(rows, checker) {
  const engines = ['chromium', 'firefox', 'webkit', null];
  const empty = Object.fromEntries(engines.map(engine => [String(engine), 'not recorded']));
  if (checker.refused) return { verdict: rows.map(row => ({ id: row.id, text: 'not recorded' })), engines: empty };
  const verdict = [];
  const seen = new Map(engines.map(engine => [String(engine), { results: new Set(), stale: new Set() }]));
  for (const { id } of rows) {
    const row = checker.rows.get(id);
    if (!row) {
      verdict.push({ id, text: 'not recorded' });
      continue;
    }
    const groups = new Map();
    let stale = false;
    for (const [type, cell] of Object.entries(row.cells)) {
      if (!groups.has(cell.status)) groups.set(cell.status, []);
      groups.get(cell.status).push(type);
      if (cell.status === 'not applicable') continue;
      for (const report of cell.reports) {
        const run = checker.runs.get(report.label);
        if (!run) throw new Error(`acceptance checker: ${id}/${type} cites a report it did not list: ${report.label}`);
        const bucket = seen.get(String(run.engine));
        if (!bucket) throw new Error(`acceptance checker: ${report.label} ran on an engine this page does not know: ${run.engine}`);
        if (run.counted) for (const value of report.results) bucket.results.add(value);
        else {
          bucket.stale.add(run.commit ? run.commit.slice(0, 7) : 'unknown');
          stale = true;
        }
      }
    }
    verdict.push({
      id,
      text: stale ? 'not recorded for this revision' : [...groups].map(([status, types]) => `${status} (${types.join(', ')})`).join('; '),
    });
  }
  const say = ({ results, stale }) => results.size ? [...results].sort().join('/')
    : stale.size ? `not recorded for this revision (results from ${[...stale].join(', ')})` : 'not recorded';
  return { verdict, engines: Object.fromEntries([...seen].map(([engine, bucket]) => [engine, say(bucket)])) };
}

/** The level A and AA criteria the specification does not cite. */
export function uncited(cited) {
  return Object.keys(wcag).filter(sc => !cited.has(sc)).sort(bySc);
}

export async function readConformance({ root }) {
  const spec = fs.readFileSync(path.join(root, 'docs/02-product-spec.md'), 'utf8');
  const cited = citedCriteria(spec);
  const checker = await readChecker({ root });
  const criteria = [...cited].map(([sc, rows]) => ({
    sc, name: wcag[sc][0], level: wcag[sc][1], rows, ...evidenceFor(rows, checker),
    tests: rows.flatMap(row => checker.citations.get(row.id) ?? []).filter((t, i, all) => all.findIndex(u => JSON.stringify(u) === JSON.stringify(t)) === i),
  }));
  return { criteria, checker, uncited: uncited(cited).map(sc => ({ sc, name: wcag[sc][0], level: wcag[sc][1] })) };
}
