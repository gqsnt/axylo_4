import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { ENGINES, engineLabel } from './provenance.mjs';
import { matchesTemplate, readTitles, tokens } from './titles.mjs';

/** The twelve core product journeys of the Axylo 4 vision, in reading order. */
export const CORE_JOURNEY_IDS = Object.freeze([
  'first-impression', 'reading', 'hover', 'explore', 'compare', 'resize',
  'mobile-touch', 'keyboard', 'screen-reader', 'invalid-data', 'customization', 'live-data',
]);
/** The four Axylo 4 opt-in entry-point journeys (J13–J16). */
export const OPT_IN_JOURNEY_IDS = Object.freeze([
  'static-stream', 'cartesian-multiscale', 'stats-sync', 'export-finance',
]);
/** All product journeys (J1–J12 core + J13–J16 Axylo 4 opt-ins). */
export const JOURNEY_IDS = Object.freeze([...CORE_JOURNEY_IDS, ...OPT_IN_JOURNEY_IDS]);
/** PERS tracks histogram as its own kind even though the matrix has no histogram column yet. */
export const PERS_KINDS = Object.freeze(['line', 'area', 'bar', 'histogram', 'scatter', 'donut', 'compact']);
/** Opt-in entry-point families tracked by J13–J16 alongside core chart kinds. */
export const OPT_IN_FAMILIES = Object.freeze(['static', 'stream', 'cartesian', 'stats', 'sync', 'export', 'finance']);
export const ALL_PERS_KINDS = Object.freeze([...PERS_KINDS, ...OPT_IN_FAMILIES]);
export const TEST_KINDS = Object.freeze(['unit', 'property', 'browser']);
export const BENCH_WORKLOADS = Object.freeze(['first', 'page', 'compact', 'scatter', 'stream', 'theme', 'resize', 'hover', 'zoom', 'mem', 'lifecycle']);
export const MANUAL_AT_STATUSES = Object.freeze(['verified', 'waived-for-1.0', 'gap-open', 'not-applicable']);

const STALE = 'not recorded for this revision';
const isText = value => typeof value === 'string' && value.trim() !== '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFile = path => statSync(path, { throwIfNoEntry: false })?.isFile() === true;
const histogramFile = file => /histogram/i.test(file);
const isTestFile = file => /\.test\.[cm]?[jt]sx?$/.test(file);
export const browserFile = file => /\.browser\.test\.[cm]?[jt]sx?$/.test(file);
export const multiEngineBrowserFile = file => normalizePath(file).startsWith('packages/axylo/test/browser/') && browserFile(file);
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const normalizePath = value => String(value).replaceAll('\\', '/').replace(/^\.\//, '');

const JOURNEY_META = new WeakMap();

export const inSuite = (ancestors, prefix) => ancestors.some(suite => suite !== null && suite.startsWith(prefix));
const testKey = (ancestors, title) => JSON.stringify([ancestors, title]);
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const suiteMatches = (candidateSuite, targetSuite) => {
  if (candidateSuite === null || candidateSuite === targetSuite) return true;
  if (/%[joO]/.test(candidateSuite)) {
    return new RegExp(`^${candidateSuite.split(/%[joO]/).map(escapeRegex).join('.+')}$`).test(targetSuite);
  }
  return false;
};
const sameTest = (known, reported) => known.title === reported.title && known.ancestors.length === reported.ancestorTitles.length
  && known.ancestors.every((suite, i) => suiteMatches(suite, reported.ancestorTitles[i]));
const ancestorsMatch = (candidateAncestors, targetAncestors) =>
  candidateAncestors.length === targetAncestors.length
  && candidateAncestors.every((suite, i) => suiteMatches(suite, targetAncestors[i]));

function isSourceRegisteredAssertion(titles, assertion) {
  if (titles.tests.some(test => test.title !== null && !test.forbidden.length && sameTest(test, assertion))) {
    return true;
  }
  return titles.templates.some(test => !test.forbidden.length
    && sameTest({ title: assertion.title, ancestors: test.ancestors }, assertion)
    && matchesTemplate(assertion.title, test.template));
}

function isConfinedRelative(root, file) {
  if (!isText(file) || isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) || file.includes('\\')) return false;
  const rel = relative(root, resolve(root, file));
  if (rel === '' || rel.split(sep)[0] === '..' || isAbsolute(rel)) return false;
  return rel.split(sep).join('/') === file;
}

function checkTestFile(errors, root, where, file) {
  if (!isConfinedRelative(root, file)) {
    errors.push(`${where}: expected a canonical repository-relative test file, got ${file}`);
    return;
  }
  if (!isTestFile(file)) {
    errors.push(`${where}: expected a test file (*.test.*), got ${file}`);
    return;
  }
  if (!isFile(resolve(root, file))) errors.push(`${where}: missing file ${file}`);
}

function unquoteString(token) {
  if (!token || token.length < 2) return null;
  const quote = token[0];
  if ((quote !== '\'' && quote !== '"') || token.at(-1) !== quote) return null;
  return token.slice(1, -1).replace(/\\(.)/g, '$1');
}

function parseWorkloadsArray(source) {
  const parts = tokens(source);
  for (let i = 0; i + 4 < parts.length; i++) {
    if (parts[i] === 'export' && parts[i + 1] === 'const' && parts[i + 2] === 'WORKLOADS' && parts[i + 3] === '=' && parts[i + 4] === '[') {
      const workloads = new Set();
      let depth = 1;
      for (let j = i + 5; j < parts.length && depth > 0; j++) {
        const tok = parts[j];
        if (tok === '[') depth++;
        else if (tok === ']') depth--;
        else if (depth === 1) {
          const value = unquoteString(tok);
          if (value !== null) workloads.add(value);
        }
      }
      return depth === 0 ? workloads : null;
    }
  }
  return null;
}

function parseDispatchedWorkloads(source) {
  const parts = tokens(source);
  for (let i = 0; i + 3 < parts.length; i++) {
    if (parts[i] !== 'export' || parts[i + 1] !== 'function' || parts[i + 2] !== 'workloadParams' || parts[i + 3] !== '(') continue;
    let p = i + 4;
    let parens = 1;
    while (p < parts.length && parens > 0) {
      if (parts[p] === '(') parens++;
      else if (parts[p] === ')') parens--;
      p++;
    }
    if (parts[p] !== '{') return null;
    let fnDepth = 1;
    for (let j = p + 1; j < parts.length && fnDepth > 0; j++) {
      if (parts[j] === '{') fnDepth++;
      else if (parts[j] === '}') fnDepth--;
      else if (fnDepth === 1 && parts[j] === 'switch' && parts[j + 1] === '(' && parts[j + 2] === 'workload' && parts[j + 3] === ')' && parts[j + 4] === '{') {
        const dispatched = new Set();
        let swDepth = 0;
        for (let k = j + 5; k < parts.length; k++) {
          const tok = parts[k];
          if (tok === '{') swDepth++;
          else if (tok === '}') {
            if (swDepth === 0) return dispatched;
            swDepth--;
          } else if (swDepth === 0 && tok === 'case' && parts[k + 2] === ':') {
            const value = unquoteString(parts[k + 1]);
            if (value !== null) dispatched.add(value);
          }
        }
        return null;
      }
    }
  }
  return null;
}

