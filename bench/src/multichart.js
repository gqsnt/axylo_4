// Shared by the CLI, the Node oracle, and the browser. Legacy workloads never acquire a kind.
export const kinds = ['line', 'area', 'bar', 'donut', 'histogram', 'scatter'];

const standard = { area: '1x100000', bar: '3x24', donut: '1x8', histogram: '1x10000', scatter: '1x10000' };
const sizes = {
  first: { ...standard, area: 'trend' },
  page: { ...standard, area: 'trend', bar: '3x12', histogram: '1x2000', scatter: '1x500' },
  // Keep inputs identifiable even for a compact request that admission reports as unavailable.
  compact: { ...standard, area: 'trend', bar: '1x12', histogram: '1x1000' },
  hover: standard,
  zoom: { area: standard.area, scatter: standard.scatter },
  resize: standard,
  lifecycle: { ...standard, area: 'trend', histogram: '1x2000', scatter: '1x2000' },
  scatter: { scatter: standard.scatter },
};

// `--kind cartesian`: the RFC C4.1 §8 dual-axis workload (one line on a left axis, bars of the same length on a right
// axis), drawn only by the axylo-cartesian adapter. Not in `kinds`: no other library or root chart draws it. The
// one-line paired workload needs no kind: it is the plain line workload (identical fixture) on both sides.
export const cartesianWorkloads = ['first', 'zoom', 'hover'];

function cartesianParams(workload, args) {
  if (!cartesianWorkloads.includes(workload)) throw new Error(`${workload} is not available for cartesian`);
  if (args.fixture || args.gaps || args.clustered || args.bins !== undefined) throw new Error('--kind cartesian takes only --size 1xN (and --moves for hover)');
  const size = args.size ?? '1x100000';
  const match = /^1x(\d+)$/.exec(size);
  if (!match || !Number.isSafeInteger(+match[1]) || +match[1] < 2) throw new Error(`invalid cartesian size: ${size} (one line of N points, plus N bars)`);
  const p = { kind: 'cartesian', size };
  if (workload === 'hover') {
    p.moves = Number(args.moves ?? 200);
    if (!(Number.isSafeInteger(p.moves) && p.moves > 0)) throw new Error('--moves must be a positive integer');
  }
  return p;
}

export function multiParams(workload, args) {
  const { kind } = args;
  if (kind === 'cartesian') return cartesianParams(workload, args);
  if (!kinds.includes(kind)) throw new Error(`unknown chart kind ${kind}`);
  const defaultSize = sizes[workload]?.[kind];
  if (!defaultSize) throw new Error(`${workload} is not available for ${kind}`);
  const page = workload === 'page', compact = workload === 'compact', lifecycle = workload === 'lifecycle';
  if (args.clustered && kind !== 'scatter') throw new Error('--clustered requires scatter data');
  if (args.gaps && kind !== 'area') throw new Error('--gaps requires aligned line or area data');
  const size = args.fixture ?? args.size ?? defaultSize;
  const p = { kind };
  if (size === 'trend' && kind === 'area') p.fixture = 'trend';
  else {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match || !Number.isSafeInteger(+match[1]) || !Number.isSafeInteger(+match[2]) || +match[1] < 1 || +match[2] < 1
      || ((compact || !['area', 'bar'].includes(kind)) && +match[1] !== 1)) throw new Error(`invalid ${kind} size: ${size}`);
    p.size = size;
  }
  if (kind === 'histogram') {
    p.bins = Number(args.bins ?? 24);
    if (!Number.isInteger(p.bins) || p.bins < 1 || p.bins > 100) throw new Error('--bins must be an integer from 1 to 100');
  }
  if (kind === 'scatter') p.clustered = !!args.clustered;
  if (kind === 'area' && args.gaps) p.gaps = true;
  if (page || compact || workload === 'resize') p.charts = Number(args.charts ?? (page ? 24 : compact ? 40 : 1));
  if (workload === 'hover') p.moves = Number(args.moves ?? 200);
  if (lifecycle) p.cycles = Number(args.cycles ?? 2500);
  for (const field of ['charts', 'moves', 'cycles']) {
    if (field in p && !(Number.isSafeInteger(p[field]) && p[field] > 0)) throw new Error(`--${field} must be a positive integer`);
  }
  return p;
}

export function kindAvailability(library, workload, { kind } = {}) {
  if (!kind || kind === 'line') return null;
  const unavailable = reason => ({ ok: false, reason });
  if (kind === 'cartesian') {
    if (!cartesianWorkloads.includes(workload)) return unavailable(`cartesian is not available for ${workload}`);
    return library === 'Axylo' ? { ok: true } : unavailable(`${library} has no axylo/cartesian layers`);
  }
  if (!kinds.includes(kind)) return unavailable(`unknown chart kind ${kind}`);
  if (kind === 'histogram' && library !== 'Axylo') return unavailable(`${library} has no native histogram binning chart API`);
  if (library === 'uPlot' && kind !== 'area') return unavailable(`uPlot has no native ${kind} chart`);
  if (workload === 'compact' && (['scatter', 'donut'].includes(kind) || ['uPlot', 'Chart.js'].includes(library))) {
    return unavailable(`compact ${kind} is not available for ${library}`);
  }
  if (!sizes[workload]?.[kind]) return unavailable(`${kind} is not available for ${workload}`);
  return { ok: true };
}
