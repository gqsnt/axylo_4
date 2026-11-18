import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citedTestFiles, hashFile, snapshot } from './provenance.mjs';
import { matchesTemplate, readTitles } from './titles.mjs';

const chartTypes = ['line', 'area', 'bar', 'scatter', 'donut', 'compact'];
const statuses = ['pass', 'fail', 'weak', 'no evidence', 'not run', 'cannot be verified here', 'not applicable'];
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

function readMatrix(root, file, { entries: expected, diagnosticCodes }) {
  const matrix = json(file);
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
  function checkReference(reference, weak) {
    if (!isRecord(reference)) throw new Error('expected an evidence object');
    const { kind, file, title, prefix, registration, ancestors, reason, workload, history, entries } = reference;
    if (![...testKinds, ...otherKinds].includes(kind)) throw new Error(`unknown evidence kind: ${kind}`);
    if (weak && !isText(reason)) throw new Error('weak evidence needs a reason');
    const entry = source(file);
    if (testKinds.includes(kind)) {
      if (!(isText(title) && prefix === undefined) && !(isText(prefix) && title === undefined)) {
        throw new Error('specify exactly one test title or describe prefix');
      }
      if (ancestors !== undefined && (!isText(title) || !Array.isArray(ancestors) || !ancestors.every(isText))) {
        throw new Error('ancestors need an exact test title and an array of suite titles');
      }
      entry.titles ??= readTitles(readFileSync(entry.path, 'utf8'), entry.path);
      if (registration !== undefined && (!isText(title) || !isText(registration)
        || !entry.titles.templates.some(test => test.template === registration) || !matchesTemplate(title, registration))) {
        throw new Error(`invalid source registration for ${file}: ${title}`);
      }
      if (title && !registration && !entry.titles.tests.some(test => test.title === title)) {
        throw new Error(`missing test title in ${file}: ${title}`);
      }
      if (prefix && !entry.titles.suites.some(suite => suite.title.startsWith(prefix))) {
        throw new Error(`missing describe prefix in ${file}: ${prefix}`);
      }
      const candidates = prefix
        ? [...entry.titles.suites.filter(suite => suite.title.startsWith(prefix)),
          ...[...entry.titles.tests, ...entry.titles.templates].filter(test => test.ancestors.some(suite => suite.startsWith(prefix)))]
        : (registration ? entry.titles.templates.filter(test => test.template === registration)
          : entry.titles.tests.filter(test => test.title === title));
      const scoped = ancestors && candidates.filter(test => JSON.stringify(test.ancestors) === JSON.stringify(ancestors));
      const forbidden = (scoped?.length ? scoped : candidates).flatMap(candidate => candidate.forbidden);
      if (forbidden.length) throw new Error(`citation uses .${forbidden[0]} in ${file}: ${title ?? prefix}`);
    } else if (title !== undefined || prefix !== undefined || registration !== undefined || ancestors !== undefined) {
      throw new Error('only test evidence takes a title, prefix, registration or ancestors');
    }
    if (kind === 'size') {
      if (!Array.isArray(entries) || !entries.length || !entries.every(isText) || new Set(entries).size !== entries.length) {
        throw new Error('size evidence needs distinct measured entry names');
      }
      entry.size ??= readSize(entry.path);
      for (const name of entries) if (entry.size.get(name)?.targetKiB == null) {
        throw new Error(`missing size target in ${file}: ${name}`);
      }
    }
    if (kind === 'benchmark' && !isText(workload)) throw new Error('benchmark evidence needs a workload');
    if (history !== undefined) {
      if (kind !== 'benchmark' || !Array.isArray(history)) throw new Error('only benchmark evidence takes a history array');
      for (const path of history) source(path);
    }
  }
  for (const row of matrix) {
    const { id, statement, appliesTo, notApplicable, evidence = {}, weak = {}, gaps = {}, cannotVerify = {}, pending = {}, waivers = {} } = row ?? {};
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
    for (const [key, mapping] of Object.entries({ evidence, weak, gaps, cannotVerify, pending, waivers })) {
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
        if (key === 'cannotVerify' || key === 'pending' || key === 'gaps') {
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
            checkReference(reference, key === 'weak');
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
  return { matrix, sources };
}

function readSize(file) {
  const { packed, rows } = json(file);
  if (!isText(packed?.axylo) || !isText(packed?.react) || !Array.isArray(rows)) {
    throw new Error(`${file}: expected packed size measurements`);
  }
  const entries = new Map();
  for (const { entry, minBytes, totalGzipBytes, targetKiB } of rows) {
    if (!isText(entry) || !Number.isSafeInteger(totalGzipBytes) || totalGzipBytes < 0
      || !Number.isSafeInteger(minBytes) || minBytes < 0
      || (targetKiB !== null && !(Number.isFinite(targetKiB) && targetKiB > 0)) || entries.has(entry)) {
      throw new Error(`${file}: invalid or duplicate size entry: ${entry}`);
    }
    entries.set(entry, { minBytes, totalGzipBytes, targetKiB });
  }
  return entries;
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
        if (path) index.get(path).push({ ...test, file });
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
          if (!suiteFailures.has(path)) suiteFailures.set(path, new Set());
          suiteFailures.get(path).add(file);
        }
      }
    }
    runs.push({ file, passed, skipped, failures, provenance });
  }
  return { index, runs, suiteFailures };
}

