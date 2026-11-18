import { describe, it } from 'vitest';
import { kinds } from './cases';

describe('render examples', () => {
  for (const kind of kinds) {
    it(`${kind} renders`, () => {});
  }
  it.each(['bar'] as const)('%s has a baseline', () => {});
  // it('title in a comment', () => {});
  const example = "it('title in a string', () => {})";
});
