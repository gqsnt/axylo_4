/**
 * The data of the conformance page (spec A9), read when the site is built, so the page cannot say more than
 * its sources do:
 *
 * - which WCAG 2.2 success criteria the specification cites, and in which of its criterion rows
 *   (docs/02-product-spec.md; a row cites "WCAG 2.5.1, 2.5.7" in its last column, spec A9);
 * - what the acceptance checker reports for those rows: `check()` of acceptance/check.mjs, in release mode,
 *   over the result files acceptance/run.mjs writes (acceptance/results/<config>[-<engine>].json, named by
 *   provenance.mjs), so a result counts only when its recorded provenance matches the working tree;
 * - which engine each result came from: the checker's record of each report, or for a result that predates
 *   the engine record, the engine its default result file runs on (provenance.mjs `resultFiles()`).
 *
 * Nothing here judges evidence: a criterion without a counted result is "not recorded", and when the checker
 * refuses its matrix nothing is counted at all. Checker output this module cannot read stops the build,
 * rather than being shown as something it is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { splitRow } from './markdown.mjs';
import { wcag } from '../data/wcag.mjs';
import { check, CHART_TYPES, STATUSES } from '../../../acceptance/check.mjs';
import { ENGINES, engineLabel, resultFiles as defaultResultFiles } from '../../../acceptance/provenance.mjs';

const SC = /\d\.\d{1,2}\.\d{1,2}\b/g;
/**
 * What a report can say of the tests it answered: their results, or 'not recorded' when its provenance is
 * another tree or pack, which the checker gives only with a `provenanceError` (README, "Reading the checker").
 */
const RESULTS = ['pass', 'fail', 'skipped', 'not recorded'];

const bySc = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * Success criterion → the specification's rows that cite it, each with its criterion text (Markdown). A row
 * cites "WCAG x.y.z" in its last column (spec A9); a mention elsewhere in the row is not a citation.
 */
