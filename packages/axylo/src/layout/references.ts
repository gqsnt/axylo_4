import type { PlacedText, Projection, Rect, ResolvedReference } from '../core/contracts';
import { projectReference } from '../scene/geometry';
import { middleText, placeText, prepareLabels, type Metrics } from './labels';

type Cartesian = Exclude<Projection, { kind: 'ring' }>;
type Span = readonly [number, number];

const GAP = 4;

interface Placement {
  readonly anchor: 'start' | 'end';
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

function* placements(
  reference: NonNullable<ReturnType<typeof projectReference>>, plot: Rect, texts: readonly PlacedText[], height: number,
): Iterable<Placement> {
  const { vertical, low, high } = reference;
  const left = plot.x + GAP;
  const right = plot.x + plot.width - GAP;
  const bottom = plot.y + plot.height;
  const boxes = texts.map(text => text.box);
  const top = vertical ? plot.y + GAP : plot.y;
  const rows = vertical
    ? [top, ...boxes.map(box => box.y + box.height + GAP).sort((a, b) => a - b)]
    : [low - GAP - height, high + GAP];
  // A band that meets the plot edges may only have room on the inside.
  if (!vertical && high - low >= height + 2 * GAP) rows.push(low + GAP, high - GAP - height);
  for (const y of rows) {
    if (y < top || y + height > bottom) continue;
    const obstacles = boxes.filter(box => box.y < y + height && box.y + box.height > y);
    const ends = vertical ? [low - GAP] : [right, ...obstacles.map(box => box.x - GAP).sort((a, b) => b - a)];
    if (vertical) {
      const x = high + GAP;
      let edge = right;
      for (const box of obstacles) {
        if (box.x + box.width > x) edge = Math.min(edge, box.x - GAP);
      }
      if (edge > x) yield { anchor: 'start', x, y, width: edge - x };
    }
    for (const x of ends) {
      let edge = left;
      for (const box of obstacles) {
        if (box.x < x) edge = Math.max(edge, box.x + box.width + GAP);
      }
      if (x > edge) yield { anchor: 'end', x, y, width: x - edge };
    }
    if (vertical && high - low > 2 * GAP) {
      const x = low + GAP;
      let edge = high - GAP;
      for (const box of obstacles) {
        if (box.x + box.width > x) edge = Math.min(edge, box.x - GAP);
      }
      if (edge > x) yield { anchor: 'start', x, y, width: edge - x };
    }
  }
}

export function placeReferences(
  references: readonly ResolvedReference[], projection: Cartesian, plot: Rect, texts: PlacedText[], metrics: Metrics,
  xDomain?: Span,
): { x: number; y: number } {
  const hidden = { x: 0, y: 0 };
  if (!references.length) return hidden;
  const labels = prepareLabels([references.map(({ label }, value) => ({ label, value }))]);
  for (const reference of references) {
    const projected = projectReference(reference, projection, plot, xDomain);
    if (!projected) continue;
    const { label } = reference;
    let best: Placement | undefined;
    const width = metrics.width(label);
    for (const candidate of placements(projected, plot, texts, metrics.lineHeight)) {
      if (candidate.width >= width) {
        best = candidate;
        break;
      }
      if (!best || candidate.width > best.width) best = candidate;
    }
    const shown = best && middleText(label, best.width, labels, metrics);
    if (best && shown?.trim()) {
      texts.push(placeText([shown], label, best.x, best.y, best.anchor, 'top', 0, 'reference', metrics));
    } else {
      hidden[reference.axis]++;
    }
  }
  return hidden;
}
