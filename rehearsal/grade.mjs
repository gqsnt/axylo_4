import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { inside, isMain, readJson, repository, taskFiles, writeJson } from './files.mjs';
import { compareRows } from './table.mjs';

const zones = ['America/Los_Angeles', 'Asia/Tokyo'];
const timeout = 5000;
const origin = 'https://axylo-rehearsal.invalid';
const criteriaNames = ['render', 'no error diagnostics', 'accessible name', 'table rows', 'reader note', 'chart type'];
const criterion = (name, pass, detail) => ({ name, pass, detail });

async function registryLevels() {
  const registry = await readFile(join(repository, 'packages/axylo/src/diagnostics/registry.ts'), 'utf8');
  const levels = new Map([...registry.matchAll(/^\s*(AX\d+): \{ level: '(error|warning|hint)'/gm)]
    .map(([, code, level]) => [code, level]));
  if (levels.get('AX101') !== 'error' || levels.get('AX140') !== 'warning') {
    throw new Error('Could not read diagnostic levels from the Axylo registry.');
  }
  return levels;
}

async function bundle(workspace, data) {
  const result = await build({
    absWorkingDir: workspace,
    stdin: {
      resolveDir: workspace,
      contents: `
        import * as answer from './chart.js';
        try {
          const render = Reflect.get(answer, 'default');
          if (typeof render !== 'function') throw new Error('chart.js must default-export a render function.');
          const handle = render(document.getElementById('chart'), ${JSON.stringify(data)});
          if (!handle || typeof handle.update !== 'function' || typeof handle.destroy !== 'function' ||
              !Array.isArray(handle.diagnostics)) {
            throw new Error('render must return the Axylo chart handle.');
          }
          window.rehearsalRender = { handle };
        } catch (error) {
          window.rehearsalRender = { error: String(error), diagnostics: error?.diagnostics };
        }
      `,
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    conditions: ['browser'],
    write: false,
    outfile: 'chart-bundle.js',
    logLevel: 'silent',
    plugins: [{
      name: 'workspace-files',
      setup(builder) {
        builder.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
          if (!inside(workspace, await realpath(args.path))) {
            return { errors: [{ text: 'Import outside the rehearsal workspace: ' + args.path }] };
          }
        });
      },
    }],
  });
  return new Map(result.outputFiles.map(file => ['/' + basename(file.path), file.text]));
}

const html = `<!doctype html><html lang="en-US"><meta charset="utf-8">
<title>Axylo rehearsal</title><link rel="stylesheet" href="/chart-bundle.css">
<div id="chart" style="width:720px;height:400px"></div><script src="/chart-bundle.js"></script></html>`;

