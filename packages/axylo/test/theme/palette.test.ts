/**
 * The default palette (spec A5, L2; decision 0003). Constraints 1–6 of the decision, measured here with code
 * of this file's own (WCAG 2 contrast; OKLab; Machado et al. 2009 color-vision simulation at severity 1.0 in
 * linear RGB, clamped, as research/harness/palette.mjs scored the ten libraries), then compared with the record
 * the research scorer wrote (research/palette/palette.json), so the two implementations check each other and the
 * numbers in the decision record cannot drift from what ships.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { contrastRatio, parseColor, type Rgba } from '../../src/theme/color';
import { DARK, LIGHT } from '../../src/theme/palette';
import { AXYLO_CSS } from '../../src/theme/css';

type Vec3 = readonly [number, number, number];
type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';

const c = (s: string): Rgba => parseColor(s)!;
const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const srgb = (hex: string): Vec3 => { const p = c(hex); return [p.r, p.g, p.b]; };

function oklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const MACHADO: Record<Vision, readonly Vec3[]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const VISIONS = Object.keys(MACHADO) as Vision[];

/** OKLab of a gamma-encoded sRGB color as seen with `vision`. */
const seen = (rgb: Vec3, vision: Vision): Vec3 => {
  const l = rgb.map(lin) as unknown as Vec3;
  return oklab(MACHADO[vision].map(row => clamp01(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) as unknown as Vec3);
};
const delta = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const hue = (hex: string): number => { const [, a, b] = seen(srgb(hex), 'normal'); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
const hueDifference = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** Source-over at `alpha` in gamma-encoded sRGB, as the browser composites a translucent fill. */
const over = (hex: string, alpha: number, bg: string): Vec3 => { const f = srgb(hex), b = srgb(bg); return [0, 1, 2].map(i => f[i]! * alpha + b[i]! * (1 - alpha)) as unknown as Vec3; };

/** Smallest pairwise difference among `colors` under `vision`, with the slots (1-based) of the pair. */
function closest(colors: readonly string[], vision: Vision): { d: number; pair: [number, number] } {
  const labs = colors.map(h => seen(srgb(h), vision));
  let d = Infinity, pair: [number, number] = [0, 0];
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
    const x = delta(labs[i]!, labs[j]!);
    if (x < d) { d = x; pair = [i + 1, j + 1]; }
  }
  return { d, pair };
}

interface RecordScheme {
  background: string;
  series: { hex: string; contrast: number }[];
  minDelta: Record<Vision, { min: number }>;
  prefixes: Record<string, Record<Vision, { min: number }>>;
  tokenDistance: Record<string, { min: number }>;
  composites: Record<string, Record<Vision, { minNeighbour: number }>>;
}
const record = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../../research/palette/palette.json'), 'utf8')) as
  { schemes: Record<'light' | 'dark', RecordScheme> };

const SCHEMES = [['light', LIGHT, DARK], ['dark', DARK, LIGHT]] as const;

describe('scoring code used below', () => {
  it('reproduces known OKLab values and leaves grays alone under every simulation', () => {
    const white = seen([1, 1, 1], 'normal');
    expect(white[0]).toBeCloseTo(1, 4);
    expect(Math.hypot(white[1], white[2])).toBeLessThan(1e-4);
    // Ottosson's reference value for sRGB red.
    const red = seen([1, 0, 0], 'normal');
    expect(red[0]).toBeCloseTo(0.6279554, 4);
    expect(red[1]).toBeCloseTo(0.2248631, 4);
    expect(red[2]).toBeCloseTo(0.1258463, 4);
    for (const v of VISIONS) {
      const g = seen(srgb('#777777'), v), n = seen(srgb('#777777'), 'normal');
      expect(delta(g, n), v).toBeLessThan(0.002);
    }
    // Deuteranopia collapses red and green toward the same hue: the classic confusion pair gets much closer.
    expect(delta(seen(srgb('#d62728'), 'deutan'), seen(srgb('#2ca02c'), 'deutan'))).toBeLessThan(0.5 * delta(seen(srgb('#d62728'), 'normal'), seen(srgb('#2ca02c'), 'normal')));
  });
});

describe('default palette (spec A5, decision 0003)', () => {
  for (const [name, scheme, other] of SCHEMES) {
    const series = scheme.series;

    it(`${name}: eight distinct series colors`, () => {
      expect(series).toHaveLength(8);
      expect(new Set(series).size).toBe(8);
      for (const color of series) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    });

    it(`${name}: 1. every series color reaches 3:1 on the default background`, () => {
      const bg = c(scheme.background);
      for (const color of series) expect(contrastRatio(c(color), bg), color).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: 2. the eight are at least 0.10 apart in OKLab under normal vision and simulated protanopia, deuteranopia, tritanopia`, () => {
      for (const v of VISIONS) {
        const { d, pair } = closest(series, v);
        expect(d, `${v}: slots ${pair.join(' and ')}`).toBeGreaterThanOrEqual(0.10);
      }
    });

    it(`${name}: 3. the first three, four, five and six are at least 0.10 apart, the first four at least 0.14`, () => {
      for (const n of [3, 4, 5, 6]) for (const v of VISIONS) {
        const { d, pair } = closest(series.slice(0, n), v);
        expect(d, `first ${n}, ${v}: slots ${pair.join(' and ')}`).toBeGreaterThanOrEqual(n === 4 ? 0.14 : 0.10);
      }
    });

    it(`${name}: 4. slot k is the same hue family in both schemes (OKLCH hue within 30°)`, () => {
      series.forEach((color, k) => {
        expect(hueDifference(hue(color), hue(other.series[k]!)), `slot ${k + 1}: ${color} / ${other.series[k]}`).toBeLessThanOrEqual(30);
      });
    });

    it(`${name}: 5. no series color is within 0.10 of the focus or reference token (nor muted, the donut's "Other" slice)`, () => {
      for (const token of ['focus', 'reference', 'muted'] as const) {
        const t = seen(srgb(scheme[token]), 'normal');
        for (const color of series) expect(delta(seen(srgb(color), 'normal'), t), `${color} vs ${token} ${scheme[token]}`).toBeGreaterThanOrEqual(0.10);
      }
    });

    it(`${name}: 6. neighbours k and k+1 stay 0.06 apart as fills at 25% and 80% over the background`, () => {
      for (const alpha of [0.25, 0.8]) {
        const labs = series.map(color => seen(over(color, alpha, scheme.background), 'normal'));
        for (let k = 0; k + 1 < labs.length; k++) {
          expect(delta(labs[k]!, labs[k + 1]!), `${alpha * 100}%: slots ${k + 1} and ${k + 2}`).toBeGreaterThanOrEqual(0.06);
        }
      }
    });

    it(`${name}: the research record (research/palette/palette.json) holds these colors and the same measurements`, () => {
      const r = record.schemes[name];
      expect(r.background).toBe(scheme.background);
      expect(r.series.map(s => s.hex)).toEqual([...series]);
      series.forEach((color, k) => expect(contrastRatio(c(color), c(scheme.background))).toBeCloseTo(r.series[k]!.contrast, 1));
      for (const v of VISIONS) {
        expect(closest(series, v).d).toBeCloseTo(r.minDelta[v].min, 3);
        for (const n of [3, 4, 5, 6]) expect(closest(series.slice(0, n), v).d).toBeCloseTo(r.prefixes[n]![v].min, 3);
      }
      for (const token of ['focus', 'reference', 'muted'] as const) {
        const t = seen(srgb(scheme[token]), 'normal');
        expect(Math.min(...series.map(color => delta(seen(srgb(color), 'normal'), t)))).toBeCloseTo(r.tokenDistance[token]!.min, 3);
      }
      for (const alpha of [0.25, 0.8]) {
        const labs = series.map(color => seen(over(color, alpha, scheme.background), 'normal'));
        const min = Math.min(...labs.slice(1).map((l, k) => delta(labs[k]!, l)));
        expect(min).toBeCloseTo(r.composites[String(alpha)]!.normal.minNeighbour, 3);
      }
    });

    it(`${name}: token colors meet spec L2 (axis and focus 3:1; muted and reference 4.5:1, they label text)`, () => {
      const bg = c(scheme.background);
      expect(contrastRatio(c(scheme.axis), bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c(scheme.focus), bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c(scheme.muted), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c(scheme.reference), bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('default stylesheet', () => {
  it('defines the light and dark token sets, forced colors and the dash switch', () => {
    for (let i = 1; i <= 8; i++) {
      // Public names today, private defaults (--axylo-default-series-N) once the review's stylesheet change lands.
      expect(AXYLO_CSS).toMatch(new RegExp(`--axylo-(default-)?series-${i}: ${LIGHT.series[i - 1]};`));
      expect(AXYLO_CSS).toMatch(new RegExp(`--axylo-(default-)?series-${i}: ${DARK.series[i - 1]};`));
      expect(AXYLO_CSS).toContain(`--axylo-series-${i}: CanvasText !important;`);
    }
    expect(AXYLO_CSS).toContain('.axylo[data-axylo-scheme="dark"]');
    expect(AXYLO_CSS).toContain('@media (forced-colors: active)');
    expect(AXYLO_CSS).toMatch(/@media \(prefers-contrast: more\), \(forced-colors: active\) \{\s*(\.axylo )?\.axylo-svg \.axylo-dashed \{ stroke-dasharray: var\(--axylo-dash-contrast/);
    expect(AXYLO_CSS).toContain('--axylo-stylesheet: loaded');
  });

  it('never sets what scheme detection reads (color-scheme, color, --axylo-background) outside forced colors', () => {
    const outsideForced = AXYLO_CSS.replace(/@media \(forced-colors: active\) \{[\s\S]*?\n {2}\}\n/, '');
    expect(outsideForced).not.toMatch(/color-scheme\s*:/);
    expect(outsideForced).not.toMatch(/--axylo-background\s*:/);
    expect(outsideForced).not.toMatch(/\.axylo\s*\{[^}]*[^-]color\s*:/);
  });

  it('keeps the marker that separates the figure module\'s structure rules from the token and mark part', () => {
    const marker = AXYLO_CSS.indexOf('/* structure: added by the figure module');
    expect(marker).toBeGreaterThan(AXYLO_CSS.indexOf('.axylo-text'));
  });

  it('balances its braces', () => {
    expect(AXYLO_CSS.split('{').length).toBe(AXYLO_CSS.split('}').length);
  });
});

