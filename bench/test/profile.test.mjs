// Pure test: profile attribution, self against inclusive, through a source map (review finding 3). A synthetic
// profile and map with hand-counted samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProfile, positionMap, decodeVlq } from '../lib/profile-summary.mjs';

// Line 0 of the bundle: columns 0..9 are data/normalize.ts, from column 10 render/svg.ts.
// Segments: [col 0, source 0, line 0, col 0] = "AAAA"; then [col +10, source +1, line 0, col 0] = "UCAA".
const map = { version: 3, sources: ['../../packages/axylo/src/data/normalize.ts', '../../packages/axylo/src/render/svg.ts'], mappings: 'AAAA,UCAA' };
const url = 'http://127.0.0.1:1/A/axylo/axylo.iife.min.js';
const cf = (functionName, columnNumber, u = url) => ({ functionName, url: u, lineNumber: 0, columnNumber, scriptId: '1' });
// root -> normalize (col 2) -> draw (col 12); root -> (garbage collector); root -> (idle); root -> page code
const profile = {
  nodes: [
    { id: 1, callFrame: cf('(root)', 0, ''), children: [2, 4, 5, 6] },
    { id: 2, callFrame: cf('normalize', 2), children: [3] },
    { id: 3, callFrame: cf('paint', 12), children: [] },
    { id: 4, callFrame: cf('(garbage collector)', 0, ''), children: [] },
    { id: 5, callFrame: cf('(idle)', 0, ''), children: [] },
    { id: 6, callFrame: cf('runCreate', 0, 'http://127.0.0.1:1/A/page.js'), children: [] },
  ],
  // 1 ms each: paint x2, normalize x1, gc x1, idle x1, page x1
  samples: [3, 3, 2, 4, 5, 6],
  timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000],
};

test('the VLQ decoder and the position map read the source map', () => {
  assert.deepEqual(decodeVlq('UCAA'), [10, 1, 0, 0]);
  const at = positionMap(map);
  assert.equal(at(0, 2), 'data/normalize.ts');
  assert.equal(at(0, 12), 'render/svg.ts');
  assert.equal(at(1, 0), null);
});

test('an explicitly unmapped segment stays unmapped (review 2, finding 11)', () => {
  // "AAAA,U": column 0 maps to normalize.ts; column 10 starts an unmapped segment. Column 11 is not normalization.
  const at = positionMap({ version: 3, sources: ['../../packages/axylo/src/data/normalize.ts'], mappings: 'AAAA,U' });
  assert.equal(at(0, 5), 'data/normalize.ts');
  assert.equal(at(0, 11), null);
});

test('self time goes to the leaf; inclusive time to every stage on the stack', () => {
  const s = summarizeProfile(profile, { map, build: 'prod' });
  const self = Object.fromEntries(s.self.map(r => [r.k, r.ms]));
  const incl = Object.fromEntries(s.inclusive.map(r => [r.k, r.ms]));
  assert.equal(s.totalMs, 6);
  assert.equal(s.busyMs, 5);
  assert.equal(self.draw, 2);
  assert.equal(self.normalize, 1);
  assert.equal(self['(garbage collector)'], 1);
  assert.equal(self['other JavaScript (harness, page, comparison library)'], 1);
  assert.equal(incl.normalize, 3, 'normalize is on the stack of its own sample and both paint samples');
  assert.equal(incl.draw, 2);
  assert.equal(incl['Axylo (any frame)'], 3);
  assert.match(s.mapping, /source map from the sealed artifact/);
});

test('without a map nothing is guessed', () => {
  const s = summarizeProfile(profile, { map: null, build: 'prod' });
  assert.equal(Object.fromEntries(s.self.map(r => [r.k, r.ms]))['axylo (unmapped)'], 3);
  assert.match(s.mapping, /not available/);
});
