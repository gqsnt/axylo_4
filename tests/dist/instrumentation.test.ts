/**
 * What only tests and the benchmark use stays out of the production files (spec DX7; size analysis 2, class (a)):
 * the P7 byte count, the stores' one-step conveniences, `Delivery.deliver` and the scatter lookup's work
 * counters are installed only in builds with `__DEV__` or `__BENCH__`. Read from the packed files the npm
 * fixture installed.
 *
 * Markers are what a minifier keeps: property names and string literals. Each is first required in the
 * development file, so a rename that made a marker vanish fails here instead of passing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fixture } from './paths';

const MARKERS: readonly [string, RegExp][] = [
  ['the stores\' byte count', /\bownedBytes\b/],
  ['the byte count\'s names for rows kept for older frames', /rows kept for earlier frames/],
  ['the stores\' one-step replacement', /\bprepareReplace\b/],
  ['the stores\' one-step re-encoding', /\breencode\b/],
  ['Delivery.deliver', /\bdeliver\b/],
  ['the scatter lookup\'s pick counter', /\blastPickCandidates\b/],
  ['the scatter lookup\'s members counter', /\blastMembersRead\b/],
];

const file = (name: string) => fs.readFileSync(fixture('npm', 'node_modules/axylo/dist', name), 'utf8');

describe('test and benchmark members are absent from the production files', () => {
  const development = file('axylo.dev.js');
  const production = { 'axylo.js': file('axylo.js'), 'axylo.iife.min.js': file('axylo.iife.min.js') };
  for (const [what, marker] of MARKERS) {
    it(what, () => {
      expect(development).toMatch(marker);
      for (const [name, text] of Object.entries(production)) expect(text, name).not.toMatch(marker);
    });
  }
});