function readBenchRegistry(root) {
  const runnerPath = resolve(root, 'bench/run.mjs');
  const refsPath = resolve(root, 'bench/lib/refs.mjs');
  if (!isFile(runnerPath)) return { error: 'missing benchmark runner bench/run.mjs', workloads: null, dispatched: null };
  if (!isFile(refsPath)) return { error: 'missing benchmark workload registry bench/lib/refs.mjs', workloads: null, dispatched: null };
  const workloads = parseWorkloadsArray(readFileSync(refsPath, 'utf8'));
  if (!workloads) return { error: 'could not read WORKLOADS registry from bench/lib/refs.mjs', workloads: null, dispatched: null };
  const dispatched = parseDispatchedWorkloads(readFileSync(runnerPath, 'utf8'));
  if (!dispatched) return { error: 'could not read workload dispatch switch from bench/run.mjs', workloads: null, dispatched: null };
  return { error: null, workloads, dispatched };
}

function readPackageExports(root) {
  const pkgPath = resolve(root, 'packages/axylo/package.json');
  if (!isFile(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!isRecord(pkg?.exports)) return null;
  const all = [];
  const optIn = [];
  for (const key of Object.keys(pkg.exports)) {
    if (key === '.') all.push('axylo');
    else if (key.startsWith('./') && key !== './axylo.css') {
      const name = `axylo/${key.slice(2)}`;
      all.push(name);
      optIn.push(name);
    }
  }
  return { all: new Set(all), optIn };
}

function textList(errors, where, value, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || !value.every(isText)) { errors.push(`${where} must be an array of non-empty strings`); return []; }
  if (nonEmpty && !value.length) errors.push(`${where} must not be empty`);
  const seen = new Set();
  for (const entry of value) { if (seen.has(entry)) errors.push(`${where} lists ${entry} twice`); seen.add(entry); }
  return value;
}

/**
 * Validates a test citation (`unit`, `property`, or `browser`) against the repository source scanner
 * (`titles.mjs`), refusing missing titles/prefixes, invalid templates, or `.fails`/`.todo`/`.skip` markers.
 */
export function validateTestCitation({ ref, where, sourceEntry, confirmations }) {
  const { kind, file, title, prefix, casePrefix, cases, atLeast, registration, ancestors, engine } = ref;
  if (!TEST_KINDS.includes(kind)) throw new Error(`unknown test citation kind: ${kind}`);
  if (engine !== undefined && kind !== 'browser') throw new Error('only browser evidence takes an engine');
  if (engine !== undefined && !ENGINES.includes(engine)) throw new Error(`unknown engine: ${engine} (expected ${ENGINES.join(', ')})`);
  if (kind === 'browser' && !browserFile(file)) throw new Error(`a browser citation names a file that is not a browser test (*.browser.test.*): ${file}`);
  if ((kind === 'unit' || kind === 'property') && browserFile(file)) throw new Error(`a ${kind} citation names a browser test file: ${file}`);
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
  sourceEntry.titles ??= readTitles(readFileSync(sourceEntry.path, 'utf8'), sourceEntry.path);
  if (atLeast !== undefined && !sourceEntry.titles.tests.some(test => test.title === null && inSuite(test.ancestors, prefix))) {
    throw new Error(`atLeast is for a suite whose cases the source scan cannot list; every case under ${prefix} in ${file} is known: cite the prefix alone`);
  }
  if (registration !== undefined && (!isText(title) || !isText(registration)
    || !sourceEntry.titles.templates.some(test => test.template === registration) || !matchesTemplate(title, registration))) {
    throw new Error(`invalid source registration for ${file}: ${title}`);
  }
  if (title && !registration && !sourceEntry.titles.tests.some(test => test.title === title)) {
    throw new Error(`missing test title in ${file}: ${title}`);
  }
  if (prefix && !sourceEntry.titles.suites.some(suite => suite.title !== null && suite.title.startsWith(prefix))) {
    throw new Error(`missing describe prefix in ${file}: ${prefix}`);
  }
  const registrations = prefix ? [
    ...sourceEntry.titles.tests.filter(test => inSuite(test.ancestors, prefix)
      && (!casePrefix || test.title?.startsWith(casePrefix))),
    ...sourceEntry.titles.templates.filter(test => {
      const leadingText = test.template.split('${')[0];
      return inSuite(test.ancestors, prefix)
        && (!casePrefix || casePrefix.startsWith(leadingText) || leadingText.startsWith(casePrefix));
    }),
  ] : [];
  if (casePrefix && !registrations.length) throw new Error(`missing case prefix in ${file}: ${casePrefix}`);
  const candidates = prefix
    ? [...sourceEntry.titles.suites.filter(suite => suite.title !== null && suite.title.startsWith(prefix)), ...registrations]
    : (registration ? sourceEntry.titles.templates.filter(test => test.template === registration)
      : sourceEntry.titles.tests.filter(test => test.title === title));
  const scoped = ancestors ? candidates.filter(test => ancestorsMatch(test.ancestors, ancestors)) : null;
  if (ancestors && !scoped.length) {
    throw new Error(`missing suite ancestors for ${file}: ${title} (${JSON.stringify(ancestors)})`);
  }
  const matchedCandidates = scoped ?? candidates;
  const forbidden = matchedCandidates.flatMap(candidate => candidate.forbidden);
  if (forbidden.length) throw new Error(`citation uses .${forbidden[0]} in ${file}: ${title ?? prefix}`);
  if (title) {
    const why = registration ? 'it matches a template only'
      : matchedCandidates.length && matchedCandidates.every(test => test.conditional) ? 'it is registered under a condition' : null;
    if (why) confirmations.push({ where, file, path: sourceEntry.path, title, why });
  }
}

/**
 * Evaluates a single test citation (`unit` | `property` | `browser`) against indexed assertion results
 * and suite failures. Dirty or inventory-excluded runs cannot grant positive passage while still surfacing failures.
 */
