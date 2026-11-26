/**
 * Logarithmic continuous scale, overflow-safe nice domain selection, and deterministic tick candidates
 * for opt-in `axylo/cartesian` (RFC C4.1 §4). Never re-exported from `scale/index.ts` so legacy bundles
 * pay 0 B.
 */
import type { ContinuousScale, Tick, TickCandidates } from '../core/contracts';
import { linearTickCandidates, pushCandidate, type TickContext, type TickLabeler } from './linear';

export type LogBase = 10 | 2;
export type Span = readonly [number, number];

export const LOG_MIN_DOMAIN = 1e-300;
export const LOG_MAX_DOMAIN = 1e300;
const MAX_LOG_TICKS = 13;

export function isValidLogBase(base: unknown): base is LogBase {
  return base === 10 || base === 2;
}

export function isValidLogDomain(domain: readonly [number, number]): boolean {
  const [d0, d1] = domain;
  return Number.isFinite(d0) && Number.isFinite(d1) && d0 > 0 && d1 > 0 && d0 < d1;
}

/**
 * Overflow-safe, branch-continuous logarithmic scale (RFC C4.1 §4.1):
 * chooses `log1p`/`expm1` vs `Math.log`/`Math.exp` once at construction time (`close = d1 - d0 <= 0.5 * d0`),
 * eliminating mid-domain branch discontinuities while avoiding `d1 / d0` overflow up to 600 decades.
 */
export function logScale(domain: Span, range: Span): ContinuousScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (!isValidLogDomain(domain) || !Number.isFinite(r0) || !Number.isFinite(r1)) {
    return {
      type: 'log', domain: [d0, d1], range: [r0, r1],
      map: () => NaN,
      invert: () => NaN,
    };
  }
  const close = d1 - d0 <= 0.5 * d0;
  const l0 = Math.log(d0);
  const L = close ? Math.log1p((d1 - d0) / d0) : Math.log(d1) - l0;
  const invL = 1 / L;
  const R = r1 - r0;

  const map = (v: number): number => {
    if (!Number.isFinite(v) || v <= 0) return NaN;
    if (v === d0) return r0;
    if (v === d1) return r1;
    const dl = close ? Math.log1p((v - d0) / d0) : Math.log(v) - l0;
    return r0 + (dl * invL) * R;
  };

  const invert = (p: number): number => {
    if (!Number.isFinite(p)) return NaN;
    if (R === 0 || p === r0) return d0;
    if (p === r1) return d1;
    const t = (p - r0) / R;
    return close ? d0 + d0 * Math.expm1(t * L) : Math.exp(l0 + t * L);
  };

  return { type: 'log', domain: [d0, d1], range: [r0, r1], map, invert };
}

function logBase(v: number, base: LogBase): number {
  return base === 10 ? Math.log10(v) : Math.log2(v);
}

function powBase(exp: number, base: LogBase): number {
  if (base === 10) return Number(`1e${exp}`);
  return Math.pow(2, exp);
}

function clampLogBound(v: number): number {
  if (!Number.isFinite(v) || v <= LOG_MIN_DOMAIN) return LOG_MIN_DOMAIN;
  if (v >= LOG_MAX_DOMAIN) return LOG_MAX_DOMAIN;
  return v;
}

/**
 * Automatic nice positive bounds for a logarithmic axis (RFC C4.1 §4.3).
 * Handles singleton domains (`min === max`) before span branching and clamps to `[1e-300, 1e300]`.
 */
export function niceLogDomain(min: number, max: number, base: LogBase = 10): Span {
  const loRaw = clampLogBound(Math.min(min, max));
  const hiRaw = clampLogBound(Math.max(min, max));
  if (loRaw === hiRaw) {
    let lo = clampLogBound(loRaw / base);
    let hi = clampLogBound(hiRaw * base);
    if (lo === hi) {
      if (lo <= LOG_MIN_DOMAIN * base) hi = clampLogBound(LOG_MIN_DOMAIN * base * base);
      else lo = clampLogBound(LOG_MAX_DOMAIN / (base * base));
    }
    return [lo, hi];
  }
  const close = hiRaw - loRaw <= 0.5 * loRaw;
  const L = close ? Math.log1p((hiRaw - loRaw) / loRaw) : Math.log(hiRaw) - Math.log(loRaw);
  const S = L / Math.log(base);
  if (S >= 1) {
    const pMin = Math.floor(logBase(loRaw, base));
    const pMax = Math.ceil(logBase(hiRaw, base));
    const lo = clampLogBound(powBase(pMin, base));
    const hi = clampLogBound(powBase(pMax, base));
    return lo < hi ? [lo, hi] : [loRaw, hiRaw];
  }
  // Sub-decade: snap outward to 1-2-5 (base 10) or 1-1.5-2 (base 2) inside the decade.
  const k = Math.floor(logBase(loRaw, base));
  const unit = powBase(k, base);
  const steps = base === 10 ? [1, 2, 5, 10] : [1, 1.5, 2];
  const mLo = loRaw / unit;
  const mHi = hiRaw / unit;
  let snappedLo = steps[0]!;
  for (const s of steps) if (s <= mLo + 1e-12) snappedLo = s;
  let snappedHi = steps[steps.length - 1]!;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s >= mHi - 1e-12) snappedHi = s;
  }
  // If hi crossed into the next decade (mHi > base), expand snappedHi to next decade multiple.
  const hiCandidate = mHi > base ? powBase(Math.ceil(logBase(hiRaw, base)), base) : snappedHi * unit;
  const lo = clampLogBound(snappedLo * unit);
  const hi = clampLogBound(hiCandidate);
  return lo < hi ? [lo, hi] : [loRaw, hiRaw];
}

