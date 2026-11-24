import { expect, it } from 'vitest';
import { SLOT_VALUE } from '../../src/core/contracts';
import { linearScale } from '../../src/scale/linear';
import { affineProjection } from '../../src/scene/geometry';
import { simplifyLine } from '../../src/simplify';

it('reuses a resize selection while keeping returned indexes and changed projections independent', () => {
  const count = 2049;
  const x = Float64Array.from({ length: count }, (_, i) => i / 2048);
  const y = Float64Array.from({ length: count }, (_, i) => i);
  const slot = new Uint8Array(count).fill(SLOT_VALUE);
  const draw = (width: number, ratio = 1, domainEnd = 1, positions = x) => {
    const mapX = linearScale([0, domainEnd], [0, width]);
    return simplifyLine({
      x: positions, y, slot, range: { start: 0, end: count }, mapX,
      affineX: affineProjection(mapX, [positions[0]!, positions[count - 1]!]),
      left: 0, width, devicePixelRatio: ratio,
    }).indexes;
  };

  // Monotone y makes the first and last samples the only extrema of each column.
  const twoColumns = Uint32Array.of(0, 1023, 1024, 2047, 2048);
  const fourColumns = Uint32Array.of(0, 511, 512, 1023, 1024, 1535, 1536, 2047, 2048);
  const first = draw(2);
  expect(first).toEqual(twoColumns);
  first.fill(0);
  expect(draw(4)).toEqual(fourColumns);
  const revisited = draw(2);
  expect(revisited).toEqual(twoColumns);
  revisited.fill(0);
  expect(draw(2)).toEqual(twoColumns);
  expect(draw(2, 2)).toEqual(fourColumns);
  expect(draw(2, 1, 2)).toEqual(Uint32Array.of(0, 2047, 2048));
  expect(draw(2)).toEqual(twoColumns);
  expect(draw(2, 1, 1, x.map(value => value / 2))).toEqual(Uint32Array.of(0, 2047, 2048));
});
