// Loaded with `node --import` by the distribution tests. Fails any module resolution that lands outside the
// directories in AXYLO_FIXTURE_ROOTS (a JSON array of absolute paths): Node would otherwise walk up from a
// fixture to the repository's own node_modules, where the workspace packages are linked, and silently use
// them for an import the fixture never declared.
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = JSON.parse(process.env.AXYLO_FIXTURE_ROOTS ?? '[]');
if (roots.length === 0) throw new Error('[fixture guard] AXYLO_FIXTURE_ROOTS is not set');
const inside = file => roots.some(root => { const r = path.relative(root, file); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith('file:')) {
      const file = fileURLToPath(result.url);
      if (!inside(file)) throw new Error(`[fixture guard] ${JSON.stringify(specifier)} imported from ${context.parentURL ?? '(entry)'} resolved outside the fixture, to ${file}`);
    }
    return result;
  },
});
