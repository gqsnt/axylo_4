import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citedTestFiles, declaredEngines, engineLabel, ENGINES, hashFile, packIntegrity, snapshot } from './provenance.mjs';
import { exceeds, SIZE_TARGETS } from '../scripts/size.mjs';
import { matchesTemplate, readTitles } from './titles.mjs';

const chartTypes = ['line', 'area', 'bar', 'scatter', 'donut', 'compact'];
const statuses = ['pass', 'fail', 'weak', 'no evidence', 'not run', 'not recorded for this revision', 'cannot be verified here', 'not applicable'];
const STALE = 'not recorded for this revision';
/** Vitest's browser test files: the only ones a `browser` citation can name, and the ones a Node citation cannot. */
const browserFile = file => /\.browser\.test\.[cm]?[jt]sx?$/.test(file);
/** The matrix's chart types, in column order, and every status a cell can have (README's table). */
export const CHART_TYPES = Object.freeze([...chartTypes]);
export const STATUSES = Object.freeze([...statuses]);
const testKinds = ['unit', 'property', 'browser'];
const otherKinds = ['benchmark', 'size', 'document', 'manual rehearsal'];
const isText = value => typeof value === 'string' && value.trim() !== '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = file => JSON.parse(readFileSync(file, 'utf8'));

function tableCells(line) {
  // A pipe inside a backticked Markdown code span is part of the criterion.
  const cells = [''];
  for (const [part] of line.slice(1, -1).matchAll(/`[^`]*`|\\\||[^|`\\]+|./g)) {
    if (part === '|') cells.push('');
    else cells[cells.length - 1] += part;
  }
  return cells.map(cell => cell.trim());
}

