// Plain-text summary of a history record's analysis.
const fmtBytes = v => (typeof v !== 'number' || !Number.isFinite(v) ? 'n/a' : Math.abs(v) >= 2 ** 20 ? `${(v / 2 ** 20).toFixed(2)} MiB` : `${(v / 1024).toFixed(1)} KiB`);
const fmt = v => (typeof v !== 'number' || !Number.isFinite(v) ? 'n/a' : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

export function formatAnalysis(record) {
  const { design, analysis } = record;
  const lines = [];
  if (!analysis) return 'no analysis (run incomplete)';
  if (analysis.notCompared) return `not compared: ${analysis.notCompared.join('; ')}`;
  const A = design.mode === 'aa' ? `${design.baseline} (A)` : design.baseline, B = design.mode === 'aa' ? `${design.candidate} (A')` : design.candidate;
  lines.push(`\n${record.runId}  [${record.status}]`);
  lines.push(`${design.mode === 'aa' ? 'A-versus-A' : 'comparison'}: A=${A}  B=${B}  workload ${design.workload} ${JSON.stringify(design.params)}`);
  lines.push(`complete pairs ${analysis.completePairs}/${analysis.blocks}; run outcomes ${JSON.stringify(analysis.outcomes)}`);
  lines.push(`noise band: ${design.noiseFrom ? `from ${[].concat(design.noiseFrom).map(n => n.runId).join(' + ')}` : 'none given (outcomes test against zero only)'}`);
  lines.push('');
  const head = ['metric', 'median A', 'median B', 'B-A', '95% CI', 'B/A-1', 'outcome'];
  const rows = [head];
  for (const [key, m] of Object.entries(analysis.metrics)) {
    if (m.na) { rows.push([`${key}${m.primary ? ' *' : ''}`, m.na, '', '', '', '', '']); continue; }
    const f = m.unit === 'bytes' ? fmtBytes : fmt;
    rows.push([`${key}${m.primary ? ' *' : ''}`, f(m.medianA), f(m.medianB), f(m.diff), `[${f(m.lo)}, ${f(m.hi)}]`, m.relative == null ? 'n/a' : `${(m.relative * 100).toFixed(1)}%`, m.outcome + (m.outcomeNote ? ' (few pairs)' : '')]);
  }
  const w = head.map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  for (const r of rows) lines.push(r.map((c, i) => String(c).padEnd(w[i])).join('  '));
  if (Object.values(analysis.metrics).some(m => m.outcomeNote)) lines.push(`(few pairs): fewer complete pairs than the minimum for a verdict; the interval is shown, the outcome is inconclusive by rule.`);
  lines.push('* primary metric. Lower is better for every metric. Units: ms unless the metric counts something (samples, frames, calls, nodes) or is memory (KiB/MiB).');
  if (design.mode === 'aa') lines.push('A-versus-A: the 95% CI column is this session\'s noise band for each metric (one session; the plan asks for three).');
  return lines.join('\n');
}
