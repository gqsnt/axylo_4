/**
 * Colour measures for A5, the suite's own code: OKLab (Ottosson), and colour-vision simulation by
 * Machado, Oliveira and Fernandes 2009 at severity 1.0 in linear RGB, clamped (the method decision 0003 and
 * research/harness/palette.mjs name). Inputs are the sRGB bytes Chrome resolved for the rendered marks.
 */
import type { RGB } from './util';

export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';
type Vec3 = readonly [number, number, number];

const MACHADO: Record<Vision, readonly Vec3[]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const VISIONS = Object.keys(MACHADO) as Vision[];

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clamp = (v: number): number => Math.min(1, Math.max(0, v));

function oklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab of a byte colour as seen with `vision`. */
export function seen(rgb: RGB, vision: Vision): Vec3 {
  const l = rgb.map(v => lin(v / 255)) as unknown as Vec3;
  const M = MACHADO[vision];
  return oklab([0, 1, 2].map(i => clamp(M[i]![0] * l[0] + M[i]![1] * l[1] + M[i]![2] * l[2])) as unknown as Vec3);
}

export const oklabDistance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The smallest pairwise OKLab distance among `colors` seen with `vision`, and the pair. */
export function minimumDistance(colors: readonly RGB[], vision: Vision): { distance: number; pair: [number, number] } {
  let best = { distance: Infinity, pair: [0, 0] as [number, number] };
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const d = oklabDistance(seen(colors[i]!, vision), seen(colors[j]!, vision));
      if (d < best.distance) best = { distance: d, pair: [i, j] };
    }
  }
  return best;
}

/** Rec. 709 luma of an sRGB byte colour, for a grayscale conversion of a screenshot. */
export const gray = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
