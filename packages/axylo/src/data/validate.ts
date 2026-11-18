import { DiagnosticCollector } from '../diagnostics';
import type { Diagnostic } from '../public';
import { normalize, type DataEnvironment } from './normalize';
import { resolveOptions, type ChartType } from './options';

export function validateOptions(
  type: ChartType, options: unknown, environment: DataEnvironment = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
): readonly Diagnostic[] {
  const diagnostics = new DiagnosticCollector();
  const resolved = resolveOptions(type, options, diagnostics);
  normalize(type, resolved, environment, diagnostics, { epoch: 0, revision: 0 });
  return diagnostics.list(resolved.name);
}