const testKey = (ancestors, title) => JSON.stringify([ancestors, title]);

function resultFor(source, ref, results, suiteFailures) {
  if (ref.kind === 'size') {
    const exceeded = ref.entries.some(name => {
      const { totalGzipBytes, targetKiB } = source.size.get(name);
      return totalGzipBytes > targetKiB * 1024;
    });
    const status = exceeded ? 'fail' : 'pass';
    return { status, reports: new Map([[source.path, new Set([status])]]) };
  }
  const reports = new Map();
  if (!testKinds.includes(ref.kind)) return { status: 'not run', reports };
  const expected = ref.ancestors ? [testKey(ref.ancestors, ref.title)] : ref.registration
    ? source.titles.templates.filter(test => test.template === ref.registration)
      .map(test => testKey(test.ancestors, ref.title))
    : source.titles.tests.filter(({ title, ancestors }) => ref.title
      ? title === ref.title : ancestors.some(suite => suite.startsWith(ref.prefix)))
      .map(({ ancestors, title }) => testKey(ancestors, title));
  const keys = new Set(expected);
  for (const file of suiteFailures.get(source.path) ?? []) reports.set(file, new Set(['fail']));
  const passed = new Set();
  for (const test of results.get(source.path) ?? []) {
    const key = testKey(test.ancestorTitles, test.title);
    const matches = ref.prefix ? test.ancestorTitles.some(suite => suite.startsWith(ref.prefix))
      : ref.ancestors ? keys.has(key) : test.title === ref.title;
    if (!matches) continue;
    if (test.status === 'passed') passed.add(key);
    if (!reports.has(test.file)) reports.set(test.file, new Set());
    reports.get(test.file).add(test.status === 'failed' ? 'fail' : test.status === 'passed' ? 'pass' : 'skipped');
  }
  const status = [...reports.values()].some(values => values.has('fail')) ? 'fail'
    : passed.size && expected.every(key => passed.has(key))
      && [...reports.values()].every(values => !values.has('skipped')) ? 'pass' : 'not run';
  return { status, reports };
}