export function evaluateTestCitation(source, ref, {
  results, suiteFailures, stale, dirty = new Set(), unverified = new Set(), strict = false, requireExplicitEngine = false,
}) {
  const reasons = new Set();
  const reports = new Map();
  const engine = ref.kind === 'browser' ? ref.engine ?? 'chromium' : null;
  const sameEngine = test => engine === null || test.engine === engine;
  const sourceCandidates = ref.registration
    ? source.titles.templates.filter(test => test.template === ref.registration)
        .map(test => ({ title: ref.title, ancestors: test.ancestors, forbidden: test.forbidden }))
    : ref.title
      ? source.titles.tests.filter(test => test.title === ref.title)
      : source.titles.tests.filter(({ title, ancestors }) => inSuite(ancestors, ref.prefix) && (!ref.casePrefix || title?.startsWith(ref.casePrefix)));
  const known = ref.ancestors
    ? sourceCandidates.filter(candidate => !candidate.forbidden?.length && ancestorsMatch(candidate.ancestors, ref.ancestors))
        .map(() => ({ title: ref.title, ancestors: ref.ancestors }))
    : sourceCandidates;
  const expected = ref.atLeast ? known.filter(test => test.title !== null) : known;
  const templates = ref.prefix ? source.titles.templates.filter(test => !test.forbidden?.length && inSuite(test.ancestors, ref.prefix)) : [];
  const strictPrefixIdentity = Boolean(strict && ref.prefix
    && (!ref.atLeast || known.every(k => k.title !== null || templates.some(c => ancestorsMatch(c.ancestors, k.ancestors)))));
  const checkIdentity = Boolean(ref.casePrefix || strictPrefixIdentity);
  const isSourceBacked = test => expected.some(k => sameTest(k, test))
    || templates.some(candidate => sameTest({ title: test.title, ancestors: candidate.ancestors }, test)
      && matchesTemplate(test.title, candidate.template)
      && (!ref.casePrefix || test.title.startsWith(ref.casePrefix)));
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
    if (stale.has(test.file)) {
      if (!reports.has(test.file)) reports.set(test.file, new Set());
      reports.get(test.file).add('not recorded');
      reasons.add(`${basename(test.file)}: not recorded for this revision (${stale.get(test.file)})`);
      continue;
    }
    if (dirty.has(test.file)) {
      if (!reports.has(test.file)) reports.set(test.file, new Set());
      if (test.status === 'failed') {
        reports.get(test.file).add('fail');
      } else {
        reports.get(test.file).add('not recorded');
        reasons.add(`${basename(test.file)}: provenance records dirty: true; strict PERS requires a clean working tree`);
      }
      continue;
    }
    if (unverified.has(test.file)) {
      if (!reports.has(test.file)) reports.set(test.file, new Set());
      if (test.status === 'failed') {
        reports.get(test.file).add('fail');
      } else {
        reports.get(test.file).add('not recorded');
        reasons.add(`${basename(test.file)}: provenance is bound to matrix-only inventory; ${ref.file} is outside its hash scope`);
      }
      continue;
    }
    if (requireExplicitEngine && engine !== null && test.explicitEngine !== engine) {
      if (test.status === 'failed') {
        if (!reports.has(test.file)) reports.set(test.file, new Set());
        reports.get(test.file).add('fail');
      } else {
        reasons.add(`${basename(test.file)}: missing per-assertion meta.engine for ${engineLabel(engine)} in ${ref.file}`);
      }
      continue;
    }
    if (test.status !== 'passed' && test.status !== 'failed' && isText(test.meta?.notRun)) reasons.add(`Not run on ${test.meta.notRun}`);
    if (test.status === 'passed' && (!checkIdentity || isSourceBacked(test))) {
      passed.push(test);
    }
    if (!reports.has(test.file)) reports.set(test.file, new Set());
    reports.get(test.file).add(test.status === 'failed' ? 'fail' : test.status === 'passed' ? 'pass' : 'skipped');
  }
  const distinct = new Set(passed.map(test => testKey(test.ancestorTitles, test.title))).size;
  const current = [...reports.values()].filter(values => !values.has('not recorded'));
  const hasUnverifiedOnly = [...reports.keys()].some(file => unverified.has(file)) && !current.length;
  const status = current.some(values => values.has('fail')) ? 'fail'
    : known.length && distinct && (!ref.cases || distinct === ref.cases) && (!ref.atLeast || distinct >= ref.atLeast)
      && expected.every(k => passed.some(test => sameTest(k, test))) && current.every(values => !values.has('skipped')) ? 'pass'
      : (!hasUnverifiedOnly && [...reports.values()].some(values => values.has('not recorded'))) ? STALE : 'not run';
  if (status === 'not run') {
    const citation = `${ref.file}: ${ref.title ?? ref.prefix}${ref.casePrefix ? ` (${ref.casePrefix})` : ''}`;
    if (!known.length && ref.ancestors) {
      reasons.add(`No source registration matches ${citation} (${ref.ancestors.join(' > ')})`);
    } else if (ref.atLeast && distinct < ref.atLeast && current.length) {
      reasons.add(`${distinct} of at least ${ref.atLeast} cases passed for ${citation}`);
    } else if ((current.length || !reasons.size) && current.every(values => !values.has('skipped'))) {
      if (engine !== null && !reports.size && !reasons.size) reasons.add(`No ${engineLabel(engine)} result for ${citation}`);
      else if (ref.cases && distinct && distinct !== ref.cases) reasons.add(`Expected ${ref.cases} passing cases for ${citation}, found ${distinct}`);
      else if (!reasons.size || current.length) reasons.add(`No matching passing test for ${citation}`);
    } else if (current.some(values => values.has('skipped')) && !reasons.size) {
      reasons.add(`Matching test was skipped for ${citation}`);
    }
  }
  return { status, reports, reasons };
}

/**
 * Loads acceptance/journeys.json and refuses anything a reader could not follow: a missing, duplicated or
 * unknown journey, a kind outside PERS_KINDS/OPT_IN_FAMILIES, a matrix ID the matrix does not have, an
 * unknown test title/template/prefix in testCitations, missing manifest export coverage, or a cited file
 * that is not a canonical repository-relative test file or confined docs/rehearsal/benchmark artifact.
 */
