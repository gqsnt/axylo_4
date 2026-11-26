import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

/** The twelve product journeys of the Axylo 4 vision, in reading order. */
export const JOURNEY_IDS = Object.freeze(['first-impression', 'reading', 'hover', 'explore', 'compare', 'resize',
  'mobile-touch', 'keyboard', 'screen-reader', 'invalid-data', 'customization', 'live-data']);
/** PERS tracks histogram as its own kind even though the matrix has no histogram column yet. */
export const PERS_KINDS = Object.freeze(['line', 'area', 'bar', 'histogram', 'scatter', 'donut', 'compact']);
export const BENCH_WORKLOADS = Object.freeze(['first', 'page', 'compact', 'scatter', 'stream', 'theme', 'resize', 'hover', 'zoom', 'mem', 'lifecycle']);
export const MANUAL_AT_STATUSES = Object.freeze(['verified', 'waived-for-1.0', 'gap-open', 'not-applicable']);

const isText = value => typeof value === 'string' && value.trim() !== '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFile = path => statSync(path, { throwIfNoEntry: false })?.isFile() === true;
const histogramFile = file => /histogram/i.test(file);
const isTestFile = file => /\.test\.[cm]?[jt]sx?$/.test(file);
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const normalizePath = value => String(value).replaceAll('\\', '/').replace(/^\.\//, '');

function isConfinedRelative(root, file) {
  if (!isText(file) || isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) || file.includes('\\')) return false;
  const rel = relative(root, resolve(root, file));
  return rel !== '' && rel.split(sep)[0] !== '..' && !isAbsolute(rel);
}

function checkTestFile(errors, root, where, file) {
  if (!isConfinedRelative(root, file)) {
    errors.push(`${where}: expected a repository-relative test file, got ${file}`);
    return;
  }
  if (!isTestFile(file)) {
    errors.push(`${where}: expected a test file (*.test.*), got ${file}`);
    return;
  }
  if (!isFile(resolve(root, file))) errors.push(`${where}: missing file ${file}`);
}

function readBenchRegistry(root) {
  const runnerPath = resolve(root, 'bench/run.mjs');
  const refsPath = resolve(root, 'bench/lib/refs.mjs');
  if (!isFile(runnerPath)) return { error: 'missing benchmark runner bench/run.mjs', source: null, workloads: null };
  if (!isFile(refsPath)) return { error: 'missing benchmark workload registry bench/lib/refs.mjs', source: null, workloads: null };
  const source = readFileSync(runnerPath, 'utf8');
  const refs = readFileSync(refsPath, 'utf8');
  const match = /export\s+const\s+WORKLOADS\s*=\s*\[([^\]]+)\]/s.exec(refs);
  if (!match) return { error: 'could not read WORKLOADS registry from bench/lib/refs.mjs', source: null, workloads: null };
  const workloads = new Set([...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(entry => entry[1]));
  return { error: null, source, workloads };
}

function textList(errors, where, value, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || !value.every(isText)) { errors.push(`${where} must be an array of non-empty strings`); return []; }
  if (nonEmpty && !value.length) errors.push(`${where} must not be empty`);
  const seen = new Set();
  for (const entry of value) { if (seen.has(entry)) errors.push(`${where} lists ${entry} twice`); seen.add(entry); }
  return value;
}

