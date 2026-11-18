/**
 * The packed declarations type-check an application (strict, skipLibCheck off) for both packages, under both
 * module resolutions a TypeScript consumer of an ESM package uses: `Bundler` (bundled applications) and
 * `NodeNext` (Node, and libraries that must run there), which requires relative specifiers inside `.d.ts`
 * files to carry their `.js` extension. The first-chart snippets are among the checked files. Every file the
 * compiler read lies inside the fixture (or is the compiler's own lib), so no declaration came from the
 * workspace: TypeScript would otherwise walk up to the repository's node_modules for anything missing.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { check, fixture, inside, outsideFixture } from './paths';

describe.each([
  ['npm', ['axylo'], 'npm.ts'],
  ['react', ['axylo', '@axylo/react'], 'react.tsx'],
] as const)('%s fixture', (name, packages, snippet) => {
  describe.each([['Bundler', 'tsconfig.json'], ['NodeNext', 'tsconfig.nodenext.json']] as const)('moduleResolution %s', (_mode, config) => {
    const project = fixture(name);
    const result = check(project, config);

    it('type-checks with tsc --strict against the packed declarations', () => {
      expect(result.errors).toEqual([]);
      expect(result.status).toBe(0);
    });

    it('read every declaration from inside the fixture, the packed ones from its node_modules', () => {
      expect(outsideFixture(result.files, project)).toEqual([]);
      for (const pkg of packages) {
        expect(result.files.filter(f => inside(path.join(project, 'node_modules', pkg), f)).length, `${pkg} declarations read`).toBeGreaterThan(0);
      }
    });

    it('checked the first-chart snippet', () => {
      expect(result.files).toContain(path.join(project, 'example', snippet));
    });
  });
});