export function readJourneys({ root, journeysFile = resolve(root, 'acceptance/journeys.json'), matrixIds }) {
  root = resolve(root);
  const known = new Set(matrixIds ?? JSON.parse(readFileSync(resolve(root, 'acceptance/matrix.json'), 'utf8')).map(row => row.id));
  const journeys = JSON.parse(readFileSync(journeysFile, 'utf8'));
  if (!Array.isArray(journeys)) throw new Error(`${journeysFile}: expected an array of journeys`);
  const errors = [];
  const ids = journeys.map(journey => isRecord(journey) ? journey.id : undefined);
  for (const id of JOURNEY_IDS) {
    const count = ids.filter(other => other === id).length;
    if (count === 0) errors.push(`missing journey: ${id}`);
    if (count > 1) errors.push(`duplicate journey: ${id}`);
  }
  for (const id of ids) if (!JOURNEY_IDS.includes(id)) errors.push(`unknown journey: ${JSON.stringify(id)}`);
  let bench = null;
  const pkgExports = readPackageExports(root);
  const docsPagesDir = resolve(root, 'apps/docs/pages');
  const rehearsalPromptsDir = resolve(root, 'rehearsal/prompts');
  const sources = new Map();
  const confirmations = [];
  for (const journey of journeys) {
    if (!isRecord(journey) || !JOURNEY_IDS.includes(journey.id)) continue;
    const at = field => `${journey.id}.${field}`;
    if (!isText(journey.title)) errors.push(`${at('title')} must be a non-empty string`);
    if (!isText(journey.owner)) errors.push(`${at('owner')} must name an owner`);
    if (journey.required !== undefined && typeof journey.required !== 'boolean') {
      errors.push(`${at('required')} must be a boolean`);
    }
    textList(errors, at('outcomeGuarantees'), journey.outcomeGuarantees, { nonEmpty: true });
    for (const kind of textList(errors, at('applicableKinds'), journey.applicableKinds, { nonEmpty: true })) {
      if (!ALL_PERS_KINDS.includes(kind)) errors.push(`${at('applicableKinds')}: unknown kind ${kind}`);
    }
    if (journey.entryPoints !== undefined || OPT_IN_JOURNEY_IDS.includes(journey.id)) {
      const entries = textList(errors, at('entryPoints'), journey.entryPoints ?? [], {
        nonEmpty: OPT_IN_JOURNEY_IDS.includes(journey.id),
      });
      if (pkgExports) {
        for (const ep of entries) {
          if (!pkgExports.all.has(ep)) errors.push(`${at('entryPoints')}: unknown package export ${ep}`);
        }
      }
    }
    for (const id of textList(errors, at('matrixIds'), journey.matrixIds)) {
      if (!known.has(id)) errors.push(`${at('matrixIds')}: unknown matrix ID ${id}`);
    }
    const testFiles = textList(errors, at('testFiles'), journey.testFiles);
    for (const file of testFiles) checkTestFile(errors, root, at('testFiles'), file);
    for (const page of textList(errors, at('screenshots'), journey.screenshots)) {
      if (!SAFE_SLUG.test(page)) {
        errors.push(`${at('screenshots')}: invalid docs page name ${page}`);
        continue;
      }
      if (!['md', 'html'].some(ext => isConfinedRelative(docsPagesDir, `${page}.${ext}`) && isFile(resolve(docsPagesDir, `${page}.${ext}`)))) {
        errors.push(`${at('screenshots')}: missing docs page apps/docs/pages/${page}.md`);
      }
    }
    const benchWorkloads = textList(errors, at('benchWorkloads'), journey.benchWorkloads);
    if (benchWorkloads.length) {
      bench ??= readBenchRegistry(root);
      if (bench.error) {
        errors.push(`${at('benchWorkloads')}: ${bench.error}`);
      } else {
        for (const workload of benchWorkloads) {
          if (!BENCH_WORKLOADS.includes(workload) || !bench.workloads.has(workload) || !bench.dispatched.has(workload)) {
            errors.push(`${at('benchWorkloads')}: unknown bench workload ${workload}`);
          }
        }
      }
    }
    for (const task of textList(errors, at('rehearsalTasks'), journey.rehearsalTasks)) {
      if (!SAFE_SLUG.test(task)) {
        errors.push(`${at('rehearsalTasks')}: invalid rehearsal task name ${task}`);
        continue;
      }
      if (!isConfinedRelative(rehearsalPromptsDir, `${task}.md`) || !isFile(resolve(rehearsalPromptsDir, `${task}.md`))) {
        errors.push(`${at('rehearsalTasks')}: missing rehearsal/prompts/${task}.md`);
      }
    }
    const automatedFiles = [];
    const evidence = journey.accessibilityEvidence;
    if (!isRecord(evidence)) errors.push(`${at('accessibilityEvidence')} must be an object`);
    else {
      // Automated entries are test files, so a claim of automated ARIA coverage always points at a runnable test.
      for (const file of textList(errors, at('accessibilityEvidence.automated'), evidence.automated)) {
        checkTestFile(errors, root, at('accessibilityEvidence.automated'), file);
        automatedFiles.push(file);
      }
      const manual = evidence.manualAt;
      if (!isRecord(manual)) errors.push(`${at('accessibilityEvidence.manualAt')} must be an object`);
      else {
        if (!MANUAL_AT_STATUSES.includes(manual.status)) errors.push(`${at('accessibilityEvidence.manualAt.status')}: unknown status ${JSON.stringify(manual.status)}`);
        const environments = textList(errors, at('accessibilityEvidence.manualAt.environments'), manual.environments);
        // A manual claim without the environments it covers (or still needs) cannot be repeated by anyone.
        if (manual.status !== 'not-applicable' && !environments.length) errors.push(`${at('accessibilityEvidence.manualAt.environments')} must name environments when status is ${manual.status}`);
        if (!isText(manual.protocolNote)) errors.push(`${at('accessibilityEvidence.manualAt.protocolNote')} must be a non-empty string`);
      }
    }
    const citedSet = new Set([...testFiles, ...automatedFiles]);
    const citations = journey.testCitations === undefined ? [] : journey.testCitations;
    if (!Array.isArray(citations)) {
      errors.push(`${at('testCitations')} must be an array`);
    } else {
      for (const [i, ref] of citations.entries()) {
        const where = `${at('testCitations')}[${i}]`;
        if (!isRecord(ref)) { errors.push(`${where} must be an object`); continue; }
        if (!isConfinedRelative(root, ref.file) || !isTestFile(ref.file) || !isFile(resolve(root, ref.file))) {
          checkTestFile(errors, root, `${where}.file`, ref.file);
          continue;
        }
        if (!citedSet.has(ref.file)) {
          errors.push(`${where}: file ${ref.file} must also be listed in testFiles or accessibilityEvidence.automated`);
          continue;
        }
        const abs = resolve(root, ref.file);
        if (!sources.has(abs)) sources.set(abs, { path: abs });
        try {
          validateTestCitation({ ref, where, sourceEntry: sources.get(abs), confirmations });
        } catch (error) {
          errors.push(`${where}: ${error.message}`);
        }
      }
    }
    const gaps = Array.isArray(journey.ownedGaps) ? journey.ownedGaps : (errors.push(`${at('ownedGaps')} must be an array`), []);
    for (const [i, gap] of gaps.entries()) {
      const where = `${at('ownedGaps')}[${i}]`;
      if (!isRecord(gap)) { errors.push(`${where} must be an object`); continue; }
      for (const field of ['id', 'reason', 'owner', 'targetCycle']) if (!isText(gap[field])) errors.push(`${where}.${field} must be a non-empty string`);
      for (const kind of textList(errors, `${where}.kinds`, gap.kinds, { nonEmpty: true })) {
        if (!ALL_PERS_KINDS.includes(kind)) errors.push(`${where}.kinds: unknown kind ${kind}`);
      }
    }
    if (!testFiles.length && !citations.length && !gaps.length) errors.push(`${journey.id}: no test files and no owned gap`);
    if (Array.isArray(journey.applicableKinds) && journey.applicableKinds.includes('histogram')
      && !testFiles.some(histogramFile)
      && !(Array.isArray(citations) && citations.some(ref => isText(ref?.file) && histogramFile(ref.file)))
      && !gaps.some(gap => Array.isArray(gap?.kinds) && gap.kinds.includes('histogram'))) {
      errors.push(`${journey.id}: histogram applies but no histogram test file or histogram gap is cited`);
    }
  }
  if (pkgExports) {
    const covered = new Set(journeys.flatMap(j => isRecord(j) && Array.isArray(j.entryPoints) ? j.entryPoints : []));
    for (const ep of pkgExports.optIn) {
      if (!covered.has(ep)) errors.push(`opt-in manifest export ${ep} is not covered by any journey entryPoints`);
    }
  }
  if (errors.length) throw new Error(`${journeysFile}: invalid journeys\n${errors.join('\n')}`);
  const ordered = JOURNEY_IDS.map(id => journeys.find(journey => journey.id === id));
  JOURNEY_META.set(ordered, { sources, confirmations });
  return ordered;
}

