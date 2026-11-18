import { DiagnosticCollector, report } from '../diagnostics';
import type { Diagnostic } from '../public';
import { normalize, type DataEnvironment } from './normalize';
import { resolveOptions, type ChartType } from './options';

export function validateOptions(
  type: ChartType, options: unknown, environment: DataEnvironment = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
): readonly Diagnostic[] {
  const diagnostics = new DiagnosticCollector();
  let name: string = type;
  try {
    const resolved = resolveOptions(type, options, diagnostics);
    name = resolved.name;
    normalize(type, resolved, environment, diagnostics, { epoch: 0, revision: 0 });
  } catch {
    report(diagnostics, 'AX150', 'chart-error', { detail: 'Supply readable options and data.' });
  }
  return diagnostics.list(name);
}
