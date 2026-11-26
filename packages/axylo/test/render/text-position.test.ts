import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { PlacedText } from '../../src/core/contracts';
import { createTextLayer } from '../../src/render/text';

class TestNode {
  readonly children: TestNode[] = [];
  readonly attrs = new Map<string, string>();
  readonly declarations = new Map<string, string>();
  parentNode: TestNode | null = null;
  className = '';
  styleWrites = 0;

  readonly style = {
    setProperty: (name: string, value: string) => {
      this.styleWrites++;
      if (value === '') this.declarations.delete(name);
      else this.declarations.set(name, value);
    },
    set transform(value: string) { this.setProperty('transform', value); },
  };

  constructor(private readonly fragment = false) {}

  get firstChild(): TestNode | null { return this.children[0] ?? null; }
  get lastElementChild(): TestNode | null { return this.children.at(-1) ?? null; }
  get nextSibling(): TestNode | null {
    const siblings = this.parentNode?.children;
    return siblings?.[siblings.indexOf(this) + 1] ?? null;
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  appendChild(node: TestNode): void { this.insertBefore(node, null); }
  insertBefore(node: TestNode, next: TestNode | null): void {
    if (node.fragment) {
      while (node.firstChild) this.insertBefore(node.firstChild, next);
      return;
    }
    node.remove();
    this.children.splice(next === null ? this.children.length : this.children.indexOf(next), 0, node);
    node.parentNode = this;
  }
  remove(): void {
    const siblings = this.parentNode?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
}

function fixture() {
  const doc = { createElement: () => new TestNode(), createDocumentFragment: () => new TestNode(true) };
  const layer = createTextLayer(doc as unknown as Document);
  return { layer, root: layer.element as unknown as TestNode };
}

function tick(full: string, x: number, y = 3): PlacedText {
  return { lines: [full], full, x, y, anchor: 'start', baseline: 'top', rotate: 0, role: 'tick-x', box: { x, y, width: 6, height: 15 } };
}

it('uses offsets only for a top-left anchor at zero rotation and clears positioning on reuse', () => {
  const { layer, root } = fixture();
  const start = tick('A', 12.25, 21.5);
  layer.render([start]);
  const label = root.children[0]!;

  fc.assert(fc.property(
    fc.constantFrom('start', 'middle', 'end'), fc.constantFrom('top', 'middle', 'bottom'), fc.constantFrom(0, -45, -90),
    (anchor, baseline, rotate) => {
      layer.render([{ ...start, anchor, baseline, rotate }]);
      expect(root.children[0]).toBe(label);
      expect(label.className).toBe(anchor === 'end' ? 'axylo-label' : `axylo-label axylo-label-${anchor}`);
      if (anchor === 'start' && baseline === 'top' && rotate === 0) {
        expect(Object.fromEntries(label.declarations)).toEqual({ left: '12.25px', top: '21.5px' });
      } else {
        const rotation = rotate === 0 ? '' : ` rotate(${rotate}deg)`;
        const dx = { start: '0%', middle: '-50%', end: '-100%' }[anchor];
        const dy = { top: '0%', middle: '-50%', bottom: '-100%' }[baseline];
        const shift = dx === '0%' && dy === '0%' ? '' : ` translate(${dx},${dy})`;
        expect(Object.fromEntries(label.declarations)).toEqual({ transform: `translate(12.25px,21.5px)${rotation}${shift}` });
      }
    },
  ), { numRuns: 1000 });
});

it('slides top-left ticks with the group and updates only the recycled or moved labels', () => {
  const { layer, root } = fixture();
  layer.render([tick('A', 10), tick('B', 20), tick('C', 30)]);
  const [a, b, c] = root.children as [TestNode, TestNode, TestNode];
  b.styleWrites = c.styleWrites = 0;

  layer.render([tick('B', 15), tick('C', 25)]);
  const group = root.children[0]!;
  expect(group.className).toBe('axylo-tick-x-group');
  expect(group.children).toEqual([b, c]);
  expect(group.declarations.get('transform')).toBe('translate(-5px,0px)');

  const entering = { ...tick('D', 33), rotate: -45 };
  layer.render([tick('B', 13), tick('C', 23), entering]);
  expect(group.children[2]).toBe(a);
  expect(Object.fromEntries(a.declarations)).toEqual({ transform: 'translate(40px,3px) rotate(-45deg)' });
  expect(group.declarations.get('transform')).toBe('translate(-7px,0px)');

  a.styleWrites = 0;
  layer.render([tick('B', 12), tick('C', 22), { ...entering, x: 32 }]);
  expect(group.declarations.get('transform')).toBe('translate(-8px,0px)');
  expect([a, b, c].map(label => label.styleWrites)).toEqual([0, 0, 0]);

  layer.render([tick('C', 22)]);
  expect(root.children[0]).toBe(c);
  expect(Object.fromEntries(c.declarations)).toEqual({ left: '22px', top: '3px' });
  expect(c.styleWrites).toBe(1);
});