/**
 * Loads acceptance/journeys.json and refuses anything a reader could not follow: a missing, duplicated or
 * unknown journey, a kind outside PERS_KINDS, a matrix ID the matrix does not have, or a cited file that is not
 * a repository-relative test file or confined docs/rehearsal/benchmark artifact. Every problem is collected so
 * one run names them all.
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
  const docsPagesDir = resolve(root, 'apps/docs/pages');
  const rehearsalPromptsDir = resolve(root, 'rehearsal/prompts');
  for (const journey of journeys) {
    if (!isRecord(journey) || !JOURNEY_IDS.includes(journey.id)) continue;
    const at = field => `${journey.id}.${field}`;
    if (!isText(journey.title)) errors.push(`${at('title')} must be a non-empty string`);
    if (!isText(journey.owner)) errors.push(`${at('owner')} must name an owner`);
    textList(errors, at('outcomeGuarantees'), journey.outcomeGuarantees, { nonEmpty: true });
    for (const kind of textList(errors, at('applicableKinds'), journey.applicableKinds, { nonEmpty: true })) {
      if (!PERS_KINDS.includes(kind)) errors.push(`${at('applicableKinds')}: unknown kind ${kind}`);
    }
    for (const id of textList(errors, at('matrixIds'), journey.matrixIds, { nonEmpty: true })) {
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
          if (!BENCH_WORKLOADS.includes(workload) || !bench.workloads.has(workload) || !bench.source.includes(`case '${workload}':`)) {
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
    const evidence = journey.accessibilityEvidence;
    if (!isRecord(evidence)) errors.push(`${at('accessibilityEvidence')} must be an object`);
    else {
      // Automated entries are test files, so a claim of automated ARIA coverage always points at a runnable test.
      for (const file of textList(errors, at('accessibilityEvidence.automated'), evidence.automated)) {
        checkTestFile(errors, root, at('accessibilityEvidence.automated'), file);
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
    const gaps = Array.isArray(journey.ownedGaps) ? journey.ownedGaps : (errors.push(`${at('ownedGaps')} must be an array`), []);
    for (const [i, gap] of gaps.entries()) {
      const where = `${at('ownedGaps')}[${i}]`;
      if (!isRecord(gap)) { errors.push(`${where} must be an object`); continue; }
      for (const field of ['id', 'reason', 'owner', 'targetCycle']) if (!isText(gap[field])) errors.push(`${where}.${field} must be a non-empty string`);
      for (const kind of textList(errors, `${where}.kinds`, gap.kinds, { nonEmpty: true })) {
        if (!PERS_KINDS.includes(kind)) errors.push(`${where}.kinds: unknown kind ${kind}`);
      }
    }
    if (!testFiles.length && !gaps.length) errors.push(`${journey.id}: no test files and no owned gap`);
    if (Array.isArray(journey.applicableKinds) && journey.applicableKinds.includes('histogram')
      && !testFiles.some(histogramFile) && !gaps.some(gap => Array.isArray(gap?.kinds) && gap.kinds.includes('histogram'))) {
      errors.push(`${journey.id}: histogram applies but no histogram test file or histogram gap is cited`);
    }
  }
  if (errors.length) throw new Error(`${journeysFile}: invalid journeys\n${errors.join('\n')}`);
  return JOURNEY_IDS.map(id => journeys.find(journey => journey.id === id));
}

/** How each matrix cell status counts in a journey's rollup. */
const BUCKET = {
  pass: 'pass', weak: 'weak', fail: 'fail', 'not run': 'notRun', 'no evidence': 'notRun',
  'not recorded for this revision': 'stale', 'cannot be verified here': 'waived', 'not applicable': 'na',
};

/**
 * Rolls each journey up from check()'s structured rows and reported test-file failures. A journey fails on any
 * failing or stale linked cell, any failing assertion or suite in a test file cited by the journey (even when
 * that file is outside acceptance/matrix.json), or any linked report whose provenance does not match this tree;
 * it passes only when its linked cells all pass (waived/na aside), no cited test file failed, and it owns no gap.
 */