function specIds(spec) {
  const entries = new Map();
  const diagnosticCodes = new Set();
  const typeRows = new Map([
    ['Picking by pointer', 'pointer'], ['Tooltip content', 'tooltip'],
    ['Keyboard order', 'keyboard'], ['Zoom', 'zoom'], ['Simplified drawing when dense', 'dense'],
    ['Limit that raises a diagnostic', 'limit'], ['Reference lines and bands', 'reference'],
  ]);
  const add = (id, type = null) => {
    if (entries.has(id)) throw new Error(`duplicate criterion in spec: ${id}`);
    entries.set(id, type);
  };
  let section;
  let columns;
  for (const raw of spec.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{2,6}\s+(\d+(?:\.\d+)?)\.?(?:\s|$)/.exec(line);
    if (heading) {
      section = heading[1];
      columns = undefined;
    }
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const [label, ...values] = tableCells(line);
    const id = label.replace(/[*_`]/g, '').trim();
    if (/^[A-Z]+\d+$/.test(id)) {
      if (['3.1', '3.2', '3.3', '3.4', '3.7', '4', '5'].includes(section)) add(id);
      else if (/^AX\d+$/.test(id) && section === '3.5') diagnosticCodes.add(id);
      else if (/^(?:3(?:\.|$)|4(?:\.|$)|5(?:\.|$))/.test(section)) {
        throw new Error(`criterion ${id} is in unlisted spec section ${section}`);
      }
    }
    if (section !== '3.6') continue;
    if (!label) {
      columns = values.map(value => value.toLowerCase());
      if (columns.some(type => !chartTypes.includes(type)) || new Set(columns).size !== columns.length) {
        throw new Error('invalid chart types in spec section 3.6');
      }
    } else if (!/^:?-+:?$/.test(label)) {
      const key = typeRows.get(label) ?? label.toLowerCase().replace(/[^a-z\d]+/g, '-').replace(/^-|-$/g, '');
      if (!columns || values.length !== columns.length || values.some(value => !value)) {
        throw new Error(`invalid type matrix row in spec: ${label}`);
      }
      columns.forEach(type => add(`T-${key}-${type}`, type));
    }
  }
  if (!entries.size) throw new Error('no acceptance criteria found in the spec');
  return { entries, diagnosticCodes };
}

function readMatrix(root, file, { entries: expected, diagnosticCodes }, sizeTargets) {
  const matrix = json(file);
  // Citations whose title the source scan alone cannot vouch for: checked against runs after the results load.
  const confirmations = [];
  if (!Array.isArray(matrix)) throw new Error('matrix must be an array of criteria');
  const errors = [];
  const seen = new Set();
  const sources = new Map();
  function source(file) {
    if (!isText(file) || isAbsolute(file) || relative(root, resolve(root, file)).split(sep)[0] === '..') {
      throw new Error(`expected a repository-relative file: ${file}`);
    }
    const path = resolve(root, file);
    if (!sources.has(path)) {
      if (!statSync(path, { throwIfNoEntry: false })?.isFile()) throw new Error(`missing file: ${file}`);
      sources.set(path, { path });
    }
    return sources.get(path);
  }
  function checkReference(reference, weak, where) {
    if (!isRecord(reference)) throw new Error('expected an evidence object');
    const { kind, file, title, prefix, casePrefix, cases, atLeast, registration, ancestors, reason, workload, history, entries, engine } = reference;
    if (![...testKinds, ...otherKinds].includes(kind)) throw new Error(`unknown evidence kind: ${kind}`);
    // Browser evidence names the engine it needs (Chrome when it names none); Node tests have no engine.
    if (engine !== undefined && kind !== 'browser') throw new Error('only browser evidence takes an engine');
    if (engine !== undefined && !ENGINES.includes(engine)) throw new Error(`unknown engine: ${engine} (expected ${ENGINES.join(', ')})`);
    if (weak && !isText(reason)) throw new Error('weak evidence needs a reason');
    const entry = source(file);
    if (kind === 'browser' && !browserFile(file)) throw new Error(`a browser citation names a file that is not a browser test (*.browser.test.*): ${file}`);
    if ((kind === 'unit' || kind === 'property') && browserFile(file)) throw new Error(`a ${kind} citation names a browser test file: ${file}`);
    if (testKinds.includes(kind)) {
      if (!(isText(title) && prefix === undefined) && !(isText(prefix) && title === undefined)) {
        throw new Error('specify exactly one test title or describe prefix');
      }
      if (ancestors !== undefined && (!isText(title) || !Array.isArray(ancestors) || !ancestors.every(isText))) {
        throw new Error('ancestors need an exact test title and an array of suite titles');
      }
      if ((casePrefix !== undefined || cases !== undefined)
        && (!isText(prefix) || !isText(casePrefix) || !Number.isSafeInteger(cases) || cases < 1)) {
        throw new Error('a scoped describe prefix needs a case prefix and a positive case count');
      }
      if (atLeast !== undefined && (!isText(prefix) || casePrefix !== undefined || cases !== undefined || !Number.isSafeInteger(atLeast) || atLeast < 1)) {
        throw new Error('atLeast goes with a describe prefix alone and is a positive count');
      }
      entry.titles ??= readTitles(readFileSync(entry.path, 'utf8'), entry.path);
      if (atLeast !== undefined && !entry.titles.tests.some(test => test.title === null && inSuite(test.ancestors, prefix))) {
        throw new Error(`atLeast is for a suite whose cases the source scan cannot list; every case under ${prefix} in ${file} is known: cite the prefix alone`);
      }
      if (registration !== undefined && (!isText(title) || !isText(registration)
        || !entry.titles.templates.some(test => test.template === registration) || !matchesTemplate(title, registration))) {
        throw new Error(`invalid source registration for ${file}: ${title}`);
      }
      if (title && !registration && !entry.titles.tests.some(test => test.title === title)) {
        throw new Error(`missing test title in ${file}: ${title}`);
      }
      // A title reached only through a template, or only from registrations under a condition, may never run.
      if (title) {
        const found = entry.titles.tests.filter(test => test.title === title);
        const why = registration ? 'it matches a template only' : found.length && found.every(test => test.conditional) ? 'it is registered under a condition' : null;
        if (why) confirmations.push({ where, file, path: entry.path, title, why });
      }
      if (prefix && !entry.titles.suites.some(suite => suite.title !== null && suite.title.startsWith(prefix))) {
        throw new Error(`missing describe prefix in ${file}: ${prefix}`);
      }
      const registrations = prefix ? [
        ...entry.titles.tests.filter(test => inSuite(test.ancestors, prefix)
          && (!casePrefix || test.title?.startsWith(casePrefix))),
        ...entry.titles.templates.filter(test => {
          const leadingText = test.template.split('${')[0];
          return inSuite(test.ancestors, prefix)
            && (!casePrefix || casePrefix.startsWith(leadingText) || leadingText.startsWith(casePrefix));
        }),
      ] : [];
      if (casePrefix && !registrations.length) throw new Error(`missing case prefix in ${file}: ${casePrefix}`);
      const candidates = prefix
        ? [...entry.titles.suites.filter(suite => suite.title !== null && suite.title.startsWith(prefix)), ...registrations]
        : (registration ? entry.titles.templates.filter(test => test.template === registration)
          : entry.titles.tests.filter(test => test.title === title));
      const scoped = ancestors && candidates.filter(test => JSON.stringify(test.ancestors) === JSON.stringify(ancestors));
      const forbidden = (scoped?.length ? scoped : candidates).flatMap(candidate => candidate.forbidden);
      if (forbidden.length) throw new Error(`citation uses .${forbidden[0]} in ${file}: ${title ?? prefix}`);
    } else if ([title, prefix, casePrefix, cases, registration, ancestors].some(value => value !== undefined)) {
      throw new Error('only test evidence takes a title, prefix, registration or ancestors');
    }
    if (kind === 'size') {
      if (!Array.isArray(entries) || !entries.length || !entries.every(isText) || new Set(entries).size !== entries.length) {
        throw new Error('size evidence needs distinct measured entry names');
      }
      entry.size ??= readSize(entry.path);
      for (const name of entries) {
        if (!entry.size.rows.has(name)) throw new Error(`missing size row in ${file}: ${name}`);
        if (typeof sizeTargets[name] !== 'number') throw new Error(`no size target for ${name} (scripts/size.mjs, SIZE_TARGETS)`);
      }
    }
    if (kind === 'benchmark' && !isText(workload)) throw new Error('benchmark evidence needs a workload');
    if (history !== undefined) {
      if (kind !== 'benchmark' || !Array.isArray(history)) throw new Error('only benchmark evidence takes a history array');
      for (const path of history) source(path);
    }
  }
  for (const row of matrix) {
    const { id, statement, appliesTo, notApplicable, evidence = {}, weak = {}, gaps = {},
      limits = {}, cannotVerify = {}, pending = {}, waivers = {} } = row ?? {};
    if (!expected.has(id)) errors.push(`stale criterion ID: ${id}`);
    if (seen.has(id)) errors.push(`duplicate criterion ID: ${id}`);
    seen.add(id);
    if (!isText(statement) || !Array.isArray(appliesTo) || !isRecord(notApplicable)) {
      errors.push(`${id}: expected a statement, appliesTo array and notApplicable map`);
      continue;
    }
    if (new Set(appliesTo).size !== appliesTo.length || appliesTo.some(type => !chartTypes.includes(type))) {
      errors.push(`${id}: invalid or duplicate applicable chart type`);
    }
    const cellType = expected.get(id);
    if (cellType && (appliesTo.length !== 1 || appliesTo[0] !== cellType)) {
      errors.push(`${id}: the spec cell belongs to ${cellType}`);
    }
    for (const type of chartTypes) {
      if (appliesTo.includes(type) ? Object.hasOwn(notApplicable, type) : !isText(notApplicable[type])) {
        errors.push(`${id}/${type}: supply a reason exactly when the type is not applicable`);
      }
    }
    for (const type of Object.keys(notApplicable)) {
      if (!chartTypes.includes(type)) errors.push(`${id}: unknown chart type in notApplicable: ${type}`);
    }
    for (const [key, mapping] of Object.entries({ evidence, weak, gaps, limits, cannotVerify, pending, waivers })) {
      if (!isRecord(mapping)) {
        errors.push(`${id}: expected a chart-type map for ${key}`);
        continue;
      }
      for (const [type, value] of Object.entries(mapping)) {
        if (!appliesTo.includes(type)) errors.push(`${id}/${type}: ${key} requires an applicable type`);
        if (key === 'waivers') {
          if (!isRecord(value) || !isText(value.reason) || !isText(value.grantedBy)) {
            errors.push(`${id}/${type}: waiver needs a reason and who granted it`);
          }
          continue;
        }
        if (key === 'cannotVerify' || key === 'pending' || key === 'gaps' || key === 'limits') {
          if (!isText(value)) errors.push(`${id}/${type}: ${key} needs a reason`);
          if (key === 'gaps' && !evidence?.[type]?.length && !weak?.[type]?.length) {
            errors.push(`${id}/${type}: gaps require partial evidence`);
          }
          if (key === 'pending' && Object.hasOwn(cannotVerify ?? {}, type)) {
            errors.push(`${id}/${type}: cannotVerify and pending are mutually exclusive`);
          }
          continue;
        }
        if (!Array.isArray(value) || !value.length) {
          errors.push(`${id}/${type}: ${key} needs a non-empty array of references`);
          continue;
        }
        for (const reference of value) {
          try {
            checkReference(reference, key === 'weak', `${id}/${type}`);
          } catch (error) {
            errors.push(`${id}/${type}: ${error.message}`);
          }
        }
      }
    }
  }
  const registry = matrix.find(row => row.id === 'F3');
  if (registry) {
    const tests = [...Object.values(registry.evidence ?? {}).flat(), ...Object.values(registry.weak ?? {}).flat()];
    const cited = new Set(tests.filter(ref => testKinds.includes(ref.kind)).flatMap(ref => ref.title?.match(/\bAX\d+\b/g) ?? []));
    for (const code of diagnosticCodes) if (!cited.has(code)) errors.push(`F3: missing diagnostic test citation for ${code}`);
  }
  for (const id of expected.keys()) if (!seen.has(id)) errors.push(`missing criterion ID: ${id}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return { matrix, sources, confirmations };
}

/**
 * A citation the source scan alone cannot vouch for (a template match, or a title registered only under a
 * condition) needs a run that shows it: a supplied result of its file, or the EVIDENCE.json beside the test
 * file (a list of { file, title } from a run). A file one of them covers but that lacks the title is a
 * structural error; a file neither covers is a warning.
 */
function confirmTitles(root, confirmations, index) {
  const errors = [];
  const warnings = [];
  const evidence = new Map();
  const listed = path => {
    const file = resolve(dirname(path), 'EVIDENCE.json');
    if (!evidence.has(file)) {
      let titles = null;
      if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
        const entries = json(file);
        if (!Array.isArray(entries) || !entries.every(entry => isText(entry?.file) && isText(entry?.title))) throw new Error(`${relative(root, file)}: expected a list of { file, title }`);
        titles = new Map();
        for (const entry of entries) {
          const at = resolve(root, entry.file);
          if (!titles.has(at)) titles.set(at, new Set());
          titles.get(at).add(entry.title);
        }
      }
      evidence.set(file, titles);
    }
    return evidence.get(file)?.get(path) ?? null;
  };
  for (const { where, file, path, title, why } of confirmations) {
    const ran = index.get(path);
    const fromEvidence = listed(path);
    if (!ran && !fromEvidence) {
      warnings.push(`${where}: title not confirmed by any run (${why}) in ${file}: ${title}`);
      continue;
    }
    if (!ran?.some(test => test.title === title) && !fromEvidence?.has(title)) {
      errors.push(`${where}: title never ran in ${file} (${why}): ${title}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return [...new Set(warnings)];
}

function readSize(file) {
  const { packed, rows } = json(file);
  if (!isText(packed?.axylo) || !Array.isArray(rows)) {
    throw new Error(`${file}: expected packed size measurements`);
  }
  const entries = new Map();
  for (const { entry, minBytes, totalGzipBytes } of rows) {
    if (!isText(entry) || !Number.isSafeInteger(totalGzipBytes) || totalGzipBytes < 0
      || !Number.isSafeInteger(minBytes) || minBytes < 0 || entries.has(entry)) {
      throw new Error(`${file}: invalid or duplicate size entry: ${entry}`);
    }
    entries.set(entry, { minBytes, totalGzipBytes });
  }
  // The record's own targetKiB are not read: the targets have one source, scripts/size.mjs.
  return { rows: entries, integrity: packed.axylo, commit: isText(packed.commit) ? packed.commit : null };
}

function readProvenance(file) {
  const sidecar = file.replace(/\.json$/, '') + '.provenance.json';
  return statSync(sidecar, { throwIfNoEntry: false }) ? json(sidecar) : null;
}

function readResults(root, roots, files, sources) {
  const index = new Map();
  const runs = [];
  const suiteFailures = new Map();
  const paths = [...sources.keys()].map(path => [relative(root, path).split(sep).join('/'), path]);
  const bases = [...new Set([root, ...roots])];
  for (const file of files) {
    const { testResults } = json(file);
    const provenance = readProvenance(file);
    if (!Array.isArray(testResults)) throw new Error(`${file}: expected Vitest JSON testResults`);
    const failures = [];
    let passed = 0;
    let skipped = 0;
    const { engine, engineVersion } = runEngine(file, { testResults }, provenance);
    for (const suite of testResults) {
      if (!isText(suite?.name) || !Array.isArray(suite.assertionResults)) {
        throw new Error(`${file}: expected a test file name and assertionResults`);
      }
      const name = suite.name.replaceAll('\\', '/');
      const candidates = [...new Set(bases.map(base => resolve(base, name)))];
      let matches = candidates.filter(path => sources.has(path));
      // Absolute paths from archived checkouts can still carry the full repository-relative path.
      if (!matches.length && (isAbsolute(name) || /^[A-Za-z]:\//.test(name))) {
        matches = paths.filter(([relativePath]) => relativePath.includes('/')
          && name.endsWith('/' + relativePath)).map(([, path]) => path);
      }
      if (matches.length > 1) throw new Error(`${file}: ambiguous report path ${suite.name}`);
      const [path] = matches;
      if (path && !index.has(path)) index.set(path, []);
      const source = relative(root, path ?? candidates[0]);
      let failed = false;
      for (const test of suite.assertionResults) {
        if (!isText(test?.title) || !isText(test.status) || !Array.isArray(test.ancestorTitles) || !test.ancestorTitles.every(isText)) {
          throw new Error(`${file}: expected assertion title, status and ancestorTitles in ${suite.name}`);
        }
        if (path) index.get(path).push({ ...test, file, engine: testEngine(test, engine), runEngine: engine });
        if (test.status === 'passed') passed++;
        else if (test.status !== 'failed') skipped++;
        if (test.status === 'failed') {
          failures.push({ source, test: test.title });
          failed = true;
        }
      }
      if (suite.status === 'failed' && (!failed || isText(suite.message))) {
        const message = isText(suite.message) ? suite.message.trim().split(/\r?\n/)[0] : undefined;
        failures.push({ source, message, assertionFailed: failed });
        if (path) {
          if (!suiteFailures.has(path)) suiteFailures.set(path, new Map());
          suiteFailures.get(path).set(file, engine);
        }
      }
    }
    runs.push({ file, passed, skipped, failures, provenance, engine, engineVersion });
  }
  return { index, runs, suiteFailures };
}

/**
 * The one engine a results file ran on. The harness records it on every test (`meta.engine`), and run.mjs
 * records the engine asked for in the sidecar. A file that declares two engines, or disagrees with its
 * sidecar, is refused: one engine's results must never be read as another's. A file that declares none and
 * has no engine in its sidecar predates the switch (or holds Node tests): null.
 */
function runEngine(file, results, provenance) {
  const { engines, versions } = declaredEngines(results);
  if (engines.length > 1) throw new Error(`${file}: mixes engines (${engines.join(', ')}); run each engine into its own results file`);
  if (versions.length > 1) throw new Error(`${file}: mixes engine versions (${versions.join(', ')})`);
  const recorded = provenance?.engine;
  if (recorded !== undefined && recorded !== null && !ENGINES.includes(recorded)) throw new Error(`${file}: unknown engine in provenance: ${recorded}`);
  if (engines.length && recorded && recorded !== engines[0]) {
    throw new Error(`${file}: the provenance records ${recorded} but the results declare ${engines[0]}`);
  }
  const engine = engines[0] ?? recorded ?? null;
  return { engine, engineVersion: versions.length ? versions[0].slice(engine.length + 1) : provenance?.engineVersion ?? null };
}

/**
 * The engine one test ran on. Its own record when it has one. Without one, Chrome only in a run that is
 * Chrome or predates the switch: every browser launcher in this repository that does not read AXYLO_ENGINE
 * (apps/docs/test, tests/dist/browser.ts) launches system Chrome. In a run on another engine such a test is
 * "engine not recorded" (null) and stands for no engine.
 */
function testEngine(test, runEngine) {
  if (test.meta?.engine !== undefined) return test.meta.engine;
  return runEngine === null || runEngine === 'chromium' ? 'chromium' : null;
}

const testKey = (ancestors, title) => JSON.stringify([ancestors, title]);
const inSuite = (ancestors, prefix) => ancestors.some(suite => suite !== null && suite.startsWith(prefix));

/** Whether a test the scan found (ancestors with null for a suite of unknown title) is this reported one. */
const sameTest = (known, reported) => known.title === reported.title && known.ancestors.length === reported.ancestorTitles.length
  && known.ancestors.every((suite, i) => suite === null || suite === reported.ancestorTitles[i]);

function resultFor(source, ref, context) {
  const { results, suiteFailures, stale, pack, sizeTargets } = context;
  const reasons = new Set();
  if (ref.kind === 'size') {
    // A size record counts only for the pack it measured, and that pack must be the one this tree packs.
    if (source.size.integrity !== pack()) {
      reasons.add(`${basename(source.path)}: the size record measured another pack (${source.size.integrity.slice(0, 19)}…), not the one this tree packs (${String(pack()).slice(0, 19)}…)`);
      return { status: STALE, reports: new Map([[source.path, new Set(['not recorded'])]]), reasons };
    }
    const exceeded = ref.entries.some(name => exceeds(source.size.rows.get(name).totalGzipBytes, sizeTargets[name]));
    const status = exceeded ? 'fail' : 'pass';
    return { status, reports: new Map([[source.path, new Set([status])]]), reasons };
  }
  const reports = new Map();
  if (!testKinds.includes(ref.kind)) return { status: 'not run', reports, reasons };
  // A browser citation is answered only by results of its own engine: a pass elsewhere is no evidence here.
  const engine = ref.kind === 'browser' ? ref.engine ?? 'chromium' : null;
  const sameEngine = test => engine === null || test.engine === engine;
  const known = ref.ancestors ? [{ title: ref.title, ancestors: ref.ancestors }] : ref.registration
    ? source.titles.templates.filter(test => test.template === ref.registration).map(test => ({ title: ref.title, ancestors: test.ancestors }))
    : source.titles.tests.filter(({ title, ancestors }) => ref.title
      ? title === ref.title : inSuite(ancestors, ref.prefix) && (!ref.casePrefix || title?.startsWith(ref.casePrefix)));
  // Under atLeast, the cases the scan could not list are counted from the results instead.
  const expected = ref.atLeast ? known.filter(test => test.title !== null) : known;
  const templates = ref.casePrefix ? source.titles.templates.filter(test => inSuite(test.ancestors, ref.prefix)) : [];
  for (const [file, runEngine] of suiteFailures.get(source.path) ?? []) {
    if (!(engine === null || runEngine === engine || (runEngine === null && engine === 'chromium'))) continue;
    if (stale.has(file)) {
      reports.set(file, new Set(['not recorded']));
      reasons.add(`${basename(file)}: not recorded for this revision (${stale.get(file)})`);
    } else reports.set(file, new Set(['fail']));
  }
  const passed = [];
  for (const test of results.get(source.path) ?? []) {
    const matches = ref.prefix ? inSuite(test.ancestorTitles, ref.prefix) && (!ref.casePrefix || test.title.startsWith(ref.casePrefix))
      : ref.ancestors ? known.some(k => sameTest(k, test)) : test.title === ref.title;
    if (!matches) continue;
    if (!sameEngine(test)) {
      if (test.engine === null) reasons.add(`${basename(test.file)}: engine not recorded in a ${engineLabel(test.runEngine)} run`);
      continue;
    }
    // A run whose provenance does not match this tree answers nothing about it.
    if (stale.has(test.file)) {
      if (!reports.has(test.file)) reports.set(test.file, new Set());
      reports.get(test.file).add('not recorded');
      reasons.add(`${basename(test.file)}: not recorded for this revision (${stale.get(test.file)})`);
      continue;
    }
    if (test.status !== 'passed' && test.status !== 'failed' && isText(test.meta?.notRun)) reasons.add(`Not run on ${test.meta.notRun}`);
    // Historical failures remain visible even when a suite has since replaced the assertion.
    if (test.status === 'passed' && (!ref.casePrefix || expected.some(k => sameTest(k, test))
      || templates.some(candidate => sameTest({ title: test.title, ancestors: candidate.ancestors }, test) && matchesTemplate(test.title, candidate.template)))) {
      passed.push(test);
    }
    if (!reports.has(test.file)) reports.set(test.file, new Set());
    reports.get(test.file).add(test.status === 'failed' ? 'fail' : test.status === 'passed' ? 'pass' : 'skipped');
  }
  const distinct = new Set(passed.map(test => testKey(test.ancestorTitles, test.title))).size;
  const current = [...reports.values()].filter(values => !values.has('not recorded'));
  const status = current.some(values => values.has('fail')) ? 'fail'
    : distinct && (!ref.cases || distinct === ref.cases) && (!ref.atLeast || distinct >= ref.atLeast)
      && expected.every(k => passed.some(test => sameTest(k, test))) && current.every(values => !values.has('skipped')) ? 'pass'
      : [...reports.values()].some(values => values.has('not recorded')) ? STALE : 'not run';
  if (status === 'not run') {
    const citation = `${ref.file}: ${ref.title ?? ref.prefix}${ref.casePrefix ? ` (${ref.casePrefix})` : ''}`;
    if (ref.atLeast && distinct < ref.atLeast && current.length) {
      reasons.add(`${distinct} of at least ${ref.atLeast} cases passed for ${citation}`);
    } else if ((current.length || !reasons.size) && current.every(values => !values.has('skipped'))) {
      if (engine !== null && !reports.size) reasons.add(`No ${engineLabel(engine)} result for ${citation}`);
      else if (ref.cases && distinct && distinct !== ref.cases) reasons.add(`Expected ${ref.cases} passing cases for ${citation}, found ${distinct}`);
      else reasons.add(`No matching passing test for ${citation}`);
    }
  }
  return { status, reports, reasons };
}

function cellFor(row, type, root, sources, context) {
  if (!row.appliesTo.includes(type)) return { status: 'not applicable', reports: new Map(), unrun: [], reasons: new Set() };
  const required = row.evidence?.[type] ?? [];
  const weak = row.weak?.[type] ?? [];
  const outcome = ref => resultFor(sources.get(resolve(root, ref.file)), ref, context);
  const outcomes = required.map(outcome);
  const supporting = weak.map(outcome);
  let status;
  if ([...outcomes, ...supporting].some(result => result.status === 'fail')) status = 'fail';
  else if (row.cannotVerify?.[type]) status = 'cannot be verified here';
  else if (row.pending?.[type]) status = 'not run';
  else if (row.gaps?.[type] || (!required.length && weak.length)) status = 'weak';
  else if (!required.length) status = 'no evidence';
  else if ([...outcomes, ...supporting].every(result => result.status === 'pass')) status = 'pass';
  else status = [...outcomes, ...supporting].some(result => result.status === STALE) ? STALE : 'not run';

  const reports = new Map();
  for (const { reports: matches } of [...outcomes, ...supporting]) for (const [file, values] of matches) {
    if (!reports.has(file)) reports.set(file, new Set());
    for (const value of values) reports.get(file).add(value);
  }
  const unrun = [...required.filter((ref, i) => testKinds.includes(ref.kind) && outcomes[i].status === 'not run'),
    ...weak.filter((_, i) => testKinds.includes(weak[i].kind) && supporting[i].status === 'not run')];
  const reasons = new Set([...outcomes, ...supporting].filter(result => result.status === 'not run' || result.status === STALE).flatMap(result => [...result.reasons]));
  if (status === 'not run' && row.pending?.[type]) reasons.add(row.pending[type]);
  return { status, reports, unrun, reasons };
}

const escapeCell = value => value.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const label = value => value.replace(/[\\\[\]]/g, '\\$&');
const fileLink = (from, root, file) => `[${label(file)}](${relative(from, resolve(root, file)).split(sep).map(encodeURIComponent).join('/')})`;

function groupTypes(entries) {
  const groups = new Map();
  for (const [type, value] of entries) {
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(type);
  }
  return [...groups].map(([value, types]) => `${types.join(', ')} · ${value}`);
}

function readerDetails(rows, root, from, review) {
  const failures = new Map();
  const weak = [];
  const missing = [];
  const pending = [];
  const stale = [];
  const environment = [];
  const limits = new Map();
  const waivers = [];
  const unrun = new Map();
  for (const { row, cells } of rows) {
    const cellsOf = status => chartTypes.filter((_, i) => cells[i].status === status);
    const failed = cellsOf('fail');
    if (failed.length) failures.set(row.id, new Set(failed));
    const gaps = cellsOf('weak').flatMap(type => row.gaps?.[type]
      ? [[type, row.gaps[type]]] : (row.weak?.[type] ?? []).map(ref => [type, ref.reason]));
    if (gaps.length) weak.push(`- **${row.id}** · ${groupTypes(gaps).map(note => `Weak · ${note}`).join('\n  - ')}`);
    const absent = cellsOf('no evidence');
    if (absent.length) missing.push(`- **${row.id}** · ${absent.join(', ')} · ${row.statement}`);
    const waiting = groupTypes(cellsOf('not run').map(type => {
      const reasons = [...cells[chartTypes.indexOf(type)].reasons].sort();
      return [type, row.pending?.[type] ?? `Required assertions have no matching passing result.${reasons.length ? ' ' + reasons.map(reason => label(reason) + '.').join(' ') : ''}`];
    }));
    if (waiting.length) pending.push(`- **${row.id}** · ${waiting.join('\n  - ')}`);
    const old = groupTypes(cellsOf(STALE).map(type => [type, [...cells[chartTypes.indexOf(type)].reasons].sort().map(reason => label(reason) + '.').join(' ') || 'Its evidence is from another revision.']));
    if (old.length) stale.push(`- **${row.id}** · ${old.join('\n  - ')}`);
    for (const [type, waiver] of Object.entries(row.waivers ?? {})) {
      waivers.push(`- **${row.id}/${type}** · Waiver granted by ${waiver.grantedBy} · ${waiver.reason}`);
    }
    const unavailable = groupTypes(Object.entries(row.cannotVerify ?? {}));
    if (unavailable.length) environment.push(`- **${row.id}** · ${unavailable.join('\n  - ')}`);
    for (const [type, note] of Object.entries(row.limits ?? {})) {
      if (!limits.has(note)) limits.set(note, new Map());
      const criteria = limits.get(note);
      if (!criteria.has(row.id)) criteria.set(row.id, []);
      criteria.get(row.id).push(type);
    }
    for (const [i, cell] of cells.entries()) {
      for (const ref of cell.unrun) {
        if (!unrun.has(ref.file)) unrun.set(ref.file, new Set());
        unrun.get(ref.file).add(`${row.id}/${chartTypes[i]}`);
      }
    }
  }
  if (rows.some(({ row }) => row.id === 'P1')) {
    environment.push(`- **GPU** · Hardware rasterization needs a headed, GPU-backed run. ${fileLink(from, root, 'docs/decisions/0002-mark-renderer.md')}`);
  }
  const failedGroups = [];
  for (const { label, cells, detail, sources = [] } of review?.failureGroups ?? []) {
    const affected = [];
    for (const [id, types] of Object.entries(cells)) {
      const found = types.filter(type => failures.get(id)?.delete(type));
      if (found.length) affected.push(`${id} (${found.join(', ')})`);
    }
    if (affected.length) {
      const links = sources.map(file => fileLink(from, root, file));
      failedGroups.push(`- **${label}** · ${affected.join(' · ')}. ${detail}${links.length ? ' ' + links.join(' · ') : ''}`);
    }
  }
  for (const [id, types] of failures) {
    if (types.size) failedGroups.push(`- **${id}** · ${[...types].join(', ')}`);
  }
  return [
    '## What stands between this tree and a release', '',
    '### Failing cells', '', ...(failedGroups.length ? failedGroups : ['No failing cells recorded.']), '',
    '### Weak cells', '', ...(weak.length ? weak : ['No weak cells recorded.']), '',
    '### No evidence', '', ...(missing.length ? missing : ['No cells without evidence.']), '',
    '### Not run', '',
    ...(rows.some(({ row }) => row.id === 'P1') && pending.length
      ? [`P1–P8 have a harness in \`bench/\`. Acceptance measurements await a quiet machine. ${fileLink(from, root, 'bench/README.md')}`, ''] : []),
    ...(pending.length ? pending : ['No cells awaiting a run.']), '',
    '### Not recorded for this revision', '', ...(stale.length ? stale : ['No cell rests on results from another revision.']), '',
    '### Cannot be verified here', '', ...(environment.length ? environment : ['No environment limits recorded.']), '',
    ...(waivers.length ? ['### Waivers', '', ...waivers, ''] : []),
    ...(limits.size ? ['## Evidence limits by cell', '', ...[...limits].map(([note, criteria]) =>
      `- ${note} **${[...criteria].map(([id, types]) => `${id} (${types.join(', ')})`).join(' · ')}**`), ''] : []),
    '## Evidence that exists but was not run for this report', '',
    ...(unrun.size ? ['These files have citations with required assertions missing or skipped in the supplied results.', ''] : []),
    ...(unrun.size ? [...unrun].map(([file, cells]) => `- ${[...cells].join(', ')} · ${fileLink(from, root, file)}`)
      : ['Every required executable citation has a matching result. Unmeasured workloads appear under Not run.']), '',
  ].join('\n');
}

function describeReview(review, rows, counts) {
  if (!review) return [];
  const { scope, negativeControls, baseline, changeReasons } = review;
  const previous = Object.fromEntries(statuses.map(status => [status, 0]));
  const groups = new Map();
  for (const { row, cells } of rows) {
    const before = baseline[row.id];
    if (!before) continue;
    for (const [i, { status }] of cells.entries()) {
      previous[before[i]]++;
      if (before[i] === status) continue;
      const transition = `${before[i]} → ${status}`;
      if (!groups.has(transition)) groups.set(transition, new Map());
      const group = groups.get(transition);
      if (!group.has(row.id)) group.set(row.id, []);
      group.get(row.id).push(chartTypes[i]);
    }
  }
  return [
    '## Scope of this evidence review', '',
    ...scope.flatMap(paragraph => [paragraph, '']),
    '## Status changes from the previous report', '',
    'The baseline is the checked-in report before the re-merge. The separate coordinator checker log stopped at structural citation errors.', '',
    '| Status | Before | After |', '| --- | ---: | ---: |',
    ...statuses.map(status => `| ${status} | ${previous[status]} | ${counts[status]} |`), '',
    ...[...groups].map(([transition, group]) => {
      const count = [...group.values()].reduce((total, types) => total + types.length, 0);
      const cells = [...group].map(([id, types]) => `${id} (${types.join(', ')})`).join(' · ');
      return `- **${transition} (${count})** · ${changeReasons[transition] ?? 'See the evidence and blocker notes for these cells.'}\n  - ${cells}`;
    }), '',
    '## Negative controls', '',
    negativeControls.intro, '',
    ...negativeControls.checks.map(([helper, mutation]) => `- **${helper}** · ${mutation}`), '',
  ];
}

function describeProvenance(provenance) {
  if (!provenance) return 'missing';
  const changed = provenance.changedDuringRun ? ', working tree changed during run' : '';
  return `commit ${provenance.commit}, dirty ${provenance.dirty}, tree SHA-256 ${provenance.tree}, result SHA-256 ${provenance.resultSha256}, ${Object.keys(provenance.hashes ?? {}).length} cited test hashes in the sidecar${changed}`;
}

function describeRuns(runs, root) {
  if (!runs.length) return ['Static coverage only. No Vitest reports supplied.'];
  return ['## Supplied Vitest runs', '', 'Suite counts include assertions outside the matrix. Each cell lists the reports with matching assertions, including partial evidence in weak cells.', '',
    ...runs.flatMap(({ file, passed, skipped, failures, provenance, provenanceError, engine, engineVersion }) => [
      `- \`${relative(root, file)}\` · ${engine ? `${engineLabel(engine, engineVersion)} · ` : ''}${passed} passed assertions, ${failures.length} reported failures${skipped ? `, ${skipped} skipped or pending` : ''}`,
      `  - Provenance: ${describeProvenance(provenance)}${provenanceError ? ' · ' + provenanceError : ''}`,
      ...failures.map(({ source, test, message, assertionFailed }) => `  - \`${source}\` · ${test ? label(test)
        : (assertionFailed ? 'Suite failed in addition to its failing assertions' : 'Suite failed without a failing assertion result')
          + (message ? ' (' + label(message) + ')' : '')}`),
    ]), ''];
}

function describeSizes(rows, root, sources, from, sizeTargets, pack) {
  const measurements = new Map();
  for (const { row } of rows) for (const refs of Object.values(row.evidence ?? {})) for (const ref of refs) {
    if (ref.kind === 'size') measurements.set(ref.file, sources.get(resolve(root, ref.file)).size);
  }
  return [...measurements].flatMap(([file, { rows: entries, integrity, commit }]) => [
    '## Packed size measurement', '',
    integrity === pack() ? `Measured from the pack this tree makes (${integrity.slice(0, 19)}…${commit ? `, commit ${commit.slice(0, 7)}` : ''}).`
      : `Not recorded for this revision: the record measured another pack (${integrity.slice(0, 19)}…${commit ? `, commit ${commit.slice(0, 7)}` : ''}), not the one this tree packs (${String(pack()).slice(0, 19)}…).`, '',
    ...[...entries].map(([name, { minBytes, totalGzipBytes }]) =>
      `- ${name} · ${minBytes.toLocaleString('en-US')} minified JS bytes, ${(totalGzipBytes / 1024).toFixed(2)} KiB gzipped${typeof sizeTargets[name] !== 'number' ? ''
        : `, ${sizeTargets[name]} KiB target`} · ${fileLink(from, root, file)}`), '',
  ]);
}

function describeWarnings(warnings) {
  if (!warnings.length) return [];
  return ['## Warnings', '', 'Titles the source scan cannot vouch for, with no run to confirm them (no result of their file and no EVIDENCE.json beside it).', '',
    ...warnings.map(warning => `- ${label(warning)}`), ''];
}

function uniqueReportLabel(file, files, root) {
  const name = file.split(sep).at(-1);
  return files.filter(candidate => candidate.split(sep).at(-1) === name).length === 1 ? name : relative(root, file);
}

/**
 * `packIntegrity` and `sizeTargets` are for tests: by default the current pack is what `npm pack` makes of this
 * tree now (provenance.mjs), computed only when a size citation needs it, and the targets are scripts/size.mjs's.
 */
export function check({ root, matrixFile = resolve(root, 'acceptance/matrix.json'), resultFiles = [], resultRoots = [], release = false,
  packIntegrity: currentPack, sizeTargets = SIZE_TARGETS }) {
  root = resolve(root);
  const expected = specIds(readFileSync(resolve(root, 'docs/02-product-spec.md'), 'utf8'));
  const { matrix, sources, confirmations } = readMatrix(root, matrixFile, expected, sizeTargets);
  const roots = resultRoots.map(path => resolve(root, path));
  const reports = [...new Set(resultFiles.map(file => resolve(file)))].sort();
  const { index, runs, suiteFailures } = readResults(root, roots, reports, sources);
  const warnings = confirmTitles(root, confirmations, index);
  // Provenance is judged in every mode: a recorded run of another tree answers nothing about this one. Only a
  // release also requires every run to have a record.
  if (runs.length && (release || runs.some(run => run.provenance))) {
    const current = runs.some(run => run.provenance) ? snapshot(root, citedTestFiles(matrix)) : null;
    for (const run of runs) {
      const recorded = run.provenance;
      if (!recorded) { if (release) run.provenanceError = 'release requires recorded provenance'; }
      else if (recorded.changedDuringRun) run.provenanceError = 'release requires an unchanged working tree during the run';
      else if (recorded.commit !== current.commit || recorded.dirty !== current.dirty || recorded.tree !== current.tree
        || recorded.resultSha256 !== hashFile(run.file)
        || Object.keys(recorded.hashes ?? {}).length !== Object.keys(current.hashes).length
        || Object.entries(current.hashes).some(([file, hash]) => recorded.hashes?.[file] !== hash)) {
        run.provenanceError = 'provenance does not match the working tree';
      }
    }
  }
  const stale = new Map(runs.filter(run => run.provenanceError).map(run => [run.file, run.provenanceError]));
  let packed;
  const pack = () => (packed ??= typeof currentPack === 'function' ? currentPack() : currentPack !== undefined ? currentPack : packIntegrity(root));
  const context = { results: index, suiteFailures, stale, pack, sizeTargets };
  const reportFiles = [...runs.map(run => run.file), ...[...sources.values()].filter(source => source.size).map(source => source.path)];
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  const rows = matrix.map(row => ({
    row,
    cells: chartTypes.map(type => {
      const cell = cellFor(row, type, root, sources, context);
      counts[cell.status]++;
      return cell;
    }),
  }));
  const header = ['Criterion', 'Statement', ...chartTypes];
  const printRow = cells => `| ${cells.map(escapeCell).join(' | ')} |`;
  const describeCell = ({ status, reports }) => reports.size ? `${status} (${[...reports].map(([file, results]) =>
    `${uniqueReportLabel(file, reportFiles, root)} ${[...results].sort().join('/')}`).join(', ')})` : status;
  const table = [printRow(header), printRow(header.map(() => '---')),
    ...rows.map(({ row, cells }) => printRow([row.id, row.statement, ...cells.map(describeCell)]))].join('\n');
  const summary = statuses.map(status => `- ${status} · ${counts[status]}`).join('\n');
  const from = resolve(root, 'acceptance');
  const notesFile = resolve(from, 'review.json');
  const notes = statSync(notesFile, { throwIfNoEntry: false }) ? json(notesFile) : null;
  const review = notes && runs.length === 4 && runs.every(run => run.provenance?.commit === notes.commit) ? notes : null;
  const report = ['# Acceptance report', '', ...describeRuns(runs, root), ...describeWarnings(warnings), ...describeSizes(rows, root, sources, from, sizeTargets, pack),
    '', '## Status by chart type', '', summary, '',
    'The matrix contains individual test citations and applicability reasons. ' + fileLink(from, root, relative(root, matrixFile)), '',
    table, '', readerDetails(rows, root, from, review), ...describeReview(review, rows, counts)].join('\n') + '\n';
  const blocked = rows.some(({ row, cells }) => cells.some(({ status }, i) =>
    !['pass', 'not applicable'].includes(status)
    && (!['not run', 'cannot be verified here'].includes(status) || !row.waivers?.[chartTypes[i]])));
  return {
    table, summary, report, counts, runs, warnings, rows: structuredRows(rows, runs, reportFiles, root, sources),
    exitCode: release && (blocked || runs.some(run => run.provenanceError)) ? 1 : 0,
  };
}

/**
 * The table's content as data, for readers that must not parse the Markdown (the docs' conformance page).
 * Per cell: its status, why it was not run, and each report that answered it, named as the table names it,
 * with what it recorded: the run's engine (null for Node runs and for results that predate the engine record)
 * and the provenance error that keeps a release from counting it (null when none).
 */
function structuredRows(rows, runs, reportFiles, root, sources) {
  const byFile = new Map(runs.map(run => [run.file, run]));
  return rows.map(({ row, cells }) => ({
    id: row.id,
    statement: row.statement,
    cells: Object.fromEntries(chartTypes.map((type, i) => [type, {
      status: cells[i].status,
      reasons: [...cells[i].reasons].sort(),
      reports: [...cells[i].reports].map(([file, results]) => {
        const run = byFile.get(file);
        const sizeStale = !run && results.has('not recorded');
        return {
          file: relative(root, file).split(sep).join('/'),
          label: uniqueReportLabel(file, reportFiles, root),
          source: run ? 'run' : 'size',
          results: [...results].sort(),
          engine: run?.engine ?? null,
          engineVersion: run?.engineVersion ?? null,
          provenanceError: run?.provenanceError ?? (sizeStale ? `the size record measured another pack (${sources.get(file).size.integrity})` : null),
        };
      }),
    }])),
  }));
}

function main(args) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const resultFiles = [];
  const resultRoots = [];
  let release = false;
  let write = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--release') {
      release = true;
    } else if (args[i] === '--write') {
      write = true;
    } else if (args[i] === '--results' || args[i] === '--roots') {
      const option = args[i];
      const paths = option === '--results' ? resultFiles : resultRoots;
      const before = paths.length;
      while (args[i + 1] && !args[i + 1].startsWith('--')) paths.push(resolve(args[++i]));
      if (before === paths.length) throw new Error(option + ' needs at least one path');
    } else {
      throw new Error(`unknown argument ${args[i]} (usage: node acceptance/check.mjs [--results <file>…] [--roots <directory>…] [--release] [--write])`);
    }
  }
  let result;
  try {
    result = check({ root, resultFiles, resultRoots, release });
  } catch (error) {
    for (const file of [...new Set(resultFiles)].sort()) {
      let provenance;
      try {
        provenance = describeProvenance(readProvenance(file));
      } catch (error) {
        provenance = `unreadable (${error.message})`;
      }
      console.log(`${relative(root, file)} · Provenance: ${provenance}`);
    }
    throw error;
  }
  if (write) writeFileSync(resolve(root, 'acceptance/report.md'), result.report);
  if (result.runs.length) console.log(describeRuns(result.runs, root).join('\n'));
  console.log(`${result.table}\n\n${result.summary}`);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
