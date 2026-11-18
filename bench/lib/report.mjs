// Plain-text summary of a history record's analysis.
const fmtBytes = v => (typeof v !== 'number' || !Number.isFinite(v) ? 'n/a' : Math.abs(v) >= 2 ** 20 ? `${(v / 2 ** 20).toFixed(2)} MiB` : `${(v / 1024).toFixed(1)} KiB`);
const fmt = v => (typeof v !== 'number' || !Number.isFinite(v) ? 'n/a' : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

/** The band a metric was classified against, as one cell. */
export function bandCell(m, f = fmt) {
  if (m.noiseBand && typeof m.noiseBand === 'object') return `[${f(m.noiseBand.lo)}, ${f(m.noiseBand.hi)}]`;
  if (typeof m.noiseBand === 'string' && m.noiseBand.startsWith('zero-only')) return 'zero only (requested)';
  return 'zero only (no band)';
}

/**
 * @param record  a history record
 * @param opts    { source: 'stored' | 're-analysis' } says where the analysis came from
 */
export function formatAnalysis(record, { source = 'stored' } = {}) {
  const { design, analysis } = record;
  const lines = [];
  if (!analysis) return 'no analysis (run incomplete)';
  if (analysis.notCompared) return `not compared: ${analysis.notCompared.join('; ')}`;
  const A = design.mode === 'aa' ? `${design.baseline} (A)` : design.baseline, B = design.mode === 'aa' ? `${design.candidate} (A')` : design.candidate;
  lines.push(`\n${record.runId}  [${record.status}]  analysis: ${source === 'stored' ? 'stored in the record' : 'RE-ANALYSIS (not the stored one)'}`);
  lines.push(`${design.mode === 'aa' ? 'A-versus-A' : design.mode === 'builds' ? 'two builds' : 'comparison'}: A=${A}  B=${B}  workload ${design.workload} ${JSON.stringify(design.params)}`);
  if (design.mode === 'builds') lines.push(`  builds: A=${design.builds?.A}  B=${design.builds?.B}`);
  lines.push(`complete pairs ${analysis.completePairs}/${analysis.blocks}; run outcomes ${JSON.stringify(analysis.outcomes)}; order seed ${design.seed}, bootstrap seed ${analysis.bootstrapSeed ?? design.bootstrapSeed ?? 'not recorded (12345 in records before it was recorded)'}`);
  const rel = analysis.reliability;
  if (rel) {
    lines.push(`reliability: failed runs A ${rel.failed.A}/${rel.timed.A}, B ${rel.failed.B}/${rel.timed.B}${rel.adverseKey ? `; runs with ${rel.adverseKey} > 0: A ${rel.adverse.A}, B ${rel.adverse.B}` : ''}`);
    if (rel.conditional) lines.push('  TIMINGS ARE CONDITIONAL: survivor-only, the failed runs are not in them');
    if (rel.betterBlocked) lines.push(`  no "better" verdict: ${rel.betterBlocked}`);
  }
  const noise = design.noiseFrom;
  lines.push(`noise band: ${analysis.zeroOnly ? 'ZERO-ONLY ANALYSIS, explicitly requested: outcomes test against zero only' : noise ? `from ${[].concat(noise).map(n => n.runId).join(' + ')}${design.noiseCalibration ? ` (${design.noiseCalibration})` : ''}` : 'none given (outcomes test against zero only)'}`);
  lines.push('');
  const head = ['metric', 'median A', 'median B', 'B-A', '95% CI', 'AB | BA', 'B/A-1', 'band used', 'outcome'];
  const rows = [head];
  for (const [key, m] of Object.entries(analysis.metrics)) {
    if (m.na) { rows.push([`${key}${m.primary ? ' *' : ''}`, m.na, '', '', '', '', '', '', '']); continue; }
    const f = m.unit === 'bytes' ? fmtBytes : fmt;
    const order = m.byOrder ? `${f(m.byOrder.AB?.diff)} | ${f(m.byOrder.BA?.diff)}` : 'n/a';
    rows.push([`${key}${m.primary ? ' *' : ''}`, f(m.medianA), f(m.medianB), f(m.diff), `[${f(m.lo)}, ${f(m.hi)}]`, order, m.relative == null ? 'n/a' : `${(m.relative * 100).toFixed(1)}%`, bandCell(m, f),
      m.outcome + (m.outcomeNote ? ' (rule)' : '') + (m.conditional ? ' (conditional)' : '')]);
  }
  const w = head.map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  for (const r of rows) lines.push(r.map((c, i) => String(c).padEnd(w[i])).join('  '));
  const notes = [...new Set(Object.values(analysis.metrics).map(m => m.outcomeNote).filter(Boolean))];
  for (const n of notes) lines.push(`(rule): ${n}`);
  lines.push('* primary metric. Lower is better for every metric. Units: ms unless the metric counts something (samples, frames, calls, nodes) or is memory (KiB/MiB).');
  lines.push('AB | BA: the difference of medians within blocks run in each order; a large gap between them is carry-over between the two configurations.');
  if (design.mode === 'aa') lines.push('A-versus-A: the 95% CI column is this session\'s noise band for each metric (one session; the plan asks for three).');
  if (record.probes && Object.keys(record.probes).length) {
    lines.push('');
    lines.push('untimed probe runs (not timings):');
    for (const [id, p] of Object.entries(record.probes)) lines.push(`  ${id}: ${p.kind} ${p.outcome}${p.summary ? ` ${JSON.stringify(p.summary)}` : ''}${p.reason ? ` (${p.reason})` : ''}`);
  }
  return lines.join('\n');
}