export function evaluateJourneys({ journeys, checkResult, runSources }) {
  const rows = new Map(checkResult.rows.map(row => [row.id, row]));
  const runs = checkResult.runs ?? [];
  const evaluated = journeys.map(journey => {
    const cells = { pass: 0, weak: 0, fail: 0, notRun: 0, stale: 0, waived: 0, na: 0 };
    const provenanceErrors = new Set();
    const failing = [];
    const seenFailing = new Set();
    const addFailure = entry => {
      if (seenFailing.has(entry)) return;
      seenFailing.add(entry);
      failing.push(entry);
    };
    let weakRun = 0;
    for (const id of journey.matrixIds) {
      const row = rows.get(id);
      if (!row) throw new Error(`${journey.id}: matrix ID ${id} is not in the check result`);
      for (const [type, cell] of Object.entries(row.cells)) {
        const bucket = BUCKET[cell.status];
        if (!bucket) throw new Error(`${journey.id}: unknown cell status ${cell.status} in ${id}/${type}`);
        cells[bucket]++;
        // A weak citation with no report is only a static reference: it says nothing ran.
        if (bucket === 'weak' && cell.reports.length) weakRun++;
        if (bucket === 'fail' || bucket === 'stale') addFailure(`${id}/${type}: ${cell.status}`);
        for (const report of cell.reports) if (report.provenanceError) provenanceErrors.add(`${report.label}: ${report.provenanceError}`);
      }
    }
    const citedFiles = new Set([
      ...journey.testFiles.map(normalizePath),
      ...journey.accessibilityEvidence.automated.map(normalizePath),
    ]);
    const testFailures = [];
    for (const run of runs) {
      const touched = runSources?.get(run.file);
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
    const histogramApplies = journey.applicableKinds.includes('histogram');
    const histogramGaps = journey.ownedGaps.filter(gap => gap.kinds.includes('histogram')).map(gap => gap.id);
    const histogramTests = journey.testFiles.filter(histogramFile);
    const histogramCited = histogramApplies && (histogramTests.length > 0 || histogramGaps.length > 0);
    let status;
    if (cells.fail || cells.stale || testFailures.length || provenanceErrors.size) status = 'fail';
    else if (cells.pass && !cells.weak && !cells.notRun) status = journey.ownedGaps.length ? 'weak' : 'pass';
    else if (cells.pass || weakRun) status = 'weak';
    else status = 'not run';
    return {
      id: journey.id, title: journey.title, owner: journey.owner, applicableKinds: journey.applicableKinds,
      matrixIds: journey.matrixIds, testFiles: journey.testFiles, cells, failing, testFailures,
      provenanceErrors: [...provenanceErrors].sort(),
      histogramApplies, histogramCited, histogramTests, histogramGaps,
      accessibility: { automated: journey.accessibilityEvidence.automated, manualAt: journey.accessibilityEvidence.manualAt },
      ownedGaps: journey.ownedGaps, status,
    };
  });
  const summary = { journeys: evaluated.length, pass: 0, weak: 0, fail: 0, 'not run': 0 };
  for (const journey of evaluated) summary[journey.status]++;
  summary.histogramApplicable = evaluated.filter(journey => journey.histogramApplies).length;
  summary.histogramTestBacked = evaluated.filter(journey => journey.histogramApplies && journey.histogramTests.length > 0).length;
  summary.histogramGapOnly = summary.histogramApplicable - summary.histogramTestBacked;
  summary.openManualAt = evaluated.filter(journey => journey.accessibility.manualAt.status === 'gap-open').length;
  summary.ownedGaps = evaluated.reduce((total, journey) => total + journey.ownedGaps.length, 0);
  const blocked = evaluated.some(journey => journey.status === 'fail')
    || runs.some(run => run.provenanceError);
  return { journeys: evaluated, summary, blocked };
}

const cell = value => String(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');

export function renderJourneysMarkdown({ journeys, summary, blocked }) {
  const kinds = journey => journey.applicableKinds.map(kind => kind === 'histogram'
    ? `**histogram**${journey.histogramTests.length ? '' : ' (gap only)'}` : kind).join(', ');
  const lines = ['## Product Experience Regression Suite (12 journeys)', '',
    `${summary.pass} pass · ${summary.weak} weak · ${summary.fail} fail · ${summary['not run']} not run · `
    + `${summary.histogramApplicable} histogram-applicable (${summary.histogramTestBacked} test-backed, ${summary.histogramGapOnly} gap-only) · `
    + `${summary.openManualAt} with manual AT open · ${summary.ownedGaps} owned gaps`
    + (blocked ? ' · **blocked**' : ''), '',
    'Matrix counts are cells of the linked criteria across the matrix chart types; histogram has no matrix column and is cited by test file or owned gap. '
    + 'Automated ARIA counts test files that check names, roles, the AX tree or axe-core; manual AT is real assistive technology.', '',
    '| Journey | Owner | Kinds | Matrix Pass/Weak/Fail | Auto ARIA vs Manual AT | Owned Gaps | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...journeys.map(journey => `| ${[
      `${journey.id} — ${journey.title}`, journey.owner, kinds(journey),
      `${journey.cells.pass}/${journey.cells.weak}/${journey.cells.fail} (not run ${journey.cells.notRun}, stale ${journey.cells.stale})`,
      `${journey.accessibility.automated.length} automated · manual ${journey.accessibility.manualAt.status}`,
      journey.ownedGaps.length ? journey.ownedGaps.map(gap => gap.id).join(', ') : '—', journey.status,
    ].map(cell).join(' | ')} |`), ''];
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
