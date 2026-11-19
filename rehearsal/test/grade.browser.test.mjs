import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readJson, taskFiles, writeJson } from '../files.mjs';
import { grade } from '../grade.mjs';
import { effort, inputHashes, models, protocol } from '../protocol.mjs';
import { reauditRecords } from '../reaudit.mjs';
import { prepareWorkspace, removeWorkspace } from '../workspace.mjs';

const visits = `import { line } from 'axylo';
export default function render(element, data) {
  return line(element, { data, x: { field: 'day', type: 'date' }, y: 'visits', title: 'Daily visits' });
}`;

const sales = `import { bar } from 'axylo';
export default function render(element, data) {
  return bar(element, {
    data: data.toSorted((a, b) => a.quarter.localeCompare(b.quarter)), x: 'quarter', y: [
      { field: 'north', parse: 'number' },
      { field: 'central', parse: 'number' },
      { field: 'west', parse: 'number' },
    ], title: 'Quarterly sales by region',
  });
}`;

const signups = `import { line } from 'axylo';
export default function render(element, data) {
  return line(element, { data, x: 'day', y: { field: 'signpus', label: 'Signups' }, title: 'Daily signups' });
}`;

const revenue = `import { line } from 'axylo';
export default function render(element, data) {
  const rows = data.map(row => ({ ...row, revenue: Number(row.revenue) }));
  return line(element, { data: rows, x: { field: 'day', type: 'date' }, y: 'revenue', title: 'Daily store revenue' });
}`;

