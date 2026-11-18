import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTitles } from './titles.mjs';

const chartTypes = ['line', 'area', 'bar', 'scatter', 'donut', 'compact'];
const statuses = ['pass', 'fail', 'no evidence', 'not run', 'cannot be verified here', 'not applicable'];
const testKinds = ['unit', 'property', 'browser'];
const otherKinds = ['benchmark', 'document', 'manual rehearsal'];
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
  for (const line of spec.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+(\d+(?:\.\d+)?)\.?\s/.exec(line);
    if (heading) {
      section = heading[1];
      columns = undefined;
    }
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    if (['3.1', '3.2', '3.3', '3.4', '3.7', '4', '5'].includes(section)) {
      const id = /^\|\s*([A-Z]+\d+)\s*\|/.exec(line)?.[1];
      if (id) add(id);
    }
    if (section !== '3.6') continue;
    const [label, ...values] = tableCells(line);
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
  return entries;
}

function readMatrix(root, file, expected) {
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
    const { kind, file, title, prefix, reason, workload, history } = reference;
    if (![...testKinds, ...otherKinds].includes(kind)) throw new Error(`unknown evidence kind: ${kind}`);
    if (weak && !isText(reason)) throw new Error('weak evidence needs a reason');
    const entry = source(file);
    if (testKinds.includes(kind)) {
      if (!(isText(title) && prefix === undefined) && !(isText(prefix) && title === undefined)) {
        throw new Error('specify exactly one test title or describe prefix');
      }
      entry.titles ??= readTitles(readFileSync(entry.path, 'utf8'), entry.path);
      if (title && !entry.titles.tests.some(test => test.title === title)) {
        throw new Error(`missing test title in ${file}: ${title}`);
      }
      if (prefix && !entry.titles.suites.some(suite => suite.startsWith(prefix))) {
        throw new Error(`missing describe prefix in ${file}: ${prefix}`);
      }
    } else if (title !== undefined || prefix !== undefined) {
      throw new Error('only test evidence takes a title or prefix');
    }
    if (kind === 'benchmark' && !isText(workload)) throw new Error('benchmark evidence needs a workload');
    if (history !== undefined) {
      if (kind !== 'benchmark' || !Array.isArray(history)) throw new Error('only benchmark evidence takes a history array');
      for (const path of history) source(path);
    }
  }
  for (const row of matrix) {
    const { id, statement, appliesTo, notApplicable, evidence = {}, weak = {}, cannotVerify = {}, pending = {} } = row ?? {};
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
    for (const [key, mapping] of Object.entries({ evidence, weak, cannotVerify, pending })) {
      if (!isRecord(mapping)) {
        errors.push(`${id}: expected a chart-type map for ${key}`);
        continue;
      }
      for (const [type, value] of Object.entries(mapping)) {
        if (!appliesTo.includes(type)) errors.push(`${id}/${type}: ${key} requires an applicable type`);
        if (key === 'cannotVerify' || key === 'pending') {
          if (!isText(value)) errors.push(`${id}/${type}: ${key} needs a reason`);
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
  for (const id of expected.keys()) if (!seen.has(id)) errors.push(`missing criterion ID: ${id}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return { matrix, sources };
}

function readResults(root, files, sources) {
  const index = new Map();
  const runs = [];
  const paths = [...sources.keys()].map(path => [relative(root, path).split(sep).join('/'), path]);
  for (const file of files) {
    const { testResults } = json(file);
    if (!Array.isArray(testResults)) throw new Error(`${file}: expected Vitest JSON testResults`);
    const failures = [];
    let passed = 0;
    for (const suite of testResults) {
      if (!isText(suite?.name) || !Array.isArray(suite.assertionResults)) {
        throw new Error(`${file}: expected a test file name and assertionResults`);
      }
      const name = suite.name.replaceAll('\\', '/');
      const local = resolve(root, name);
      // Keep the repository-relative suffix when a report was produced from another checkout.
      const matches = sources.has(local) ? [local] : paths.filter(([relativePath]) => relativePath.includes('/')
        && name.endsWith('/' + relativePath)).map(([, path]) => path);
      if (matches.length > 1) throw new Error(`${file}: ambiguous report path ${suite.name}`);
      const [path] = matches;
      if (path && !index.has(path)) index.set(path, []);
      const source = relative(root, path ?? local);
      let failed = false;
      for (const test of suite.assertionResults) {
        if (!isText(test?.title) || !isText(test.status) || !Array.isArray(test.ancestorTitles) || !test.ancestorTitles.every(isText)) {
          throw new Error(`${file}: expected assertion title, status and ancestorTitles in ${suite.name}`);
        }
        if (path) index.get(path).push(test);
        if (test.status === 'passed') passed++;
        if (test.status === 'failed') {
          failures.push({ source, test: test.title });
          failed = true;
        }
      }
      if (suite.status === 'failed' && !failed) failures.push({ source });
    }
    runs.push({ file, passed, failures });
  }
  return { index, runs };
}

function resultFor(source, reference, results) {
  if (!testKinds.includes(reference.kind)) return 'not run';
  const expected = source.titles.tests.filter(({ title, ancestors }) => reference.title
    ? title === reference.title
    : ancestors.some(suite => suite.startsWith(reference.prefix)));
  const observed = results.get(source.path) ?? [];
  const matching = observed.filter(({ title, ancestorTitles }) => reference.title
    ? title === reference.title
    : ancestorTitles.some(suite => suite.startsWith(reference.prefix)));
  if (matching.some(test => test.status === 'failed')) return 'fail';
  const passed = new Set(matching.filter(test => test.status === 'passed').map(test => JSON.stringify([test.ancestorTitles, test.title])));
  return expected.length && expected.every(test => passed.has(JSON.stringify([test.ancestors, test.title])))
    ? 'pass' : 'not run';
}

function statusFor(row, type, root, sources, results) {
  if (!row.appliesTo.includes(type)) return 'not applicable';
  const refs = row.evidence?.[type] ?? [];
  const outcomes = refs.map(ref => resultFor(sources.get(resolve(root, ref.file)), ref, results));
  if (outcomes.includes('fail')) return 'fail';
  if (row.cannotVerify?.[type]) return 'cannot be verified here';
  if (row.pending?.[type]) return 'not run';
  if (!outcomes.length) return 'no evidence';
  return outcomes.every(outcome => outcome === 'pass') ? 'pass' : 'not run';
}

const escapeCell = value => value.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const label = value => value.replace(/[\\\[\]]/g, '\\$&');
const fileLink = (from, root, file) => `[${label(file)}](${relative(from, resolve(root, file)).split(sep).map(encodeURIComponent).join('/')})`;

function describeReference(ref, root, from) {
  const name = ref.title ?? (ref.prefix ? `describe prefix “${ref.prefix}”` : ref.workload);
  const history = ref.history?.length ? ` · measured history ${ref.history.map(file => fileLink(from, root, file)).join(', ')}` : '';
  return `${ref.kind} · ${fileLink(from, root, ref.file)}${name ? ` · ${label(name)}` : ''}${history}${ref.reason ? ` · ${ref.reason}` : ''}`;
}

function details(rows, root, from) {
  const gaps = [];
  const references = [];
  for (const { row, cells } of rows) {
    const missing = chartTypes.filter((type, i) => cells[i] === 'no evidence');
    const weak = Object.entries(row.weak ?? {});
    const group = entries => {
      const groups = new Map();
      for (const [type, value] of entries) {
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(type);
      }
      return [...groups].map(([value, types]) => `  - ${types.join(', ')} · ${value}`);
    };
    if (missing.length || weak.length) {
      gaps.push(`- **${row.id}** · ${row.statement}`);
      if (missing.length) gaps.push(`  - No evidence · ${missing.join(', ')}`);
      gaps.push(...group(weak.flatMap(([type, refs]) => refs.map(ref => [type, describeReference(ref, root, from)])))
        .map(line => line.replace(/^  - /, '  - Weak · ')));
    }
    references.push(`### ${row.id}`, '');
    references.push(...group([
      ...Object.entries(row.evidence ?? {}).flatMap(([type, refs]) => refs.map(ref => [type, describeReference(ref, root, from)])),
      ...Object.entries(row.cannotVerify ?? {}).map(([type, value]) => [type, `Cannot be verified here · ${value}`]),
      ...Object.entries(row.pending ?? {}).map(([type, value]) => [type, `Not run · ${value}`]),
      ...Object.entries(row.notApplicable).map(([type, value]) => [type, `Not applicable · ${value}`]),
    ]).map(line => line.slice(2)), '');
  }
  return ['## Coverage gaps in reader priority order', '', ...(gaps.length ? gaps : ['No coverage gaps recorded.']),
    '', '## Evidence and applicability', '', ...references].join('\n');
}

function describeRuns(runs, root) {
  if (!runs.length) return ['Static coverage only. No Vitest reports supplied.'];
  return ['## Supplied Vitest runs', '', 'Acceptance cell counts use required evidence only.', '',
    ...runs.flatMap(({ file, passed, failures }) => [
      `- \`${relative(root, file)}\` · ${passed} passed assertions, ${failures.length} reported failures`,
      ...failures.map(({ source, test }) => `  - \`${source}\` · ${test ? label(test) : 'Suite failed without a failing assertion result'}`),
    ]), ''];
}

export function check({ root, matrixFile = resolve(root, 'acceptance/matrix.json'), resultFiles = [], release = false }) {
  const expected = specIds(readFileSync(resolve(root, 'docs/02-product-spec.md'), 'utf8'));
  const { matrix, sources } = readMatrix(root, matrixFile, expected);
  const { index, runs } = readResults(root, resultFiles, sources);
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  const rows = matrix.map(row => ({
    row,
    cells: chartTypes.map(type => {
      const status = statusFor(row, type, root, sources, index);
      counts[status]++;
      return status;
    }),
  }));
  const header = ['Criterion', 'Statement', ...chartTypes];
  const printRow = cells => `| ${cells.map(escapeCell).join(' | ')} |`;
  const table = [printRow(header), printRow(header.map(() => '---')),
    ...rows.map(({ row, cells }) => printRow([row.id, row.statement, ...cells]))].join('\n');
  const summary = statuses.map(status => `- ${status} · ${counts[status]}`).join('\n');
  const from = resolve(root, 'acceptance');
  const report = ['# Acceptance report', '', ...describeRuns(runs, root), '', '## Status by chart type', '', summary, '', table, '',
    details(rows, root, from)].join('\n') + '\n';
  return { table, summary, report, counts, exitCode: release && (counts.fail || counts['no evidence']) ? 1 : 0 };
}

function main(args) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const resultFiles = [];
  let release = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--release') {
      release = true;
    } else if (args[i] === '--results') {
      const before = resultFiles.length;
      while (args[i + 1] && !args[i + 1].startsWith('--')) resultFiles.push(resolve(args[++i]));
      if (before === resultFiles.length) throw new Error('--results needs at least one Vitest JSON report');
    } else {
      throw new Error(`unknown argument ${args[i]} (usage: node acceptance/check.mjs [--results <file>…] [--release])`);
    }
  }
  const result = check({ root, resultFiles, release });
  writeFileSync(resolve(root, 'acceptance/report.md'), result.report);
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
