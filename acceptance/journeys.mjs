import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** The twelve product journeys of the Axylo 4 vision, in reading order. */
export const JOURNEY_IDS = Object.freeze(['first-impression', 'reading', 'hover', 'explore', 'compare', 'resize',
  'mobile-touch', 'keyboard', 'screen-reader', 'invalid-data', 'customization', 'live-data']);
/** PERS tracks histogram as its own kind even though the matrix has no histogram column yet. */
export const PERS_KINDS = Object.freeze(['line', 'area', 'bar', 'histogram', 'scatter', 'donut', 'compact']);
export const BENCH_WORKLOADS = Object.freeze(['first', 'page', 'compact', 'stream', 'zoom', 'resize', 'hover', 'mem', 'lifecycle']);
export const MANUAL_AT_STATUSES = Object.freeze(['verified', 'waived-for-1.0', 'gap-open', 'not-applicable']);

const isText = value => typeof value === 'string' && value.trim() !== '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFile = path => statSync(path, { throwIfNoEntry: false })?.isFile() === true;
const histogramFile = file => /histogram/i.test(file);

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
 * in the repository. Every problem is collected so one run names them all.
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
  const benchSource = isFile(resolve(root, 'bench/run.mjs')) ? readFileSync(resolve(root, 'bench/run.mjs'), 'utf8') : null;
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
    for (const file of testFiles) if (!isFile(resolve(root, file))) errors.push(`${at('testFiles')}: missing file ${file}`);
    for (const page of textList(errors, at('screenshots'), journey.screenshots)) {
      if (!['md', 'html'].some(ext => isFile(resolve(root, 'apps/docs/pages', `${page}.${ext}`)))) {
        errors.push(`${at('screenshots')}: missing docs page apps/docs/pages/${page}.md`);
      }
    }
    for (const workload of textList(errors, at('benchWorkloads'), journey.benchWorkloads)) {
      if (!BENCH_WORKLOADS.includes(workload) || (benchSource !== null && !benchSource.includes(`case '${workload}':`))) {
        errors.push(`${at('benchWorkloads')}: unknown bench workload ${workload}`);
      }
    }
    for (const task of textList(errors, at('rehearsalTasks'), journey.rehearsalTasks)) {
      if (!isFile(resolve(root, 'rehearsal/prompts', `${task}.md`))) errors.push(`${at('rehearsalTasks')}: missing rehearsal/prompts/${task}.md`);
    }
    const evidence = journey.accessibilityEvidence;
    if (!isRecord(evidence)) errors.push(`${at('accessibilityEvidence')} must be an object`);
    else {
      // Automated entries are test files, so a claim of automated ARIA coverage always points at a runnable test.
      for (const file of textList(errors, at('accessibilityEvidence.automated'), evidence.automated)) {
        if (!isFile(resolve(root, file))) errors.push(`${at('accessibilityEvidence.automated')}: missing file ${file}`);
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
 * Rolls each journey up from check()'s structured rows. A journey fails on any failing or stale linked cell or
 * any linked report whose provenance does not match this tree; it passes only when its linked cells all pass
 * (cells that cannot be verified here or do not apply aside) and it owns no gap.
 */
export function evaluateJourneys({ journeys, checkResult }) {
  const rows = new Map(checkResult.rows.map(row => [row.id, row]));
  const evaluated = journeys.map(journey => {
    const cells = { pass: 0, weak: 0, fail: 0, notRun: 0, stale: 0, waived: 0, na: 0 };
    const provenanceErrors = new Set();
    const failing = [];
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
        if (bucket === 'fail' || bucket === 'stale') failing.push(`${id}/${type}: ${cell.status}`);
        for (const report of cell.reports) if (report.provenanceError) provenanceErrors.add(`${report.label}: ${report.provenanceError}`);
      }
    }
    const histogramApplies = journey.applicableKinds.includes('histogram');
    const histogramGaps = journey.ownedGaps.filter(gap => gap.kinds.includes('histogram')).map(gap => gap.id);
    const histogramTests = journey.testFiles.filter(histogramFile);
    const histogramCited = histogramApplies && (histogramTests.length > 0 || histogramGaps.length > 0);
    let status;
    if (cells.fail || cells.stale || provenanceErrors.size) status = 'fail';
    else if (cells.pass && !cells.weak && !cells.notRun) status = journey.ownedGaps.length ? 'weak' : 'pass';
    else if (cells.pass || weakRun) status = 'weak';
    else status = 'not run';
    return {
      id: journey.id, title: journey.title, owner: journey.owner, applicableKinds: journey.applicableKinds,
      matrixIds: journey.matrixIds, testFiles: journey.testFiles, cells, failing, provenanceErrors: [...provenanceErrors].sort(),
      histogramApplies, histogramCited, histogramTests, histogramGaps,
      accessibility: { automated: journey.accessibilityEvidence.automated, manualAt: journey.accessibilityEvidence.manualAt },
      ownedGaps: journey.ownedGaps, status,
    };
  });
  const summary = { journeys: evaluated.length, pass: 0, weak: 0, fail: 0, 'not run': 0 };
  for (const journey of evaluated) summary[journey.status]++;
  summary.histogramJourneys = evaluated.filter(journey => journey.histogramApplies).length;
  summary.openManualAt = evaluated.filter(journey => journey.accessibility.manualAt.status === 'gap-open').length;
  summary.ownedGaps = evaluated.reduce((total, journey) => total + journey.ownedGaps.length, 0);
  const blocked = evaluated.some(journey => journey.status === 'fail')
    || checkResult.runs.some(run => run.provenanceError);
  return { journeys: evaluated, summary, blocked };
}

const cell = value => String(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');

export function renderJourneysMarkdown({ journeys, summary, blocked }) {
  const kinds = journey => journey.applicableKinds.map(kind => kind === 'histogram'
    ? `**histogram**${journey.histogramTests.length ? '' : ' (gap only)'}` : kind).join(', ');
  const lines = ['## Product Experience Regression Suite (12 journeys)', '',
    `${summary.pass} pass · ${summary.weak} weak · ${summary.fail} fail · ${summary['not run']} not run · `
    + `${summary.histogramJourneys} cover histogram · ${summary.openManualAt} with manual AT open · ${summary.ownedGaps} owned gaps`
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