function makeTickSet(values: readonly number[], format: TickLabeler): Tick[] {
  const maxAbs = values.length ? Math.max(Math.abs(values[0]!), Math.abs(values[values.length - 1]!)) : 0;
  const step = values.length >= 2 ? values[1]! - values[0]! : 0;
  const context: TickContext = { step, maxAbs };
  return values.map(value => ({ value, label: format(value, context) }));
}

function powersInDomain(d0: number, d1: number, base: LogBase, stride: number, multipliers: readonly number[]): number[] {
  const kMin = Math.floor(logBase(d0, base));
  const kMax = Math.ceil(logBase(d1, base));
  const startK = stride > 1 ? Math.ceil(kMin / stride) * stride : kMin;
  const out: number[] = [];
  for (let k = startK; k <= kMax; k += stride) {
    const p = powBase(k, base);
    if (!Number.isFinite(p) || p <= 0) continue;
    for (const m of multipliers) {
      const v = m === 1 ? p : p * m;
      if (v >= d0 * (1 - 1e-12) && v <= d1 * (1 + 1e-12)) {
        const clamped = v < d0 ? d0 : v > d1 ? d1 : v;
        if (out[out.length - 1] !== clamped) out.push(clamped);
      }
    }
  }
  return out;
}

/**
 * Deterministic logarithmic tick candidates, densest to sparsest (RFC C4.1 §4.3).
 * Precomputes starting integer stride `m0 = max(1, ceil(S / 12))` before enumerating so 600-decade
 * spans never allocate 601 ticks; guarantees at least 2 distinct endpoint ticks on every valid domain.
 */
export function logTickCandidates(domain: Span, format: TickLabeler, base: LogBase = 10): TickCandidates {
  if (!isValidLogDomain(domain)) return [];
  const [d0, d1] = domain;
  const close = d1 - d0 <= 0.5 * d0;
  const L = close ? Math.log1p((d1 - d0) / d0) : Math.log(d1) - Math.log(d0);
  const S = L / Math.log(base);
  const endpoints = (): Tick[] => makeTickSet([d0, d1], format);

  if (S < 1) {
    const linear = linearTickCandidates(domain, format);
    const sets: Tick[][] = [];
    for (const set of linear) {
      const filtered = set.filter(t => t.value > 0 && t.value >= d0 && t.value <= d1);
      if (filtered.length >= 2) pushCandidate(sets, filtered);
    }
    if (sets.length === 0) sets.push(endpoints());
    return sets;
  }

  const sets: Tick[][] = [];
  if (S < 3) {
    const subMults = base === 10 ? [1, 2, 5] : [1, 1.5];
    const dense = powersInDomain(d0, d1, base, 1, subMults);
    if (dense.length >= 2 && dense.length <= MAX_LOG_TICKS) pushCandidate(sets, makeTickSet(dense, format));
    const powers = powersInDomain(d0, d1, base, 1, [1]);
    if (powers.length >= 2) pushCandidate(sets, makeTickSet(powers, format));
    if (sets.length === 0 || sets[sets.length - 1]!.length < 2) pushCandidate(sets, endpoints());
    return sets;
  }

  // Wide span (S >= 3, up to 600 decades): precompute starting stride m0 before enumeration.
  const m0 = Math.max(1, Math.ceil(S / 12));
  for (const factor of [1, 2, 5] as const) {
    const vals = powersInDomain(d0, d1, base, m0 * factor, [1]);
    if (vals.length >= 2 && vals.length <= MAX_LOG_TICKS) {
      pushCandidate(sets, makeTickSet(vals, format));
    }
  }
  if (sets.length === 0) sets.push(endpoints());
  return sets;
}