export function journeyScanMeta(journeys) {
  return JOURNEY_META.get(journeys) ?? { sources: new Map(), confirmations: [] };
}

/** How each matrix cell status counts in a journey's rollup. */
const BUCKET = {
  pass: 'pass', weak: 'weak', fail: 'fail', 'not run': 'notRun', 'no evidence': 'notRun',
  'not recorded for this revision': 'stale', 'cannot be verified here': 'waived', 'not applicable': 'na',
};

function scanCitedSource(root, file, existingSources) {
  if (!root) return null;
  const abs = resolve(root, file);
  if (existingSources.has(abs)) {
    const entry = existingSources.get(abs);
    if (!entry.titles && isFile(abs)) entry.titles = readTitles(readFileSync(abs, 'utf8'), abs);
    return entry;
  }
  if (!isFile(abs)) return null;
  const entry = { path: abs, titles: readTitles(readFileSync(abs, 'utf8'), abs) };
  existingSources.set(abs, entry);
  return entry;
}

/**
 * Rolls each journey up from check()'s structured rows, exact `testCitations`, and file-level execution.
 * In diagnostic mode (`strict = false`), blocks only on failing journeys or provenance errors.
 * In strict graduation mode (`strict = true`, via `--pers --release` or `--pers-strict`), blocks unless
 * clean provenance runs cover every cited file and exact assertion, all matrix cells pass, and zero gaps remain.
 */
