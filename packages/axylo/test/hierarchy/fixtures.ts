/** Shared generators of the hierarchy tests. */
import fc from 'fast-check';
import type { HierarchyNode } from '../../src/hierarchy/tree';

/** Random nested trees of integer leaves (some zero), up to `depth` levels. */
export function arbTree(depth: number): fc.Arbitrary<HierarchyNode> {
  const leaf = fc.record({ label: fc.string({ maxLength: 6 }), value: fc.integer({ min: 0, max: 1000 }) });
  const { tree } = fc.letrec<{ tree: HierarchyNode }>(tie => ({
    tree: fc.oneof(
      { depthSize: 'small', maxDepth: depth },
      leaf,
      fc.record({ label: fc.string({ maxLength: 6 }), children: fc.array(tie('tree'), { minLength: 1, maxLength: 6 }) }),
    ),
  }));
  return fc.record({ label: fc.constant('Root'), children: fc.array(tree, { minLength: 1, maxLength: 7 }) });
}
