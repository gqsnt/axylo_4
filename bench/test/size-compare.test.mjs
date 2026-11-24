import assert from 'node:assert/strict';
import test from 'node:test';
import { measureAll } from '../tools/size-compare.mjs';

test('consumer bundles include every selected JS and CSS download', async () => {
  const rows = await measureAll();
  const ids = ['uplot-line', 'chartjs-modular', 'chartjs-auto', 'echarts-modular-line',
    'echarts-modular-multi', 'echarts-full', 'axylo-line', 'axylo-everything'];
  assert.deepEqual(rows.map(row => row.id).sort(), ids.sort());
  for (const row of rows) {
    for (const field of ['minBytes', 'jsGzipBytes', 'totalGzipBytes']) {
      assert.ok(Number.isSafeInteger(row[field]) && row[field] > 0, `${row.id} ${field}`);
    }
    for (const field of ['cssMinBytes', 'cssGzipBytes']) {
      if (row.id === 'uplot-line') assert.ok(Number.isSafeInteger(row[field]) && row[field] > 0, field);
      else assert.equal(row[field], 0, `${row.id} ${field}`);
    }
    assert.equal(row.totalGzipBytes, row.jsGzipBytes + row.cssGzipBytes, row.id);
    assert.equal(row.totalKiB, Number((row.totalGzipBytes / 1024).toFixed(2)), row.id);
  }

  const size = Object.fromEntries(rows.map(row => [row.id, row.totalGzipBytes]));
  assert.ok(size['uplot-line'] < size['chartjs-modular']);
  assert.ok(size['chartjs-modular'] < size['chartjs-auto']);
  assert.ok(size['echarts-modular-line'] < size['echarts-modular-multi']);
  assert.ok(size['echarts-modular-multi'] < size['echarts-full']);
  assert.ok(size['axylo-line'] <= size['axylo-everything']);
});