const LA = 'America/Los_Angeles';
const Tokyo = 'Asia/Tokyo';
let scratch;
let browser;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'axylo-rehearsal-browser-'));
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15000 });
});
afterAll(async () => {
  await browser?.close();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function answer(task, source) {
  const { workspace, runDirectory } = await prepareWorkspace(scratch, task);
  try {
    await writeFile(join(workspace, 'chart.js'), source);
    // Reuse Chrome while keeping a clean context for every input and time zone.
    return await grade(workspace, task, { launch: async () => ({
      newContext: options => browser.newContext(options), version: () => browser.version(),
      isConnected: () => browser.isConnected(), close: async () => {},
    }) });
  } finally {
    await removeWorkspace(runDirectory);
  }
}

it('re-audits a copied void and grades the restored answer in Chrome', async () => {
  const task = 'regional-sales';
  const records = await mkdtemp(join(scratch, 'records-'));
  const saved = join(records, 'regional-sales-2');
  await mkdir(join(saved, 'answer'), { recursive: true });
  const transcript = new URL('./fixtures/release-1e93128/codex-regional-sales-2.jsonl', import.meta.url);
  await cp(transcript, join(saved, 'transcript.jsonl'));
  await writeFile(join(saved, 'answer', 'chart.js'), 'export { default } from "./render.js";');
  await writeFile(join(saved, 'answer', 'render.js'), sales);
  const { hashes, runDirectory } = await prepareWorkspace(scratch, task, { inputHashes: workspace => inputHashes(workspace, task) });
  await removeWorkspace(runDirectory);
  await writeJson(join(saved, 'run.json'), { agent: 'codex', task, protocol, hashes, status: 'void', slot: 2,
    reason: 'Recorded forbidden paths outside the attempt run directory.', audit: { status: 'outside policy', paths: ['/code'] },
    cli: { args: ['-C', '/tmp/axylo-rehearsal-iS75px/workspace'] }, observed: { model: models.codex, effort },
    exit: { code: 0, signal: null, timedOut: false, error: null }, endedAt: '2026-11-19T08:27:09.968Z' });

  expect(await reauditRecords(records, { workdir: scratch })).toEqual([{ name: 'regional-sales-2', status: 'pass', reason: null }]);
  const grade = await readJson(join(saved, 'grade.json'));
  expect(grade).toMatchObject({ pass: true, browserVersion: browser.version() });
  expect(grade.timezones.map(zone => [zone.input, zone.timezoneId])).toEqual([
    ['primary', LA], ['primary', Tokyo], ['alternate', LA], ['alternate', Tokyo],
  ]);
  expect(await readJson(join(saved, 'run.json'))).toMatchObject({ status: 'pass', slot: 2,
    history: [{ status: 'void', auditVersion: 1 }], browserVersion: grade.browserVersion });
  expect(await readFile(join(saved, 'transcript.jsonl'), 'utf8')).toBe(await readFile(transcript, 'utf8'));
  expect(await readFile(join(saved, 'answer', 'render.js'), 'utf8')).toBe(sales);
});

function criterion(result, name) {
  return result.criteria.find(item => item.name === name);
}

const answers = [
  ['daily-visits', visits],
  ['regional-sales', sales],
  ['signups', signups],
  ['daily-revenue', revenue],
];

it.each(answers)('passes a hand-written %s answer on both inputs in both time zones', async (task, source) => {
  const result = await answer(task, source);
  expect(result.criteria.filter(item => !item.pass)).toEqual([]);
  expect(result.pass).toBe(true);
  expect(result.timezones.map(zone => [zone.input, zone.timezoneId])).toEqual([
    ['primary', LA], ['primary', Tokyo], ['alternate', LA], ['alternate', Tokyo],
  ]);
  if (task === 'signups') {
    expect(result.diagnostics.filter(d => d.code === 'AX102')).toHaveLength(2);
    expect(criterion(result.timezones[2], 'reader note').detail).toContain('Accessible counts: 1');
  }
});

it('fails both the table and reader date when midnight is treated as an instant', async () => {
  const result = await answer('daily-visits', visits.replace("{ field: 'day', type: 'date' }", "'day'"));
  expect(result.pass).toBe(false);
  expect(criterion(result.timezones[0], 'table rows')).toMatchObject({ pass: false, detail: expect.stringContaining('Feb 28, 2026') });
  expect(criterion(result.timezones[0], 'reader date')).toMatchObject({ pass: false, detail: expect.stringContaining('Feb 28, 2026') });
  expect(criterion(result.timezones[1], 'reader date')).toMatchObject({ pass: false, detail: expect.stringContaining('Mar 1, 2026') });
  expect(criterion(result, 'no error diagnostics').pass).toBe(true);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AX111', level: 'hint', sources: ['handle'] }));
});

it('accepts a day-first calendar format in the table and point reading', async () => {
  const format = `x: { field: 'day', type: 'date', format: { day: '2-digit', month: 'long', year: 'numeric' } },
    locale: 'en-GB'`;
  const result = await answer('signups', signups.replace("x: 'day'", format));
  expect(result.criteria.filter(item => !item.pass)).toEqual([]);
  expect(criterion(result, 'reader date').detail).toContain('06 April 2026');
});

it('fails a sorted categorical line that bridges missing days even when its table matches', async () => {
  const source = visits.replace("data, x: { field: 'day', type: 'date' }", `data: data
    .map(row => ({ ...row, day: row.day.slice(0, 10) }))
    .sort((a, b) => a.day.localeCompare(b.day)), x: { field: 'day', type: 'category' }`);
  const result = await answer('daily-visits', source);
  expect(criterion(result, 'table rows').pass).toBe(true);
  expect(criterion(result, 'drawn gaps')).toMatchObject({ pass: false, detail: expect.stringContaining('2026-03-06, 2026-03-12, 2026-03-26') });
});

it('fails the plotted quarter order when categories stay in encounter order', async () => {
  const result = await answer('regional-sales', sales.replace('data: data.toSorted((a, b) => a.quarter.localeCompare(b.quarter))', 'data'));
  expect(criterion(result, 'plotted x order').pass).toBe(false);
  expect(criterion(result, 'table rows').pass).toBe(false);
});

it('fails when agent code filters out a valid revenue row', async () => {
  const source = revenue.replace('const rows = data.map', "const rows = data.filter(row => !row.day.startsWith('2026-05-05')).map");
  const result = await answer('daily-revenue', source);
  expect(criterion(result, 'no error diagnostics').pass).toBe(true);
  expect(criterion(result, 'reader note').pass).toBe(true);
  expect(criterion(result, 'table rows')).toMatchObject({ pass: false, detail: expect.stringContaining('2026-05-05') });
});

it('fails a wrong unit label on one series of a multi-series chart', async () => {
  const result = await answer('regional-sales', sales.replace("field: 'central',", "field: 'central', unit: 'kg',"));
  expect(criterion(result, 'table headers')).toMatchObject({ pass: false, detail: expect.stringMatching(/central \(kg\)/i) });
});

it.each(answers)('fails when the %s answer hard-codes the primary values', async (task, source) => {
  const primary = await readJson(taskFiles(task).fixture);
  const result = await answer(task, source.replace('render(element, data) {',
    `render(element, ignored) { const data = ${JSON.stringify(primary)};`));
  expect(result.timezones.filter(zone => zone.input === 'primary').every(zone => criterion(zone, 'table rows').pass)).toBe(true);
  expect(result.timezones.filter(zone => zone.input === 'alternate').every(zone => !criterion(zone, 'table rows').pass)).toBe(true);
  expect(result.pass).toBe(false);
});

function changeFigure(source, code) {
  return source.replace('return line(element,', 'const handle = line(element,').replace(/\n}$/, `
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ${code}
    }));
    return handle;
  }`);
}

it('fails a clipped visible title with an intact accessible name', async () => {
  const result = await answer('signups', changeFigure(signups, `
    element.querySelector('.axylo-title').style.cssText = 'height: 4px; overflow: hidden';
  `));
  expect(criterion(result, 'accessible name').pass).toBe(true);
  expect(criterion(result, 'visible title').pass).toBe(false);
});

it('accepts a title intentionally hidden with the documented option', async () => {
  const result = await answer('signups', signups.replace("title: 'Daily signups'", "title: { text: 'Daily signups', visible: false }"));
  expect(result.criteria.filter(item => !item.pass)).toEqual([]);
});

it('fails a table with the wrong caption despite a correct figure name', async () => {
  const result = await answer('signups', changeFigure(signups, `
    new MutationObserver(() => {
      const caption = element.querySelector('table caption');
      if (caption && caption.textContent !== 'Other title') caption.textContent = 'Other title';
    }).observe(element, { childList: true, subtree: true });
  `));
  expect(criterion(result, 'accessible name').pass).toBe(true);
  expect(criterion(result, 'table caption')).toMatchObject({ pass: false, detail: expect.stringContaining('Other title') });
});

it.each([
  'note.textContent = "Values not shown: 9. See table."; ',
  'note.style.opacity = "0";',
  'note.setAttribute("aria-hidden", "true");',
])('fails a genuine omission when the note is changed with %s', async change => {
  const result = await answer('signups', changeFigure(signups, `
    const note = element.querySelector('.axylo-note');
    if (!note.hidden) { ${change} }
  `));
  expect(criterion(result, 'reader note').pass).toBe(false);
  expect(criterion(result, 'table rows').pass).toBe(true);
});

it('accepts a differently worded omission note with the right count', async () => {
  const result = await answer('signups', signups.replace("title: 'Daily signups'",
    "title: 'Daily signups', messages: { valuesNotShown: 'Omitted {count} value. {seeTable}' }"));
  expect(result.criteria.filter(item => !item.pass)).toEqual([]);
});

it('accepts the documented automatic conversion of an all-decimal-string field', async () => {
  const result = await answer('regional-sales', sales.replaceAll(", parse: 'number'", ''));
  expect(result.criteria.filter(item => !item.pass)).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AX104', level: 'hint', sources: ['handle'] }));
});

it('fails the rows and reader note when mixed numeric strings are left unparsed', async () => {
  const result = await answer('daily-revenue', revenue.replace('data: rows', 'data'));
  expect(criterion(result, 'table rows').pass).toBe(false);
  expect(criterion(result, 'reader note').pass).toBe(false);
  expect(criterion(result, 'no error diagnostics').pass).toBe(true);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AX106', level: 'warning' }));
});

it('fails the rows when absent days are filled with zero', async () => {
  const result = await answer('daily-visits', visits.replace("y: 'visits'", "y: { field: 'visits', missing: 'zero' }"));
  expect(criterion(result, 'table rows')).toMatchObject({ pass: false, detail: expect.stringContaining('2026-03-06') });
  expect(criterion(result, 'no error diagnostics').pass).toBe(true);
});

it('fails the diagnostics check when the missing field raises AX101', async () => {
  const result = await answer('signups', signups.replace("field: 'signpus'", "field: 'signups'"));
  expect(criterion(result, 'no error diagnostics')).toMatchObject({ pass: false, detail: expect.stringContaining('AX101') });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AX101', level: 'error', sources: ['console', 'handle'] }));
});

it('fails an explicit chart error state even when Axylo emits no error code', async () => {
  const result = await answer('signups', signups.replace("title: 'Daily signups'",
    "title: 'Daily signups', state: { error: 'Signups could not load.' }"));
  expect(criterion(result, 'no error diagnostics')).toMatchObject({
    pass: false, detail: expect.stringContaining('Signups could not load.'),
  });
  expect(result.diagnostics.filter(item => item.level === 'error')).toEqual([]);
});

it('fails the accessible name when Axylo uses a fallback', async () => {
  const result = await answer('signups', signups.replace(", title: 'Daily signups'", ''));
  expect(criterion(result, 'accessible name').pass).toBe(false);
  expect(criterion(result, 'table caption').pass).toBe(false);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AX140', level: 'warning' }));
});

it('fails the chart type when a bar is used for the signups line', async () => {
  const result = await answer('signups', signups.replaceAll(/\bline\b/g, 'bar'));
  expect(criterion(result, 'chart type').pass).toBe(false);
});

it.each([
  ['export function render() {}', 'must default-export'],
  ['export default function render() { throw new Error("render failed"); }', 'render failed'],
  ['export default function render() {}', 'must return the Axylo chart handle'],
])('fails an invalid delivery (%s)', async (source, reason) => {
  const result = await answer('daily-visits', source);
  expect(criterion(result, 'render')).toMatchObject({ pass: false, detail: expect.stringContaining(reason) });
});
