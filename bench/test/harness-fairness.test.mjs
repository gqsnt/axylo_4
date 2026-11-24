import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { axyloAdapter } from '../src/adapters/axylo-common.js';
import { summarizeRun } from '../src/stats.js';

test('create leaves readout formatting cold and readoutShows reuses one formatter', async t => {
  const formatter = t.mock.method(Intl, 'NumberFormat');
  const ready = t.mock.fn(() => Promise.resolve());
  globalThis.__VERSIONS__ = { axylo: 'stub' };
  globalThis.Axylo = { line: () => ({ __bench: { ready } }) };
  t.after(() => {
    delete globalThis.__VERSIONS__;
    delete globalThis.Axylo;
  });

  const value = { textContent: '1,234.567891' };
  const tooltip = { querySelectorAll: sel => sel === '.axylo-tooltip-value' ? [value] : [] };
  const el = { querySelector: sel => sel === '.axylo-tooltip' ? tooltip : null };
  const fix = { names: ['s'], x: [0, 1], ys: [[1234.5678912, 1]] };
  const handle = axyloAdapter('axylo').create(el, fix);
  assert.equal(formatter.mock.callCount(), 0);
  await handle.ready;
  assert.equal(ready.mock.callCount(), 1);
  assert.equal(formatter.mock.callCount(), 0);

  assert.equal(handle.readoutShows(0), true);
  assert.equal(formatter.mock.callCount(), 1);
  assert.equal(handle.readoutShows(1), false);
  value.textContent = ' 1 ';
  assert.equal(handle.readoutShows(1), true);
  assert.equal(formatter.mock.callCount(), 1);
});

test('the lifecycle gate tolerates 2 KB of drift on a 4 MB heap and catches 100 bytes retained per cycle', () => {
  const checkpoints = [0, 100, 300, 1000, ...Array.from({ length: 11 }, (_, i) => 1500 + 100 * i)]
    .map(cycles => ({ cycles, label: `cycles${cycles}`, observers: 0 }));
  function summary(heapAt) {
    const samples = Object.fromEntries(checkpoints.map(({ cycles, label }) =>
      [label, { heapUsed: heapAt(cycles), nodes: 40, listeners: 10 }]));
    return summarizeRun('lifecycle', { result: { lifecycle: { checkpoints } }, memory: { samples } });
  }

  const base = 4 * 1024 * 1024;
  assert.equal(summary(() => base).heapGate, 'pass');
  const drift = summary(c => base + Math.round(2048 * Math.max(0, c - 1500) / 1000));
  assert.equal(drift.heapGate, 'pass');
  const leak = summary(c => base + 100 * c);
  assert.equal(leak.heapGate, 'fail');
  assert.deepEqual([leak.listenersAfter, leak.observersAfter, leak.nodesAfter], [0, 0, 0]);
});

test('full lifecycle runs warm the measured loop before cycle zero and short runs stay fast', () => {
  const page = readFileSync(new URL('../src/page.js', import.meta.url), 'utf8');
  const body = page.match(/async function runLifecycle\b[^]*?\n\}/)[0];
  const warm = body.match(/params\.warm\s*\?\?\s*\(cycles\s*>=\s*1500\s*\?\s*(\d+)\s*:\s*(\d+)\)/);
  assert.ok(warm && Number(warm[1]) >= 500 && Number(warm[2]) === 20);
  assert.match(body, /for\s*\(let c = -warm; c <= cycles; c\+\+\)\s*\{\s*if\s*\(c >= 0 && at\.has\(c\)\)/);
  assert.match(body, /if\s*\(c < cycles\) await once\(\);\s*\}/);
  assert.equal(body.match(/await once\(\)/g)?.length, 1);
});