export function evaluateJourneys({
  journeys,
  checkResult,
  runSources = new Map(),
  index = new Map(),
  suiteFailures = new Map(),
  sources = new Map(),
  root = null,
  strict = false,
}) {
  const rows = new Map(checkResult.rows.map(row => [row.id, row]));
  const runs = checkResult.runs ?? [];
  const stale = new Map(runs.filter(run => run.provenanceError).map(run => [run.file, run.provenanceError]));
  const dirtyRuns = new Set(runs.filter(run => run.provenance?.dirty).map(run => run.file));
  const matrixOnlyRuns = runs.filter(run => run.provenanceInventory === 'matrix-only' && !run.provenanceError);
  const mergedSources = new Map([...journeyScanMeta(journeys).sources, ...sources]);

  const globalBlockers = [];
  if (strict) {
    if (!runs.length) {
      globalBlockers.push({
        scope: 'provenance',
        code: 'no-runs',
        message: 'No Vitest result files supplied; strict PERS graduation requires current runs with clean provenance.',
      });
    } else {
      for (const run of runs) {
        const label = root ? relative(root, run.file).split(sep).join('/') : basename(run.file);
        if (run.provenanceError) {
          globalBlockers.push({
            scope: 'provenance',
            code: run.provenanceReadError ? 'malformed-provenance'
              : !run.provenance ? 'missing-provenance'
              : 'stale-provenance',
            file: label,
            message: `${label}: ${run.provenanceError}`,
          });
        } else if (!run.provenance) {
          globalBlockers.push({
            scope: 'provenance',
            code: 'missing-provenance',
            file: label,
            message: `${label}: strict PERS graduation requires recorded provenance (.provenance.json).`,
          });
        } else if (run.provenance.dirty !== false) {
          globalBlockers.push({
            scope: 'provenance',
            code: 'dirty-provenance',
            file: label,
            message: run.provenance.dirty === true
              ? `${label}: provenance records dirty: true; strict PERS graduation requires a clean working tree.`
              : `${label}: strict PERS graduation requires boolean dirty: false.`,
          });
        } else if (run.provenance.changedDuringRun !== false) {
          globalBlockers.push({
            scope: 'provenance',
            code: 'dirty-provenance',
            file: label,
            message: `${label}: strict PERS graduation requires boolean changedDuringRun: false.`,
          });
        }
      }
    }
  } else {
    for (const run of runs) {
      if (run.provenanceError) {
        const label = root ? relative(root, run.file).split(sep).join('/') : basename(run.file);
        globalBlockers.push({
          scope: 'provenance',
          code: run.provenanceReadError ? 'malformed-provenance' : 'stale-provenance',
          file: label,
          message: `${label}: ${run.provenanceError}`,
        });
      }
    }
  }

  const perFileRunStats = new Map();
  if (runs.length) {
    for (const run of runs) {
      const touched = runSources.get(run.file);
      if (!touched) continue;
      for (const relFile of touched) {
        if (!perFileRunStats.has(relFile)) perFileRunStats.set(relFile, []);
        perFileRunStats.get(relFile).push(run);
      }
    }
  }

  const evaluated = journeys.map(journey => {
    const required = journey.required !== false;
    const cells = { pass: 0, weak: 0, fail: 0, notRun: 0, stale: 0, waived: 0, na: 0 };
    const provenanceErrors = new Set();
    const failing = [];
    const seenFailing = new Set();
    const addFailure = entry => {
      if (seenFailing.has(entry)) return;
      seenFailing.add(entry);
      failing.push(entry);
    };
    const weakCells = [];
    const notRunCells = [];
    const waivedCells = [];
    const dirtyMatrixReports = new Set();
    let weakRun = 0;

    for (const id of journey.matrixIds) {
      const row = rows.get(id);
      if (!row) throw new Error(`${journey.id}: matrix ID ${id} is not in the check result`);
      for (const [type, cell] of Object.entries(row.cells)) {
        const bucket = BUCKET[cell.status];
        if (!bucket) throw new Error(`${journey.id}: unknown cell status ${cell.status} in ${id}/${type}`);
        cells[bucket]++;
        if (bucket === 'weak' && cell.reports.length) weakRun++;
        if (bucket === 'weak') weakCells.push(`${id}/${type}`);
        if (bucket === 'notRun') notRunCells.push(`${id}/${type}`);
        if (bucket === 'waived') waivedCells.push(`${id}/${type}`);
        if (bucket === 'fail' || bucket === 'stale') addFailure(`${id}/${type}: ${cell.status}`);
        for (const report of cell.reports) {
          if (report.provenanceError) provenanceErrors.add(`${report.label}: ${report.provenanceError}`);
          if (strict && report.file && runs.some(r => (root ? relative(root, r.file).split(sep).join('/') : basename(r.file)) === report.file && r.provenance?.dirty)) {
            dirtyMatrixReports.add(report.label);
          }
        }
      }
    }

    const testCitations = journey.testCitations ?? [];
    const citedFiles = new Set([
      ...journey.testFiles.map(normalizePath),
      ...journey.accessibilityEvidence.automated.map(normalizePath),
      ...testCitations.map(ref => normalizePath(ref.file)),
    ]);
    const testFailures = [];
    for (const run of runs) {
      const touched = runSources.get(run.file);
      if (run.provenanceError) {
        const runTouchesJourney = touched
          ? [...touched].some(source => citedFiles.has(source))
          : (run.failures ?? []).some(failure => citedFiles.has(normalizePath(failure.source ?? '')));
        if (runTouchesJourney) provenanceErrors.add(`${basename(run.file)}: ${run.provenanceError}`);
        continue;
      }
      for (const failure of run.failures ?? []) {
        const source = normalizePath(failure.source ?? '');
        if (!citedFiles.has(source)) continue;
        const detail = failure.test
          ? `${source}: ${failure.test}`
          : `${source}: ${failure.assertionFailed ? 'suite failed' : 'suite failed without assertion'}${failure.message ? ` (${failure.message})` : ''}`;
        if (!seenFailing.has(detail)) testFailures.push(detail);
        addFailure(detail);
      }
    }

    // Evaluate exact testCitations when present.
    const citationSummary = { total: testCitations.length, pass: 0, fail: 0, notRun: 0, stale: 0 };
    const unrunCitations = [];
    const citationsByFile = new Set();
    for (const ref of testCitations) {
      citationsByFile.add(normalizePath(ref.file));
      const sourceEntry = scanCitedSource(root, ref.file, mergedSources);
      if (!sourceEntry?.titles) {
        citationSummary.notRun++;
        unrunCitations.push({ file: ref.file, citation: ref.title ?? ref.prefix, reasons: ['Missing source scan for cited file'] });
        continue;
      }
      const outcome = evaluateTestCitation(sourceEntry, ref, {
        results: index,
        suiteFailures,
        stale,
        dirty: strict ? dirtyRuns : new Set(),
        unverified: new Set(
          matrixOnlyRuns
            .filter(run => !Object.hasOwn(run.provenance?.hashes ?? {}, normalizePath(ref.file)))
            .map(run => run.file),
        ),
        strict,
        requireExplicitEngine: strict && multiEngineBrowserFile(ref.file),
      });
      if (outcome.status === 'pass') {
        citationSummary.pass++;
      } else if (outcome.status === 'fail') {
        citationSummary.fail++;
        const detail = `${normalizePath(ref.file)}: ${ref.title ?? ref.prefix} failed`;
        if (!seenFailing.has(detail)) testFailures.push(detail);
        addFailure(detail);
      } else if (outcome.status === STALE) {
        citationSummary.stale++;
        for (const r of outcome.reasons) provenanceErrors.add(r);
        addFailure(`${normalizePath(ref.file)}: ${ref.title ?? ref.prefix} (${STALE})`);
      } else {
        citationSummary.notRun++;
        unrunCitations.push({
          file: ref.file,
          citation: `${ref.title ?? ref.prefix}${ref.casePrefix ? ` (${ref.casePrefix})` : ''}`,
          reasons: [...outcome.reasons].sort(),
        });
      }
    }

    // Check file-level execution for every cited test file when runs are supplied.
    const missingFiles = [];
    const emptyFiles = [];
    const unpassedFiles = [];
    const dirtyFiles = [];
    const inventoryExcludedFiles = [];
    let passedFilesCount = 0;
    if (runs.length) {
      for (const relFile of [...citedFiles].sort()) {
        const touchingRuns = perFileRunStats.get(relFile) ?? [];
        const nonStaleRuns = touchingRuns.filter(run => !run.provenanceError);
        const cleanRuns = nonStaleRuns.filter(run => !strict || (run.provenance && run.provenance.dirty === false && run.provenance.changedDuringRun === false));
        const validRuns = cleanRuns.filter(run => run.provenanceInventory !== 'matrix-only' || Object.hasOwn(run.provenance?.hashes ?? {}, relFile));
        if (!validRuns.length) {
          if (nonStaleRuns.some(run => run.provenance && (run.provenance.dirty !== false || run.provenance.changedDuringRun !== false)) && strict) {
            dirtyFiles.push(relFile);
          } else if (cleanRuns.some(run => run.provenanceInventory === 'matrix-only' && !Object.hasOwn(run.provenance?.hashes ?? {}, relFile))) {
            inventoryExcludedFiles.push(relFile);
          } else {
            missingFiles.push(relFile);
          }
          continue;
        }
        if (!root && !index.size) {
          // Synthetic evaluateJourneys unit calls that supply only runSources without index.
          passedFilesCount++;
          continue;
        }
        const sourceEntry = root ? scanCitedSource(root, relFile, mergedSources) : null;
        const abs = root ? resolve(root, relFile) : null;
        const allAssertions = abs ? (index.get(abs) ?? []) : [];
        const hasExactCitations = citationsByFile.has(relFile);
        const isBrowser = browserFile(relFile);
        const requireExplicit = strict && multiEngineBrowserFile(relFile);
        const runOutcomes = validRuns.map(run => {
          const runAssertions = allAssertions.filter(a => a.file === run.file);
          const hasSuiteFailure = abs ? Boolean(suiteFailures.get(abs)?.has(run.file)) : false;
          const validPassed = runAssertions.filter(a => a.status === 'passed'
            && (!sourceEntry?.titles || isSourceRegisteredAssertion(sourceEntry.titles, a))
            && (!isBrowser || (requireExplicit
              ? (a.explicitEngine !== null && a.explicitEngine !== undefined && ENGINES.includes(a.explicitEngine))
              : (a.engine !== null && ENGINES.includes(a.engine))))).length;
          const failed = runAssertions.filter(a => a.status === 'failed').length + (hasSuiteFailure ? 1 : 0);
          const skipped = runAssertions.filter(a => a.status !== 'passed' && a.status !== 'failed').length;
          return { total: runAssertions.length, hasSuiteFailure, passed: validPassed, failed, skipped };
        });
        if (runOutcomes.every(o => o.total === 0 && !o.hasSuiteFailure)) {
          emptyFiles.push(relFile);
        } else if (hasExactCitations) {
          if (runOutcomes.some(o => o.passed > 0 && o.failed === 0)) passedFilesCount++;
          else unpassedFiles.push(relFile);
        } else if (runOutcomes.some(o => o.passed > 0 && o.failed === 0 && o.skipped === 0)) {
          passedFilesCount++;
        } else {
          unpassedFiles.push(relFile);
        }
      }
    } else if (strict) {
      for (const relFile of [...citedFiles].sort()) missingFiles.push(relFile);
    }

    const blockers = [];
    if (provenanceErrors.size) {
      blockers.push({ code: 'provenance-error', message: [...provenanceErrors].sort().join('; ') });
    }
    if (testFailures.length || cells.fail > 0) {
      blockers.push({ code: 'failing-evidence', message: failing.join('; ') || `${cells.fail} failing matrix cell(s)` });
    }
    if (strict) {
      if (dirtyFiles.length || dirtyMatrixReports.size) {
        blockers.push({
          code: 'dirty-provenance',
          message: `Dirty provenance cannot satisfy strict PERS: ${[...dirtyFiles, ...dirtyMatrixReports].join(', ')}`,
        });
      }
      if (journey.ownedGaps.length) {
        blockers.push({
          code: 'open-gaps',
          message: `${journey.ownedGaps.length} open owned gap(s): ${journey.ownedGaps.map(g => `${g.id} (${g.owner} -> ${g.targetCycle})`).join(', ')}`,
        });
      }
      if (journey.accessibilityEvidence.manualAt.status === 'gap-open' && !journey.ownedGaps.length) {
        blockers.push({
          code: 'manual-at-open',
          message: `Manual assistive-technology status is gap-open (${journey.accessibilityEvidence.manualAt.environments.join(', ')})`,
        });
      }
      if (weakCells.length || notRunCells.length || waivedCells.length) {
        const parts = [];
        if (weakCells.length) parts.push(`weak: ${weakCells.join(', ')}`);
        if (notRunCells.length) parts.push(`not run: ${notRunCells.join(', ')}`);
        if (waivedCells.length) parts.push(`cannot verify: ${waivedCells.join(', ')}`);
        blockers.push({ code: 'matrix-incomplete', message: `Matrix cells not passing (${parts.join('; ')})` });
      }
      if (unrunCitations.length) {
        blockers.push({
          code: 'unrun-citations',
          message: unrunCitations.map(u => `${u.file}: ${u.citation}${u.reasons.length ? ` (${u.reasons.join(', ')})` : ''}`).join('; '),
        });
      }
      if (missingFiles.length) {
        blockers.push({
          code: 'missing-test-files',
          message: `Cited test file(s) not executed in current clean runs: ${missingFiles.join(', ')}`,
        });
      }
      if (emptyFiles.length) {
        blockers.push({
          code: 'empty-test-suites',
          message: `Cited test suite(s) reported 0 assertions: ${emptyFiles.join(', ')}`,
        });
      }
      if (unpassedFiles.length) {
        blockers.push({
          code: 'unpassed-test-files',
          message: `Cited test file(s) had skipped or non-passing assertions: ${unpassedFiles.join(', ')}`,
        });
      }
    }

    const histogramApplies = journey.applicableKinds.includes('histogram');
    const histogramGaps = journey.ownedGaps.filter(gap => gap.kinds.includes('histogram')).map(gap => gap.id);
    const histogramTests = [...new Set([
      ...journey.testFiles.filter(histogramFile),
      ...testCitations.filter(ref => histogramFile(ref.file)).map(ref => ref.file),
    ])];
    const histogramCited = histogramApplies && (histogramTests.length > 0 || histogramGaps.length > 0);

    const hasMatrix = journey.matrixIds.length > 0;
    const hasCitations = testCitations.length > 0;
    const matrixClean = !hasMatrix || (cells.pass > 0 && !cells.weak && !cells.notRun && !cells.stale && !cells.fail && (!strict || !cells.waived));
    const citationsClean = !hasCitations || (citationSummary.pass === citationSummary.total && citationSummary.total > 0);
    const filesClean = !runs.length ? false : (missingFiles.length === 0 && emptyFiles.length === 0 && unpassedFiles.length === 0 && dirtyFiles.length === 0 && inventoryExcludedFiles.length === 0);

    let status;
    if (cells.fail || cells.stale || testFailures.length || provenanceErrors.size || citationSummary.fail || citationSummary.stale) {
      status = 'fail';
    } else if (strict) {
      if (blockers.length === 0 && matrixClean && citationsClean && filesClean && !journey.ownedGaps.length) {
        status = 'pass';
      } else if (cells.pass || weakRun || citationSummary.pass || passedFilesCount > 0) {
        status = 'weak';
      } else {
        status = 'not run';
      }
    } else {
      const diagnosticMatrixOk = !hasMatrix || (cells.pass > 0 && !cells.weak && !cells.notRun);
      const diagnosticDirectOk = (!hasCitations || citationSummary.pass === citationSummary.total)
        && ((hasMatrix || hasCitations) ? true : (citedFiles.size > 0 && filesClean));
      if (diagnosticMatrixOk && diagnosticDirectOk && (hasMatrix || hasCitations || passedFilesCount > 0)) {
        status = journey.ownedGaps.length ? 'weak' : 'pass';
      } else if (cells.pass || weakRun || citationSummary.pass || passedFilesCount > 0) {
        status = 'weak';
      } else {
        status = 'not run';
      }
    }

    return {
      id: journey.id,
      title: journey.title,
      owner: journey.owner,
      required,
      entryPoints: journey.entryPoints ?? [],
      applicableKinds: journey.applicableKinds,
      matrixIds: journey.matrixIds,
      testFiles: journey.testFiles,
      testCitations,
      citationSummary,
      unrunCitations,
      missingFiles,
      emptyFiles,
      unpassedFiles,
      dirtyFiles,
      inventoryExcludedFiles,
      cells,
      failing,
      testFailures,
      provenanceErrors: [...provenanceErrors].sort(),
      blockers,
      histogramApplies,
      histogramCited,
      histogramTests,
      histogramGaps,
      accessibility: { automated: journey.accessibilityEvidence.automated, manualAt: journey.accessibilityEvidence.manualAt },
      ownedGaps: journey.ownedGaps,
      status,
    };
  });

  const blockers = [...globalBlockers];
  for (const journey of evaluated) {
    if (strict && journey.required && journey.status !== 'pass' && !journey.blockers.length) {
      blockers.push({
        scope: 'journey',
        code: 'journey-not-passing',
        journeyId: journey.id,
        message: `${journey.id}: status is ${journey.status} (graduation requires pass)`,
      });
    }
    for (const blocker of journey.blockers) {
      if (!strict && blocker.code !== 'failing-evidence' && blocker.code !== 'provenance-error') continue;
      blockers.push({
        scope: 'journey',
        code: blocker.code,
        journeyId: journey.id,
        message: `${journey.id}: ${blocker.message}`,
      });
    }
  }

  const summary = { journeys: evaluated.length, pass: 0, weak: 0, fail: 0, 'not run': 0 };
  for (const journey of evaluated) summary[journey.status]++;
  summary.histogramApplicable = evaluated.filter(journey => journey.histogramApplies).length;
  summary.histogramTestBacked = evaluated.filter(journey => journey.histogramApplies && journey.histogramTests.length > 0).length;
  summary.histogramGapOnly = summary.histogramApplicable - summary.histogramTestBacked;
  summary.optInJourneys = evaluated.filter(journey => OPT_IN_JOURNEY_IDS.includes(journey.id)).length;
  summary.openManualAt = evaluated.filter(journey => journey.accessibility.manualAt.status === 'gap-open').length;
  summary.ownedGaps = evaluated.reduce((total, journey) => total + journey.ownedGaps.length, 0);

  const blocked = strict
    ? (blockers.length > 0 || evaluated.some(journey => journey.required && journey.status !== 'pass'))
    : (evaluated.some(journey => journey.status === 'fail') || runs.some(run => run.provenanceError));

  return {
    mode: strict ? 'strict' : 'diagnostic',
    strict,
    journeys: evaluated,
    summary,
    blockers,
    blocked,
    matrixOnlyRuns: matrixOnlyRuns.map(run => ({
      file: root ? relative(root, run.file).split(sep).join('/') : basename(run.file),
      hashedFiles: Object.keys(run.provenance?.hashes ?? {}).length,
    })),
  };
}

