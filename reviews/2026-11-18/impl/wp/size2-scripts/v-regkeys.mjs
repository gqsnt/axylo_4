// The registry's entry keys as single letters (what a tuple or compact encoding would save).
import { edit, regex, variant } from './lib.mjs';
const d = variant('reg-keys');
regex(d, 'diagnostics/registry.ts', /: \{ level: '/g, ": { l: '", { min: 29 });
regex(d, 'diagnostics/registry.ts', /', text: /g, "', t: ", { min: 29 });
regex(d, 'diagnostics/registry.ts', /\n  outcome: /g, '\n  o: ', { min: 29 });
edit(d, 'diagnostics/registry.ts', [
  ['  readonly level: Diagnostic[\'level\'];\n  readonly text: (details: DiagnosticDetails) => string;\n  readonly outcome: string | ((details: DiagnosticDetails) => string);',
   '  readonly l: Diagnostic[\'level\'];\n  readonly t: (details: DiagnosticDetails) => string;\n  readonly o: string | ((details: DiagnosticDetails) => string);'],
  ['  const { outcome } = entry;\n  return entry.text(details)', '  const { o: outcome } = entry;\n  return entry.t(details)'],
  ['level: diagnosticRegistry[code].level,', 'level: diagnosticRegistry[code].l,'],
]);
