/**
 * The shared hierarchy model (N9b): nested and flat input, bottom-up rollup, shares and paths, and the
 * AX190–AX192 diagnostics. Expected values are worked out by hand from the fixtures and the brief.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arbTree } from './fixtures';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import {
  buildHierarchy, childAt, childCount, isPositive, pathOf, shareOfParent, shareOfRoot, subtreeEnd, type HierarchyModel, type HierarchyNode,
} from '../../src/hierarchy/tree';
import { createHierarchyReader, DEFAULT_HIERARCHY_MESSAGES } from '../../src/hierarchy/reader';
import { validateSunburst, validateTreemap } from '../../src/hierarchy';

const NESTED: HierarchyNode = {
  label: 'Root',
  children: [
    { label: 'A', children: [{ label: 'a1', value: 3 }, { label: 'a2', value: 1 }] },
    { label: 'B', value: 4 },
  ],
};
const FLAT = [
  { id: 'root', parent: null, label: 'Root' },
  { id: 'A', parent: 'root', label: 'A' },
  { id: 'a1', parent: 'A', label: 'a1', value: 3 },
  { id: 'a2', parent: 'A', label: 'a2', value: 1 },
  { id: 'B', parent: 'root', label: 'B', value: 4 },
];

function build(data: unknown, rootLabel = 'All'): { m: HierarchyModel; sink: DiagnosticCollector } {
  const sink = new DiagnosticCollector();
  return { m: buildHierarchy(data, rootLabel, sink), sink };
}
const codes = (sink: DiagnosticCollector) => sink.inputs().map(d => d.code);
const reader = (m: HierarchyModel) => createHierarchyReader(m, DEFAULT_HIERARCHY_MESSAGES, 'en-US', undefined, 'Treemap', 'Caption', () => {});

describe('rollup and shares', () => {
  it('nested input: pre-order nodes, values rolled up bottom-up, shares of parent and root', () => {
    const { m, sink } = build(NESTED);
    expect(codes(sink)).toEqual([]);
    expect(m.labels).toEqual(['Root', 'A', 'a1', 'a2', 'B']);
    expect(Array.from(m.value)).toEqual([8, 4, 3, 1, 4]);
    expect(Array.from(m.depth)).toEqual([0, 1, 2, 2, 1]);
    expect(Array.from(m.parent)).toEqual([-1, 0, 1, 1, 0]);
    expect(shareOfParent(m, 0)).toBeNull();
    expect(shareOfParent(m, 1)).toBe(0.5);
    expect(shareOfParent(m, 2)).toBe(0.75);
    expect(shareOfRoot(m, 2)).toBe(0.375);
    expect(pathOf(m, 3)).toEqual(['Root', 'A', 'a2']);
    expect(m.syntheticRoot).toBe(false);
  });

  it('flat parent-id rows give the same tree, values, paths and table as the nested form', () => {
    const a = build(NESTED).m, b = build(FLAT).m;
    expect(codes(build(FLAT).sink)).toEqual([]);
    expect(b.labels).toEqual(a.labels);
    expect(Array.from(b.value)).toEqual(Array.from(a.value));
    expect(Array.from(b.parent)).toEqual(Array.from(a.parent));
    expect(Array.from(b.row)).toEqual([0, 1, 2, 3, 4]);
    const ta = reader(a).table, tb = reader(b).table;
    for (let r = 0; r < 5; r++) expect(tb.row(r)).toEqual(ta.row(r));
  });

  it('several top-level nodes get a made-up root named by rootLabel', () => {
    const { m } = build([{ label: 'x', value: 1 }, { label: 'y', value: 3 }], 'Everything');
    expect(m.syntheticRoot).toBe(true);
    expect(m.labels[0]).toBe('Everything');
    expect(m.row[0]).toBe(-1);
    expect(m.value[0]).toBe(4);
    expect(shareOfRoot(m, 2)).toBe(0.75);
  });

  // W4 integration: the reader pages the table 100 rows at a time (spec A4); the model still holds every node.
  it('the five-column table holds every node, 100 rows per page, and agrees with the shares (spec A4)', () => {
    const { m } = build(NESTED);
    const t = reader(m).table;
    expect(t.headers).toEqual(['Path', 'Depth', 'Value', '% of Parent', '% of Root']);
    expect(t.rowCount).toBe(5);
    expect(t.pageSize).toBe(100);
    expect(t.pageForX('a1')).toBe(0);
    expect(t.row(0)).toEqual(['Root', '0', '8', '—', '100%']);
    expect(t.row(2)).toEqual(['Root / A / a1', '2', '3', '75%', '37.5%']);
    expect(t.row(4)).toEqual(['Root / B', '1', '4', '50%', '50%']);
    expect(t.row(5)).toBeNull();
    expect(t.row(-1)).toBeNull();
  });

  it('for any tree of integer leaves, every branch is the exact sum of its children and child shares sum to 1', () => {
    fc.assert(fc.property(arbTree(4), tree => {
      const { m } = build(tree);
      for (let i = 0; i < m.count; i++) {
        const k = childCount(m, i);
        if (!k) continue;
        let sum = 0, share = 0;
        for (let c = 0; c < k; c++) { sum += m.value[childAt(m, i, c)]!; share += shareOfParent(m, childAt(m, i, c)) ?? 0; }
        expect(m.value[i]).toBe(sum);
        if (isPositive(m, i)) expect(share).toBeCloseTo(1, 12);
      }
      // Pre-order: each subtree is one contiguous range.
      for (let i = 0; i < m.count; i++) for (let j = i + 1; j < subtreeEnd(m, i); j++) expect(m.depth[j]).toBeGreaterThan(m.depth[i]!);
    }), { numRuns: 150 });
  });

  it('the same input always builds the same model (deterministic)', () => {
    fc.assert(fc.property(arbTree(3), tree => {
      const a = build(tree).m, b = build(tree).m;
      expect(Array.from(a.value)).toEqual(Array.from(b.value));
      expect(a.ids).toEqual(b.ids);
    }), { numRuns: 60 });
  });
});

describe('AX190: leaf values that cannot be drawn', () => {
  it('negative, NaN, infinite, string and missing values are reported with their rows and left out of the rollup', () => {
    const rows = [
      { id: 'r', parent: null },
      { id: 'a', parent: 'r', value: -1 },
      { id: 'b', parent: 'r', value: NaN },
      { id: 'c', parent: 'r', value: Infinity },
      { id: 'd', parent: 'r', value: '5' as unknown as number },
      { id: 'e', parent: 'r', value: null },
      { id: 'f', parent: 'r', value: 2 },
    ];
    const { m, sink } = build(rows);
    const d = sink.inputs().find(x => x.code === 'AX190')!;
    expect(d.level).toBe('warning');
    expect(d.effect).toBe('omitted');
    expect(d.origin).toBe('call');
    expect(d.rows).toEqual([1, 2, 3, 4, 5]);
    expect(d.count).toBe(5);
    expect(m.value[0]).toBe(2);
    const t = reader(m).table;
    expect(t.row(1)![2]).toBe(DEFAULT_HIERARCHY_MESSAGES.invalidValue);
    expect(t.row(5)![2]).toBe(DEFAULT_HIERARCHY_MESSAGES.noData);
    expect(t.row(6)).toEqual(['r / f', '1', '2', '100%', '100%']);
  });

  it('zero is a valid leaf value: drawn with no area, no diagnostic', () => {
    const { m, sink } = build({ label: 'R', children: [{ label: 'z', value: 0 }, { label: 'p', value: 1 }] });
    expect(codes(sink)).toEqual([]);
    expect(shareOfParent(m, 1)).toBe(0);
  });

  it('a branch total past the largest double is reported, and shares stay exact through scaled weights', () => {
    const big = Number.MAX_VALUE;
    const { m, sink } = build({ label: 'R', children: [{ label: 'x', value: big }, { label: 'y', value: big }] });
    expect(m.value[0]).toBe(Infinity);
    const d = sink.inputs().find(x => x.code === 'AX190')!;
    expect(d.effect).toBe('changed');
    expect(shareOfRoot(m, 1)).toBe(0.5);
    expect(reader(m).table.row(0)![2]).toMatch(/^more than /);
  });

  it('tiny positive values keep a positive, exact share', () => {
    const { m } = build({ label: 'R', children: [{ label: 'tiny', value: 5e-324 }, { label: 'one', value: 1 }] });
    expect(shareOfRoot(m, 1)).toBeGreaterThan(0);
    expect(shareOfRoot(m, 2)).toBe(1);
  });
});

describe('AX191: topology', () => {
  it('orphans, self-parents, cycles and duplicate ids are reported and left out with their descendants', () => {
    const rows = [
      { id: 'r', parent: null, value: 0 },
      { id: 'a', parent: 'r', value: 1 },
      { id: 'o', parent: 'missing', value: 5 },   // orphan
      { id: 'oc', parent: 'o', value: 5 },        // descendant of the orphan
      { id: 's', parent: 's', value: 5 },         // own parent
      { id: 'c1', parent: 'c2', value: 5 },       // cycle
      { id: 'c2', parent: 'c1', value: 5 },
      { id: 'a', parent: 'r', value: 9 },         // duplicate id
    ];
    const { m, sink } = build(rows);
    // Split by the field at fault: parents that never reach a top-level row, and the repeated id.
    const d = sink.inputs().find(x => x.code === 'AX191' && x.field === 'parent')!;
    expect(d.effect).toBe('omitted');
    expect(d.rows).toEqual([2, 3, 4, 5, 6]);
    expect(d.count).toBe(5);
    const dup = sink.inputs().find(x => x.code === 'AX191' && x.field === 'id')!;
    expect([dup.effect, dup.rows, dup.count]).toEqual(['omitted', [7], 1]);
    expect(m.labels).toEqual(['r', 'a']);
    expect(m.value[0]).toBe(1);
  });

  it('a nested node that contains itself is reported once and its repeat is left out', () => {
    const loop: { label: string; children: unknown[] } = { label: 'loop', children: [{ label: 'leaf', value: 2 }] };
    loop.children.push(loop);
    const { m, sink } = build({ label: 'R', children: [loop] });
    expect(sink.inputs().find(x => x.code === 'AX191')?.count).toBe(1);
    expect(m.labels).toEqual(['R', 'loop', 'leaf']);
    expect(m.value[0]).toBe(2);
  });

  it('the same object under two parents is not a cycle', () => {
    const shared = { label: 's', value: 1 };
    const { m, sink } = build({ label: 'R', children: [{ label: 'a', children: [shared] }, { label: 'b', children: [shared] }] });
    expect(codes(sink)).toEqual([]);
    expect(m.value[0]).toBe(2);
  });
});

describe('AX192: nothing to draw', () => {
  it.each([
    ['an empty array', []],
    ['no data', undefined],
    ['all-zero leaves', { label: 'R', children: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }],
    ['only invalid leaves', [{ label: 'a', value: -3 }]],
  ])('%s raises AX192', (_name, data) => {
    const { sink } = build(data);
    expect(codes(sink)).toContain('AX192');
  });
});

describe('deep trees', () => {
  it('a 20,000-level chain builds without recursion, nested and flat', () => {
    let node: HierarchyNode = { label: 'leaf', value: 7 };
    for (let i = 0; i < 20000; i++) node = { label: `n${i}`, children: [node] };
    const nested = build(node).m;
    expect(nested.maxDepth).toBe(20000);
    expect(nested.value[0]).toBe(7);
    const rows = Array.from({ length: 20001 }, (_, i) => ({ id: i, parent: i === 0 ? null : i - 1, value: i === 20000 ? 7 : undefined }));
    const flat = build(rows).m;
    expect(flat.maxDepth).toBe(20000);
    expect(flat.value[0]).toBe(7);
  });
});

describe('validate without a DOM', () => {
  it('validateTreemap and validateSunburst report the same codes in Node', () => {
    const options = { title: 'T', data: [{ id: 'a', parent: null, value: -1 }, { id: 'b', parent: 'nope', value: 1 }] };
    for (const v of [validateTreemap(options), validateSunburst(options)]) {
      expect(v.map(d => d.code).sort()).toEqual(['AX190', 'AX191', 'AX192']);
      expect(v.every(d => d.chart === 'T')).toBe(true);
    }
  });

  it('a chart without a title or labelledBy gets AX140, and an unknown option AX150', () => {
    const v = validateTreemap({ data: NESTED, colour: 'red' } as never);
    expect(v.map(d => d.code).sort()).toEqual(['AX140', 'AX150']);
  });
});

describe('subtree-local scaled totals (review finding 3)', () => {
  // R: big = 1e200, small = { s1: 1e-200, s2: 2e-200 }. Pre-order: R0 big1 small2 s1 3 s2 4.
  const DATA = { label: 'R', children: [
    { label: 'big', value: 1e200 },
    { label: 'small', children: [{ label: 's1', value: 1e-200 }, { label: 's2', value: 2e-200 }] },
  ] };

  it('a tiny branch beside 1e200 keeps its own exact split (1/3 : 2/3) and a positive total', () => {
    const { m, sink } = build(DATA);
    expect(codes(sink)).toEqual([]);
    expect(m.value[2]).toBe(1e-200 + 2e-200);
    expect(isPositive(m, 2)).toBe(true);
    expect(shareOfParent(m, 3)).toBeCloseTo(1 / 3, 14);
    expect(shareOfParent(m, 4)).toBeCloseTo(2 / 3, 14);
    // Of the original root: 1e200 is all of it; the small branch is below double resolution (3e-400 underflows).
    expect(shareOfRoot(m, 1)).toBe(1);
    expect(shareOfRoot(m, 2)).toBe(0);
    const t = reader(m).table;
    expect(t.row(3)![3]).toBe('33.3%');
    expect(t.row(4)![3]).toBe('66.7%');
  });

  it('overflowing siblings of 1e308 keep exact relative shares (1 : 2 : 1)', () => {
    const { m, sink } = build({ label: 'R', children: [{ label: 'a', value: 1e308 }, { label: 'b', children: [{ label: 'b1', value: 1e308 }, { label: 'b2', value: 1e308 }] }, { label: 'c', value: 1e308 }] });
    expect(sink.inputs().find(d => d.code === 'AX190')?.effect).toBe('changed');
    expect(m.value[0]).toBe(Infinity);
    expect(m.value[2]).toBe(Infinity);
    expect(shareOfRoot(m, 1)).toBeCloseTo(0.25, 14);
    expect(shareOfRoot(m, 2)).toBeCloseTo(0.5, 14);
    expect(shareOfParent(m, 3)).toBeCloseTo(0.5, 14);
    expect(shareOfRoot(m, 3)).toBeCloseTo(0.25, 14);
  });

  it('for any magnitudes, child shares of every positive branch sum to 1 and match the exact value ratio', () => {
    const leaf = fc.record({ label: fc.constant('x'), value: fc.oneof(fc.constant(0), fc.double({ min: 1e-300, max: 1e300, noNaN: true })) });
    const tree = fc.record({ label: fc.constant('R'), children: fc.array(fc.record({ label: fc.constant('b'), children: fc.array(leaf, { minLength: 1, maxLength: 4 }) }), { minLength: 1, maxLength: 4 }) });
    fc.assert(fc.property(tree, t => {
      const { m } = build(t);
      for (let i = 0; i < m.count; i++) {
        if (!isPositive(m, i) || !childCount(m, i)) continue;
        let sum = 0;
        for (let c = 0; c < childCount(m, i); c++) sum += shareOfParent(m, childAt(m, i, c))!;
        expect(sum).toBeCloseTo(1, 12);
        // Where the double sum is finite and normal, the scaled share agrees with it.
        for (let c = 0; c < childCount(m, i); c++) {
          const k = childAt(m, i, c);
          if (Number.isFinite(m.value[i]!) && m.value[i]! > 1e-290) expect(shareOfParent(m, k)!).toBeCloseTo(m.value[k]! / m.value[i]!, 12);
        }
      }
    }), { numRuns: 150 });
  });
});

describe('diagnostic fields and rows (review finding 6)', () => {
  it('AX190 names `value` with the caller rows; flat AX191 names `parent` for orphans and cycles and `id` for duplicates', () => {
    const { sink } = build([
      { id: 'r', parent: null }, { id: 'a', parent: 'r', value: -1 }, { id: 'o', parent: 'gone', value: 1 },
      { id: 'a', parent: 'r', value: 2 }, { id: 'b', parent: 'r', value: 3 },
    ]);
    const all = sink.inputs();
    const v = all.find(d => d.code === 'AX190')!;
    expect([v.field, v.rows, v.count]).toEqual(['value', [1], 1]);
    const parent = all.find(d => d.code === 'AX191' && d.field === 'parent')!;
    expect([parent.rows, parent.count]).toEqual([[2], 1]);
    const id = all.find(d => d.code === 'AX191' && d.field === 'id')!;
    expect([id.rows, id.count]).toEqual([[3], 1]);
  });

  it('nested AX190 rows are the pre-order indexes of the caller nodes; a nested cycle names `children`', () => {
    const loop: { label: string; children: unknown[] } = { label: 'loop', children: [] };
    loop.children.push({ label: 'bad', value: NaN }, loop);
    const { sink } = build({ label: 'R', children: [{ label: 'ok', value: 1 }, loop] });
    // Caller pre-order: R0 ok1 loop2 bad3 loop(repeat)4.
    const v = sink.inputs().find(d => d.code === 'AX190')!;
    expect([v.field, v.rows]).toEqual(['value', [3]]);
    const c = sink.inputs().find(d => d.code === 'AX191')!;
    expect([c.field, c.rows]).toEqual(['children', [4]]);
  });
});

describe('unique nested ids (review finding 7)', () => {
  it('duplicate sibling labels, separators in labels and explicit ids never collide', () => {
    const { m } = build({ label: 'R', children: [
      { label: 'Ops', value: 1 },
      { label: 'Ops', children: [{ label: 'x', value: 2 }] },
      { label: 'Ops/x', value: 3 },
      { id: 'Ops', label: 'Explicit', value: 4 },
      { label: 'Ops#2', value: 5 },
    ] });
    expect(new Set(m.ids).size).toBe(m.count);
    // Repair round 3: an explicit id used once in the tree is the node's id on its own ('Ops'); label-only
    // nodes keep their paths, numbered among themselves. Pre-order: Ops(label), Ops(label, branch), its x,
    // 'Ops/x', Explicit, 'Ops#2'.
    expect(m.ids).toEqual(['R', 'R/Ops', 'R/Ops#2', 'R/Ops#2/x', 'R/Ops\\/x', 'Ops', 'R/Ops\\#2']);
  });

  it('for any tree, ids are unique and the same input gives the same ids', () => {
    fc.assert(fc.property(arbTree(4), tree => {
      const a = build(tree).m;
      expect(new Set(a.ids).size).toBe(a.count);
      expect(build(tree).m.ids).toEqual(a.ids);
    }), { numRuns: 150 });
  });
});

describe('linear construction (review finding 8)', () => {
  it('a 200,000-node nested chain and a 200,000-node wide tree build in linear time', () => {
    let node: HierarchyNode = { label: 'leaf', value: 1 };
    for (let i = 0; i < 200000; i++) node = { label: 'n', children: [node] };
    const t0 = performance.now();
    const deep = build(node).m;
    const deepMs = performance.now() - t0;
    expect(deep.count).toBe(200001);
    expect(deep.maxDepth).toBe(200000);
    expect(new Set(deep.ids).size).toBe(deep.count);
    // A quadratic ancestor scan would need ~2e10 steps here; linear work finishes in well under the bound.
    expect(deepMs).toBeLessThan(5000);
    const wide = build({ label: 'R', children: Array.from({ length: 200000 }, () => ({ label: 'same', value: 1 })) }).m;
    expect(wide.count).toBe(200001);
    expect(new Set(wide.ids).size).toBe(wide.count);
    expect(Array.isArray(wide.labels)).toBe(true);
    expect(wide.parent).toBeInstanceOf(Int32Array);
  });
});

describe('AX190 example rows over many invalid leaves', () => {
  it('reports the first ten caller rows and the full count', () => {
    const rows = [{ id: 'r', parent: null }, ...Array.from({ length: 500 }, (_, i) => ({ id: `x${i}`, parent: 'r', value: i % 2 ? -1 : 1 }))];
    const d = build(rows).sink.inputs().find(x => x.code === 'AX190')!;
    expect(d.count).toBe(250);
    expect(d.rows).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });
});