export function citedCriteria(spec) {
  const cited = new Map();
  for (const line of spec.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = splitRow(line);
    const id = cells[0].replace(/[*_`]/g, '');
    if (!/^[A-Z]+\d+$/.test(id)) continue;
    for (const cell of cells.slice(-1)) {
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

const unreadable = what => { throw new Error(`acceptance checker: output this page cannot read: ${what}`); };

/**
 * The checker's `rows` → row id → { statement, cells: { chartType: { status, reports } } }, each report with
 * the engine it ran on (`engineOf` names it for a report the checker could not: results older than the engine
 * record), whether it counts for this revision, and the commit it was recorded at. Anything outside the
 * checker's documented shape stops the build.
 */
export function readRows(rows, { engineOf = () => null, commitOf = () => null } = {}) {
  if (!Array.isArray(rows)) unreadable('rows is not a list');
  const out = new Map();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || typeof row.statement !== 'string' || row.cells === null || typeof row.cells !== 'object') unreadable(JSON.stringify(row)?.slice(0, 80));
    const types = Object.keys(row.cells);
    if (types.length !== CHART_TYPES.length || types.some((type, i) => type !== CHART_TYPES[i])) unreadable(`${row.id}: chart types ${types.join(', ')}`);
    const cells = {};
    for (const type of types) {
      const cell = row.cells[type];
      if (!STATUSES.includes(cell?.status) || !Array.isArray(cell.reports)) unreadable(`${row.id}/${type}: status ${cell?.status}`);
      cells[type] = {
        status: cell.status,
        reports: cell.reports.map(report => {
          if (typeof report?.file !== 'string' || !['run', 'size'].includes(report.source) || !Array.isArray(report.results)
            || report.results.some(r => !RESULTS.includes(r)) || !(report.engine === null || ENGINES.includes(report.engine))
            || !(report.provenanceError === null || typeof report.provenanceError === 'string')
            || (report.results.includes('not recorded') && report.provenanceError === null)) {
            unreadable(`${row.id}/${type}: report ${JSON.stringify(report)?.slice(0, 160)}`);
          }
          return {
            file: report.file, source: report.source, results: report.results,
            engine: report.source === 'size' ? null : report.engine ?? engineOf(report.file),
            counted: report.provenanceError === null, why: report.provenanceError, commit: commitOf(report.file),
          };
        }),
      };
    }
    out.set(row.id, { statement: row.statement, cells });
  }
  return out;
}

const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Runs the checker on `root` (the repository; a test passes the checker's own fixtures). Returns what it
 * reported, or its refusal: `refused` holds its error lines, and then no row has a status. `files` are the
 * result files given, with what their sidecars record. By default the result files are acceptance/run.mjs's
 * default ones that exist under `root`.
 */
export async function readChecker({ root, matrixFile = path.join(root, 'acceptance/matrix.json'), resultFiles, packIntegrity, sizeTargets } = {}) {
  const defaults = defaultResultFiles();
  const engineOf = file => defaults.find(d => d.file === file)?.engine ?? null;
  const given = resultFiles ?? defaults.map(d => path.join(root, d.file));
  const present = given.filter(file => fs.existsSync(file)).map(file => path.relative(root, file).split(path.sep).join('/'));
  const files = present.map(file => {
    const sidecar = path.join(root, file.replace(/\.json$/, '.provenance.json'));
    const provenance = fs.existsSync(sidecar) ? json(sidecar) : null;
    return { file, provenance, engine: provenance?.engine ?? engineOf(file) };
  });
  const label = engine => engine === null ? 'Node' : engineLabel(engine);
  let result;
  try {
    // The checker packs the tree once (npm pack --dry-run) when the matrix cites a size record; a test names the
    // pack and the targets itself (check()'s `packIntegrity` and `sizeTargets`).
    const extra = { ...(packIntegrity === undefined ? {} : { packIntegrity }), ...(sizeTargets === undefined ? {} : { sizeTargets }) };
    result = check({ root, matrixFile, resultFiles: present.map(file => path.join(root, file)), release: true, ...extra });
  } catch (error) {
    return { refused: String(error.message).split('\n').filter(Boolean), rows: new Map(), citations: new Map(), files, label, warnings: [] };
  }
  const commitOf = file => files.find(f => f.file === file)?.provenance?.commit ?? null;
  const rows = readRows(result.rows, { engineOf, commitOf });
  if (!Array.isArray(result.warnings) || result.warnings.some(w => typeof w !== 'string')) unreadable('warnings is not a list of text');
  for (const run of result.runs) {
    const file = path.relative(root, run.file).split(path.sep).join('/');
    const known = files.find(f => f.file === file);
    if (known) Object.assign(known, { engine: run.engine ?? known.engine, counted: !run.provenanceError, why: run.provenanceError ?? null });
  }
  // The tests each row cites, once the checker has accepted the matrix (so every citation names a real test).
  const citations = new Map();
  for (const row of json(matrixFile)) {
    const seen = new Map();
    for (const refs of Object.values(row.evidence ?? {})) for (const ref of refs) {
      const test = ref.title ?? (ref.prefix ? `${ref.prefix}…${ref.atLeast ? ` (at least ${ref.atLeast} cases)` : ''}` : null);
      const entry = { kind: ref.kind, file: ref.file, test, engine: ref.kind === 'browser' ? ref.engine ?? 'chromium' : null };
      seen.set(JSON.stringify(entry), entry);
    }
    citations.set(row.id, [...seen.values()]);
  }
  return { refused: null, rows, citations, files, label, warnings: result.warnings };
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
        if (!report.counted) stale = true;
        // A size measurement is no engine's: it counts in the checker's verdict only.
        if (report.source === 'size') continue;
        const bucket = seen.get(String(report.engine));
        if (report.counted) for (const value of report.results) bucket.results.add(value);
        else bucket.stale.add(report.commit ? report.commit.slice(0, 7) : 'unknown');
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
  return { criteria, checker, uncited: uncited(cited).map(sc => {
    const [name, level, kind, why] = wcag[sc];
    if (!kind || !why) throw new Error(`apps/docs/data/wcag.mjs: WCAG ${sc} is cited by no row of the specification and needs a reason (spec A9)`);
    return { sc, name, level, kind, why };
  }) };
}
