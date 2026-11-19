import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { grade } from '../grade.mjs';
import { prepareWorkspace } from '../workspace.mjs';

const visits = `import { line } from 'axylo';
export default function render(element, data) {
  return line(element, { data, x: { field: 'day', type: 'date' }, y: 'visits', title: 'Daily visits' });
}`;

const sales = `import { bar } from 'axylo';
export default function render(element, data) {
  return bar(element, {
    data, x: 'quarter', y: [
      { field: 'north', parse: 'number' },
      { field: 'central', parse: 'number' },
      { field: 'west', parse: 'number' },
    ], title: 'Quarterly sales by region',
  });
}`;

const signups = `import { line } from 'axylo';
export default function render(element, data) {
  return line(element, { data, x: 'day', y: 'signpus', title: 'Daily signups' });
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
  const { workspace } = await prepareWorkspace(scratch, task);
  await writeFile(join(workspace, 'chart.js'), source);
  // The tests reuse a Chrome process, while each grade still creates two clean contexts.
  return grade(workspace, task, { launch: async () => ({ newContext: options => browser.newContext(options), close: async () => {} }) });
}

function criterion(result, name) {
  return result.criteria.find(item => item.name === name);
}

it.each([
  ['daily-visits', visits],
  ['regional-sales', sales],
  ['signups', signups],
  ['daily-revenue', revenue],
])('passes a hand-written %s answer in both time zones', async (task, source) => {
  const result = await answer(task, source);
  expect(result.criteria.filter(item => !item.pass)).toEqual([]);
  expect(result.pass).toBe(true);
  expect(result.timezones.map(zone => zone.timezoneId)).toEqual([LA, Tokyo]);
});

it('fails the calendar-day check in Los Angeles when midnight is treated as an instant', async () => {
  const result = await answer('daily-visits', visits.replace("{ field: 'day', type: 'date' }", "'day'"));
  expect(result.pass).toBe(false);
  expect(criterion(result.timezones[0], 'table rows')).toMatchObject({ pass: false, detail: expect.stringContaining('Feb 28, 2026') });
  expect(criterion(result.timezones[1], 'table rows').pass).toBe(true);
  expect(criterion(result, 'no error diagnostics').pass).toBe(true);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AX111', level: 'hint', sources: ['handle'] }));
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
  const result = await answer('signups', signups.replace("y: 'signpus'", "y: 'signups'"));
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
  expect(result.criteria.filter(item => !item.pass).map(item => item.name)).toEqual(['accessible name']);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AX140', level: 'warning' }));
});

it('fails the chart type when a bar is used for the signups line', async () => {
  const result = await answer('signups', signups.replaceAll(/\bline\b/g, 'bar'));
  expect(result.criteria.filter(item => !item.pass).map(item => item.name)).toEqual(['chart type']);
});

it.each([
  ['export function render() {}', 'must default-export'],
  ['export default function render() { throw new Error("render failed"); }', 'render failed'],
  ['export default function render() {}', 'must return the Axylo chart handle'],
])('fails an invalid delivery (%s)', async (source, reason) => {
  const result = await answer('daily-visits', source);
  expect(criterion(result, 'render')).toMatchObject({ pass: false, detail: expect.stringContaining(reason) });
});
