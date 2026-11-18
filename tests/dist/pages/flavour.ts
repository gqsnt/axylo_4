/**
 * The core consumer of flavours.browser.test.ts: one chart that raises a hint (AX104, every value a plain
 * decimal string) and one that raises a warning (AX140, no title), with every delivered diagnostic recorded.
 */
type Make = (target: string, options: Record<string, unknown>) => { diagnostics: readonly { code: string }[] };
export function run(A: { line: Make }): void {
  const w = window as unknown as Record<string, unknown>;
  const delivered: string[] = [];
  const onDiagnostic = (d: { code: string }) => { delivered.push(d.code); };
  const counts = [{ day: '2026-01-01', count: '12' }, { day: '2026-01-02', count: '15' }, { day: '2026-01-03', count: '9' }];
  const hinted = A.line('#hinted', { title: 'Counts', data: counts, x: 'day', y: 'count', onDiagnostic });
  const untitled = A.line('#untitled', { data: [{ day: '2026-01-01', v: 1 }, { day: '2026-01-02', v: 2 }], x: 'day', y: 'v', onDiagnostic });
  w.__delivered = delivered;
  w.__diagnostics = [...hinted.diagnostics, ...untitled.diagnostics].map(d => d.code);
}