function cellFor(row, type, root, sources, results, suiteFailures) {
  if (!row.appliesTo.includes(type)) return { status: 'not applicable', reports: new Map(), unrun: [] };
  const required = row.evidence?.[type] ?? [];
  const weak = row.weak?.[type] ?? [];
  const outcome = ref => resultFor(sources.get(resolve(root, ref.file)), ref, results, suiteFailures);
  const outcomes = required.map(outcome);
  const supporting = weak.map(outcome);
  let status;
  if ([...outcomes, ...supporting].some(result => result.status === 'fail')) status = 'fail';
  else if (row.cannotVerify?.[type]) status = 'cannot be verified here';
  else if (row.pending?.[type]) status = 'not run';
  else if (row.gaps?.[type] || (!required.length && weak.length)) status = 'weak';
  else if (!required.length) status = 'no evidence';
  else status = [...outcomes, ...supporting].every(result => result.status === 'pass') ? 'pass' : 'not run';

  const reports = new Map();
  for (const { reports: matches } of [...outcomes, ...supporting]) for (const [file, values] of matches) {
    if (!reports.has(file)) reports.set(file, new Set());
    for (const value of values) reports.get(file).add(value);
  }
  const unrun = [...required.filter((ref, i) => testKinds.includes(ref.kind) && outcomes[i].status === 'not run'),
    ...weak.filter((_, i) => testKinds.includes(weak[i].kind) && supporting[i].status === 'not run')];
  return { status, reports, unrun };
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

function readerDetails(rows, root, from) {
  const gaps = [];
  const limits = [];
  const unrun = new Map();
  for (const { row, cells } of rows) {
    const lines = [];
    const cellsOf = status => chartTypes.filter((_, i) => cells[i].status === status);
    const failures = cellsOf('fail');
    const missing = cellsOf('no evidence');
    if (failures.length) lines.push(`Fail · ${failures.join(', ')}`);
    if (missing.length) lines.push(`No evidence · ${missing.join(', ')} · ${row.statement}`);
    lines.push(...groupTypes(Object.entries(row.gaps ?? {})).map(note => `Weak · ${note}`));
    const remaining = Object.entries(row.weak ?? {}).filter(([type]) => cellsOf('weak').includes(type) && !row.gaps?.[type]);
    lines.push(...groupTypes(remaining.flatMap(([type, refs]) => refs.map(ref => [type, ref.reason]))).map(note => `Weak · ${note}`));
    lines.push(...groupTypes(Object.entries(row.pending ?? {})).map(note => `Pending · ${note}`));
    if (lines.length) gaps.push(`- **${row.id}** · ${lines.join('\n  - ')}`);
    for (const [type, waiver] of Object.entries(row.waivers ?? {})) {
      gaps.push(`- **${row.id}/${type}** · Waiver granted by ${waiver.grantedBy} · ${waiver.reason}`);
    }
    const environment = groupTypes(Object.entries(row.cannotVerify ?? {}));
    if (environment.length) limits.push(`- **${row.id}** · ${environment.join('\n  - ')}`);
    for (const [i, cell] of cells.entries()) {
      for (const ref of cell.unrun) {
        if (!unrun.has(ref.file)) unrun.set(ref.file, new Set());
        unrun.get(ref.file).add(`${row.id}/${chartTypes[i]}`);
      }
    }
  }
  if (rows.some(({ row }) => row.id === 'P1')) {
    limits.push(`- **GPU** · Hardware rasterization needs a headed, GPU-backed run. Archived headless Chrome renderer comparisons cannot establish GPU performance. ${fileLink(from, root, 'docs/decisions/0002-mark-renderer.md')}`);
  }
  return ['## Coverage gaps in reader priority order', '', ...(gaps.length ? gaps : ['No coverage gaps recorded.']), '',
    '## What cannot be verified here', '', ...(limits.length ? limits : ['No environment limits recorded.']), '',
    '## Evidence that exists but was not run for this report', '',
    ...(unrun.size ? ['These files have citations with missing or skipped assertions in the supplied results.', ''] : []),
    ...(unrun.size ? [...unrun].map(([file, cells]) => `- ${[...cells].join(', ')} · ${fileLink(from, root, file)}`)
      : ['Every required executable citation has a matching result. Unmeasured workloads appear in the gap list.']), ''].join('\n');
}

function describeProvenance(provenance) {
  if (!provenance) return 'missing';
  const changed = provenance.changedDuringRun ? ', working tree changed during run' : '';
  return `commit ${provenance.commit}, dirty ${provenance.dirty}, tree SHA-256 ${provenance.tree}, result SHA-256 ${provenance.resultSha256}, ${Object.keys(provenance.hashes ?? {}).length} cited test hashes in the sidecar${changed}`;
}

function describeRuns(runs, root) {
  if (!runs.length) return ['Static coverage only. No Vitest reports supplied.'];
  return ['## Supplied Vitest runs', '', 'Suite counts include assertions outside the matrix. Each cell lists the reports with matching assertions, including partial evidence in weak cells.', '',
    ...runs.flatMap(({ file, passed, skipped, failures, provenance, provenanceError }) => [
      `- \`${relative(root, file)}\` · ${passed} passed assertions, ${failures.length} reported failures${skipped ? `, ${skipped} skipped or pending` : ''}`,
      `  - Provenance: ${describeProvenance(provenance)}${provenanceError ? ' · ' + provenanceError : ''}`,
      ...failures.map(({ source, test, message, assertionFailed }) => `  - \`${source}\` · ${test ? label(test)
        : (assertionFailed ? 'Suite failed in addition to its failing assertions' : 'Suite failed without a failing assertion result')
          + (message ? ' (' + label(message) + ')' : '')}`),
    ]), ''];
}

function describeSizes(rows, root, sources, from) {
  const measurements = new Map();
  for (const { row } of rows) for (const refs of Object.values(row.evidence ?? {})) for (const ref of refs) {
    if (ref.kind === 'size') measurements.set(ref.file, sources.get(resolve(root, ref.file)).size);
  }
  return [...measurements].flatMap(([file, entries]) => [
    '## Packed size measurement', '',
    ...[...entries].map(([name, { minBytes, totalGzipBytes, targetKiB }]) =>
      `- ${name} · ${minBytes.toLocaleString('en-US')} minified JS bytes, ${(totalGzipBytes / 1024).toFixed(2)} KiB gzipped${targetKiB === null ? ''
        : `, ${targetKiB} KiB target`} · ${fileLink(from, root, file)}`), '',
  ]);
}

function uniqueReportLabel(file, files, root) {
  const name = file.split(sep).at(-1);
  return files.filter(candidate => candidate.split(sep).at(-1) === name).length === 1 ? name : relative(root, file);
}

export function check({ root, matrixFile = resolve(root, 'acceptance/matrix.json'), resultFiles = [], resultRoots = [], release = false }) {
  root = resolve(root);
  const expected = specIds(readFileSync(resolve(root, 'docs/02-product-spec.md'), 'utf8'));
  const { matrix, sources } = readMatrix(root, matrixFile, expected);
  const roots = resultRoots.map(path => resolve(root, path));
  const reports = [...new Set(resultFiles.map(file => resolve(file)))].sort();
  const { index, runs, suiteFailures } = readResults(root, roots, reports, sources);
  if (release && runs.length) {
    const current = runs.some(run => run.provenance) ? snapshot(root, citedTestFiles(matrix)) : null;
    for (const run of runs) {
      const recorded = run.provenance;
      if (!recorded) run.provenanceError = 'release requires recorded provenance';
      else if (recorded.changedDuringRun) run.provenanceError = 'release requires an unchanged working tree during the run';
      else if (recorded.commit !== current.commit || recorded.dirty !== current.dirty || recorded.tree !== current.tree
        || recorded.resultSha256 !== hashFile(run.file)
        || Object.keys(recorded.hashes ?? {}).length !== Object.keys(current.hashes).length
        || Object.entries(current.hashes).some(([file, hash]) => recorded.hashes?.[file] !== hash)) {
        run.provenanceError = 'provenance does not match the working tree';
      }
    }
  }
  const reportFiles = [...runs.map(run => run.file), ...[...sources.values()].filter(source => source.size).map(source => source.path)];
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  const rows = matrix.map(row => ({
    row,
    cells: chartTypes.map(type => {
      const cell = cellFor(row, type, root, sources, index, suiteFailures);
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
  const report = ['# Acceptance report', '', ...describeRuns(runs, root), ...describeSizes(rows, root, sources, from),
    '', '## Status by chart type', '', summary, '',
    'The matrix contains individual test citations and applicability reasons. ' + fileLink(from, root, relative(root, matrixFile)), '',
    table, '', readerDetails(rows, root, from)].join('\n') + '\n';
  const blocked = rows.some(({ row, cells }) => cells.some(({ status }, i) =>
    !['pass', 'not applicable'].includes(status)
    && (!['not run', 'cannot be verified here'].includes(status) || !row.waivers?.[chartTypes[i]])));
  return { table, summary, report, counts, runs, exitCode: release && (blocked || runs.some(run => run.provenanceError)) ? 1 : 0 };
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