async function inspect(browser, files, expected, levels, timezoneId) {
  const context = await browser.newContext({ timezoneId, locale: 'en-US', serviceWorkers: 'block' });
  const criteria = [];
  const diagnostics = new Map();
  const errors = [];
  let table;
  const addDiagnostic = (code, diagnostic, source) => {
    const previous = diagnostics.get(code);
    diagnostics.set(code, {
      ...previous, ...diagnostic, code, level: levels.get(code) ?? diagnostic.level ?? 'unknown', timezoneId,
      sources: [...new Set([...(previous?.sources ?? []), source])],
    });
  };

  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/') {
        return route.fulfill({
          contentType: 'text/html',
          body: html,
          headers: {
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
          },
        });
      }
      if (url.pathname.endsWith('.css')) {
        return route.fulfill({ contentType: 'text/css', body: files.get(url.pathname) ?? '' });
      }
      const script = files.get(url.pathname);
      return script === undefined ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: script });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      const text = message.text();
      const code = /\[axylo (AX\d+)\]/.exec(text)?.[1];
      if (code) addDiagnostic(code, { console: text }, 'console');
    });
    await page.goto(origin, { waitUntil: 'load', timeout });
    const problem = await page.evaluate(() => window.rehearsalRender?.error ?? null);
    const figure = page.locator('#chart figure');
    let state = '';
    if (!problem && errors.length === 0) {
      await page.waitForFunction(() => new Promise(done => {
        requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
      }));

      if (await figure.count() === 1) {
        const byName = page.getByRole('group', { name: expected.title, exact: true })
          .or(page.getByRole('figure', { name: expected.title, exact: true }))
          .or(page.getByRole('img', { name: expected.title, exact: true }));
        const titlePass = await figure.and(byName).count() === 1;
        const name = titlePass ? expected.title : (await figure.ariaSnapshot()).split('\n')[0];
        criteria.push(criterion('accessible name', titlePass, name || 'No accessible figure name.'));
        state = (await figure.locator('.axylo-message:visible').allTextContents()).join(' ');
        const description = (await figure.locator('.axylo-description').allTextContents())[0] ?? '';
        const types = await figure.locator('[aria-roledescription]').evaluateAll(nodes =>
          nodes.map(node => node.getAttribute('aria-roledescription')));
        const observedType = (types.find(type => /^(?:line|area|bar|scatter|donut) chart$/i.test(type)) ?? description)
          .match(/^(line|area|bar|scatter|donut) chart\b/i)?.[1].toLowerCase();
        criteria.push(criterion('chart type', observedType === expected.type,
          `Expected ${expected.type}, saw ${observedType ?? 'no chart type'}.`));

        const note = (await figure.locator('.axylo-note:visible').allTextContents()).join(' ');
        const omission = /\bValues not shown\b/i.test(note);
        const notePass = omission === (expected.valuesNotShown ?? false);
        criteria.push(criterion('reader note', notePass, note || 'No values-omitted note.'));
        try {
          const button = figure.getByRole('button', { name: 'View as table', exact: true });
          if (await button.count() === 1) {
            await button.click();
            const view = figure.getByRole('table');
            if (await view.count() === 1 && await view.isVisible()) {
              table = await view.evaluate(element => ({
                headers: Array.from(element.tHead?.rows[0]?.cells ?? [], cell => cell.textContent.trim()),
                rows: Array.from(element.tBodies[0]?.rows ?? [], row =>
                  Array.from(row.cells, cell => cell.textContent.trim())),
              }));
            }
          }
          if (!table) {
            criteria.push(criterion('table rows', false, 'Could not open one visible table with “View as table”.'));
          } else if (await figure.getByRole('button', { name: 'Next page', exact: true }).count()) {
            criteria.push(criterion('table rows', false, 'Unexpected additional table pages.'));
          } else {
            const compared = compareRows(expected, table.headers, table.rows);
            criteria.push(criterion('table rows', compared.pass, compared.detail));
          }
        } catch (error) {
          criteria.push(criterion('table rows', false, String(error)));
        }
      }
    }

    const handleDiagnostics = await page.evaluate(() => {
      const result = window.rehearsalRender;
      return result?.handle?.diagnostics ?? result?.diagnostics ?? [];
    });
    for (const { code, level, message } of handleDiagnostics) addDiagnostic(code, { level, message }, 'handle');
    const errorCodes = [...diagnostics.values()].filter(d => d.level === 'error').map(d => d.code);
    const errorState = ['Loading chart.', 'No data to show.'].includes(state) ? '' : state;
    criteria.push(criterion('no error diagnostics', !errorState && errorCodes.length === 0,
      [...errorCodes, errorState].filter(Boolean).join(' | ') || 'No error diagnostics or error state.'));
    const title = criteria.find(item => item.name === 'accessible name');
    if (title && diagnostics.has('AX140')) {
      title.pass = false;
      title.detail += ' (AX140)';
    }

    const reason = problem || errors.join(' | ') || (await figure.count() !== 1 && 'Expected one Axylo figure in #chart.');
    criteria.push(criterion('render', !reason, reason || 'Rendered a chart and returned its handle.'));
  } catch (error) {
    criteria.push(criterion('render', false, String(error)));
  } finally {
    await context.close();
  }

  return {
    timezoneId,
    criteria: criteriaNames.map(name => criteria.find(item => item.name === name) ??
      criterion(name, false, 'Unavailable after render failure.')),
    diagnostics: [...diagnostics.values()],
    ...(table ? { table } : {}),
  };
}

export async function grade(workspace, task, { launch = () => chromium.launch({ channel: 'chrome', headless: true, timeout: 15000 }) } = {}) {
  workspace = await realpath(workspace);
  const taskPaths = taskFiles(task);
  const expected = await readJson(taskPaths.expected);
  const save = async result => {
    await writeJson(join(workspace, 'grade.json'), result);
    return result;
  };
  const fail = (name, detail) => save({ pass: false, criteria: [criterion(name, false, detail)], diagnostics: [], timezones: [] });

  let files;
  try {
    if (!(await lstat(join(workspace, 'chart.js'))).isFile()) {
      return fail('render', 'chart.js must be a regular file.');
    }
    // Grade the original fixture even if the agent changed its local copy while experimenting.
    const data = await readJson(taskPaths.fixture);
    files = await bundle(workspace, data);
  } catch (error) {
    return fail('render', error.code === 'ENOENT' ? 'chart.js is missing.' : String(error));
  }

  const levels = await registryLevels();
  let browser;
  try {
    browser = await launch();
  } catch (error) {
    return fail('browser', String(error));
  }
  try {
    const timezones = [];
    for (const timezoneId of zones) timezones.push(await inspect(browser, files, expected, levels, timezoneId));
    const criteria = criteriaNames.map(name => {
      const results = timezones.map(zone => zone.criteria.find(item => item.name === name));
      return criterion(name, results.every(item => item.pass),
        results.map((item, index) => `${zones[index]}: ${item.detail}`).join(' | '));
    });
    return await save({
      pass: criteria.every(item => item.pass),
      criteria,
      diagnostics: timezones.flatMap(zone => zone.diagnostics),
      timezones,
    });
  } finally {
    await browser.close();
  }
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { task: { type: 'string' }, workdir: { type: 'string' } } });
    if (!values.task || !values.workdir) throw new Error('Usage: node rehearsal/grade.mjs --task <id> --workdir <workspace>');
    const result = await grade(resolve(values.workdir), values.task);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.pass ? 0 : result.criteria.some(item => item.name === 'browser') ? 2 : 1;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
