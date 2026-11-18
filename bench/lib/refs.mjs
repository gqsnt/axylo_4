// Adapter references and noise bands for the runner.
import fs from 'node:fs';
import path from 'node:path';

export const WORKLOADS = ['first', 'page', 'stream', 'theme', 'resize'];

/**
 * "axylo:renderer=svg,build=dev" -> { id: 'axylo', params: { renderer: 'svg', build: 'dev' } }.
 * Values stay strings except true/false and plain numbers.
 */
export function parseAdapterRef(ref) {
  const [id, rest] = String(ref).split(/:(.*)/s);
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`adapter reference "${ref}": the id must be lowercase letters, digits and dashes`);
  const params = {};
  if (rest) for (const part of rest.split(',')) {
    const m = /^([A-Za-z][\w-]*)=(.*)$/.exec(part);
    if (!m) throw new Error(`adapter reference "${ref}": parameter "${part}" is not key=value`);
    params[m[1]] = m[2] === 'true' ? true : m[2] === 'false' ? false : /^-?\d+(\.\d+)?$/.test(m[2]) ? Number(m[2]) : m[2];
  }
  return { id, params };
}

/**
 * Loads one or more complete A-versus-A records for the same workload and parameters. With several, the band is
 * their union per metric (lowest lo, highest hi), the more cautious choice.
 */
export function loadNoise(refs, historyDir, workload, params) {
  const sources = [], metrics = {};
  for (const ref of refs) {
    const p = fs.existsSync(ref) ? ref : path.join(historyDir, `${ref}.json`);
    if (!fs.existsSync(p)) throw new Error(`noise run ${ref} not found`);
    const n = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (n.design?.mode !== 'aa' || n.status !== 'complete') throw new Error(`noise run ${ref} is not a complete A-versus-A run`);
    if (n.design.workload !== workload || JSON.stringify(n.design.params) !== JSON.stringify(params)) throw new Error(`noise run ${ref} is for ${n.design.workload} ${JSON.stringify(n.design.params)}, not this workload`);
    sources.push({ runId: n.runId, adapter: n.design.baseline, chrome: n.environment.browser.version, dpr: n.design.dpr });
    for (const [k, m] of Object.entries(n.analysis.metrics)) {
      if (!Number.isFinite(m.lo) || !Number.isFinite(m.hi)) continue;
      const cur = metrics[k];
      metrics[k] = cur ? { lo: Math.min(cur.lo, m.lo), hi: Math.max(cur.hi, m.hi) } : { lo: m.lo, hi: m.hi };
    }
  }
  return { sources, metrics };
}