const cell = value => String(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');

export function renderJourneysMarkdown({ journeys, summary, blocked, blockers = [], strict = false, releaseBlocked = false, matrixOnlyRuns = [] }) {
  const kinds = journey => journey.applicableKinds.map(kind => kind === 'histogram'
    ? `**histogram**${journey.histogramTests.length ? '' : ' (gap only)'}` : kind).join(', ');
  const modeNote = strict ? ' · strict graduation' : '';
  const statusTag = blocked
    ? ' · **blocked**'
    : releaseBlocked
      ? ` · **${strict ? 'PERS graduation passed' : 'PERS diagnostic passed'}; overall release blocked by matrix rules**`
      : strict
        ? ' · **graduation passed**'
        : '';
  const lines = [
    `## Product Experience Regression Suite (${summary.journeys} journeys${modeNote})`, '',
    `${summary.pass} pass · ${summary.weak} weak · ${summary.fail} fail · ${summary['not run']} not run · `
    + `${summary.histogramApplicable} histogram-applicable (${summary.histogramTestBacked} test-backed, ${summary.histogramGapOnly} gap-only) · `
    + `${summary.openManualAt} with manual AT open · ${summary.ownedGaps} owned gaps`
    + statusTag, '',
    ...(matrixOnlyRuns.length ? [
      `Legacy matrix-only provenance accepted in diagnostic mode for ${matrixOnlyRuns.map(r => `\`${r.file}\` (${r.hashedFiles} matrix-cited hashes)`).join(', ')}; evidence is bound to that matrix-only inventory and grants no strict credit or unhashed journey-file pass.`,
      '',
    ] : []),
    'Matrix counts are cells of the linked criteria across the matrix chart types; histogram has no matrix column and is cited by exact test assertions or owned gaps, and J13–J16 cover Axylo 4 opt-in entry points directly. '
    + 'Automated ARIA counts test files that check names, roles, the AX tree or axe-core; manual AT is real assistive technology.', '',
    '| Journey | Owner | Kinds | Matrix Pass/Weak/Fail | Auto ARIA vs Manual AT | Owned Gaps | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...journeys.map(journey => `| ${[
      `${journey.id} — ${journey.title}`, journey.owner, kinds(journey),
      journey.matrixIds.length
        ? `${journey.cells.pass}/${journey.cells.weak}/${journey.cells.fail} (not run ${journey.cells.notRun}, stale ${journey.cells.stale})`
        : `direct (${journey.citationSummary.pass}/${journey.citationSummary.total} citations)`,
      `${journey.accessibility.automated.length} automated · manual ${journey.accessibility.manualAt.status}`,
      journey.ownedGaps.length ? journey.ownedGaps.map(gap => gap.id).join(', ') : '—', journey.status,
    ].map(cell).join(' | ')} |`), ''];
  if (blockers.length) {
    lines.push(strict ? '### Graduation blockers' : '### Blocking reasons', '');
    for (const blocker of blockers) {
      lines.push(`- **${blocker.scope === 'provenance' ? 'provenance' : blocker.journeyId}** (\`${blocker.code}\`) · ${cell(blocker.message)}`);
    }
    lines.push('');
  }
  const failing = journeys.filter(journey => journey.failing.length || journey.provenanceErrors.length);
  if (failing.length) {
    lines.push('### Failing journey evidence', '');
    for (const journey of failing) lines.push(`- **${journey.id}** · ${[...journey.failing, ...journey.provenanceErrors].map(cell).join('; ')}`);
    lines.push('');
  }
  lines.push('### Owned gap ledger', '');
  for (const journey of journeys) for (const gap of journey.ownedGaps) {
    lines.push(`- **${journey.id}** · \`${gap.id}\` (${gap.kinds.join(', ')}) · ${gap.owner} → ${gap.targetCycle}: ${cell(gap.reason)}`);
  }
  lines.push('');
  return lines.join('\n');
}
