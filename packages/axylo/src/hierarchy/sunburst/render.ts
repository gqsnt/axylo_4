/** Sunburst drawing: rings of sectors with background separators, fitted labels, the center disc and outlines. */
import { fitLabel, label, nodeFill, paint, round, svg, TOKENS, type Driver, type RenderContext, type Rendered } from '../draw';
import { subtreeEnd } from '../tree';
import { inSector, layoutSunburst, pickSunburst, polar, sectorPath, TURN } from './layout';

/** Background between neighbouring sectors and rings, in CSS px (spec A5: at least 1 px). */
export const SEPARATOR = 1.5;

export const SUNBURST_DRIVER: Driver = {
  type: 'sunburst',
  render(ctx: RenderContext): Rendered {
    const { model: m, root, doc } = ctx;
    const radius = Math.max(0, Math.min(ctx.width, ctx.height) / 2 - 2);
    const cx = ctx.width / 2, cy = ctx.height / 2;
    const g = layoutSunburst(m, root, cx, cy, radius);
    const end = subtreeEnd(m, root);
    let labelled = 0;
    const lh = ctx.lineHeight;
    for (let i = root; i < end; i++) {
      const a0 = g.a0[i]!, a1 = g.a1[i]!, r0 = g.r0[i]!, r1 = g.r1[i]!;
      if (!(a1 > a0)) continue;
      const d = sectorPath(cx, cy, r0, r1, a0, a1);
      if (!d) continue;
      const path = svg(doc, 'path', { d, 'data-node': i });
      paint(path, 'fill', i === root ? TOKENS.background : nodeFill(m, i));
      if (i !== root && m.depth[i]! - m.depth[root]! > 1) {
        // Deeper rings of one family are lighter, so a ring boundary reads without the separator alone.
        paint(path, 'fill-opacity', String(Math.max(0.55, 1 - 0.15 * (m.depth[i]! - m.depth[root]! - 1))));
      }
      paint(path, 'stroke', i === root ? TOKENS.muted : TOKENS.background);
      paint(path, 'stroke-width', `${SEPARATOR}px`);
      paint(path, 'stroke-linejoin', 'round');
      ctx.marks.appendChild(path);
      if (i === root) {
        const half = Math.sqrt(Math.max(0, r1 * r1 - (lh / 2) * (lh / 2)));
        const text = fitLabel(m.labels[i]!, ctx.measure, width => width <= 2 * half - 8);
        if (text) { label(ctx, text, cx, cy, 'middle', 600); labelled++; }
        continue;
      }
      if (r1 - r0 < lh + 2) continue;
      const mid = (a0 + a1) / 2, rm = (r0 + r1) / 2;
      const [lx, ly] = polar(cx, cy, mid, rm);
      // A horizontal label fits when all four corners and edge midpoints of its box stay inside the sector.
      const fits = (width: number): boolean => {
        const hw = width / 2 + 2, hh = lh / 2;
        for (const [px, py] of [[lx - hw, ly - hh], [lx + hw, ly - hh], [lx - hw, ly + hh], [lx + hw, ly + hh], [lx, ly - hh], [lx, ly + hh], [lx - hw, ly], [lx + hw, ly]] as const) {
          if (!inSector(cx, cy, r0 + 1, r1 - 1, a0, a1, px, py)) return false;
        }
        return true;
      };
      const text = fitLabel(m.labels[i]!, ctx.measure, fits);
      if (text) { label(ctx, text, lx, ly, 'middle'); labelled++; }
    }
    return {
      labelled,
      pick: (px, py) => pickSunburst(m, g, px, py),
      anchor(node) {
        const a0 = g.a0[node]!, a1 = g.a1[node]!;
        if (Number.isNaN(a0)) return null;
        if (node === root) return { x: cx - g.ring, y: cy - g.ring, width: 2 * g.ring, height: 2 * g.ring };
        const [x, y] = polar(cx, cy, (a0 + a1) / 2, (g.r0[node]! + g.r1[node]!) / 2);
        return { x, y, width: 0, height: 0 };
      },
      outline(group, node, kind) {
        const a0 = g.a0[node]!, a1 = g.a1[node]!;
        if (Number.isNaN(a0)) return;
        // A sliver keeps a visible outline: at least 2 degrees of arc around its middle.
        const min = Math.PI / 90, span = a1 - a0;
        const from = span >= min ? a0 : Math.max(0, (a0 + a1) / 2 - min / 2), to = span >= min ? a1 : Math.min(TURN, from + min);
        const inset = kind === 'focus' ? 1.5 : 1;
        const d = sectorPath(cx, cy, Math.max(0, g.r0[node]! + (node === root ? 0 : inset)), Math.max(1, g.r1[node]! - inset), from, to);
        if (!d) return;
        const p = svg(doc, 'path', { d, 'data-outline': kind });
        paint(p, 'fill', 'none');
        paint(p, 'stroke', kind === 'focus' ? TOKENS.focus : TOKENS.text);
        paint(p, 'stroke-width', kind === 'focus' ? '3px' : '1.5px');
        group.appendChild(p);
      },
    };
  },
};

