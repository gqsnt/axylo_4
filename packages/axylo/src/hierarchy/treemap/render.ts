/** Treemap drawing: tiles, branch headers, fitted labels and outlines over the squarified layout. */
import { fitLabel, label, nodeFill, paint, round, seriesPaint, svg, TOKENS, type Driver, type RenderContext, type Rendered } from '../draw';
import { childCount, isPositive, subtreeEnd } from '../tree';
import { layoutTreemap, pickTreemap } from './layout';

const PAD = 4;
/** One CSS px of background between neighbouring tiles (spec A5). */
const SEPARATOR = 1;

export const TREEMAP_DRIVER: Driver = {
  type: 'treemap',
  render(ctx: RenderContext): Rendered {
    const { model: m, root, doc } = ctx;
    const header = Math.ceil(ctx.lineHeight + 4);
    const g = layoutTreemap(m, root, { x: 0, y: 0, width: ctx.width, height: ctx.height }, { header, padding: 2 });
    const end = subtreeEnd(m, root);
    let labelled = 0;
    for (let i = root; i < end; i++) {
      const branch = childCount(m, i) > 0;
      // The root's area is its children's; only a root that is itself a leaf (a one-node tree) is a tile,
      // and only when it has a positive value to show.
      if (i === root && (branch || !isPositive(m, i))) continue;
      const x = g.x[i]!, y = g.y[i]!, w = g.w[i]!, h = g.h[i]!;
      if (!(w > 0 && h > 0)) continue;
      const rect = svg(doc, 'rect', { x: round(x), y: round(y), width: round(w), height: round(h), 'data-node': i });
      // Branches are drawn as their header strip on the background; their area is their children's.
      paint(rect, 'fill', branch ? TOKENS.background : i === root && root === 0 ? seriesPaint(0) : nodeFill(m, i));
      paint(rect, 'stroke', branch ? TOKENS.muted : TOKENS.background);
      paint(rect, 'stroke-width', `${SEPARATOR}px`);
      paint(rect, 'vector-effect', 'non-scaling-stroke');
      ctx.marks.appendChild(rect);
      if (branch) {
        const head = g.header[i]!;
        if (head <= 0) continue;
        const text = fitLabel(m.labels[i]!, ctx.measure, width => width <= w - 2 * PAD);
        if (text) { label(ctx, text, x + PAD, y + head / 2, 'start', 600); labelled++; }
      } else if (h >= ctx.lineHeight + 2 * PAD && w >= 2 * PAD + 8) {
        const text = fitLabel(m.labels[i]!, ctx.measure, width => width <= w - 2 * PAD);
        if (text) { label(ctx, text, x + PAD, y + PAD + ctx.lineHeight / 2, 'start'); labelled++; }
      }
    }
    return {
      labelled,
      pick: (px, py) => pickTreemap(m, g, px, py),
      anchor(node) {
        const w = g.w[node]!, h = g.h[node]!;
        if (!(w >= 0) || !(h >= 0) || Number.isNaN(g.x[node]!)) return null;
        return { x: g.x[node]!, y: g.y[node]!, width: w, height: h };
      },
      outline(group, node, kind) {
        const w = g.w[node]!, h = g.h[node]!;
        if (Number.isNaN(g.x[node]!)) return;
        // A tile too small to see still gets a visible ring: at least 4 CSS px, centered on it.
        const ow = Math.max(4, w), oh = Math.max(4, h);
        const inset = kind === 'focus' ? 1.5 : 1;
        const r = svg(doc, 'rect', {
          x: round(g.x[node]! + (w - ow) / 2 + inset), y: round(g.y[node]! + (h - oh) / 2 + inset),
          width: round(Math.max(1, ow - 2 * inset)), height: round(Math.max(1, oh - 2 * inset)), 'data-outline': kind,
        });
        paint(r, 'fill', 'none');
        paint(r, 'stroke', kind === 'focus' ? TOKENS.focus : TOKENS.text);
        paint(r, 'stroke-width', kind === 'focus' ? '3px' : '1.5px');
        group.appendChild(r);
      },
    };
  },
};
