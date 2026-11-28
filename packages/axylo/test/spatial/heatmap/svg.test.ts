/**
 * Constant-DOM drawing: the real SVG renderer (svgRendererWith) with the heatmap's mark handlers, on the N3 DOM
 * double (test/core/n3-dom.ts), counting every element it creates. A 250 × 200 matrix (50,000 cells) must make
 * one <path> per non-empty color bin plus one for missing and one for invalid cells, and at most 80 SVG nodes in
 * the plot in total. Measurements for the ledger (build time, path data bytes) are printed with a fixed label.
 */
import { describe, expect, it } from 'vitest';
import type { PaintBindings, RectMark, ResolvedTheme } from '../../../src/core/contracts';
import { svgRendererWith } from '../../../src/render/svg';
import { TOKEN_BINDINGS } from '../../../src/theme';
import { AXYLO_CSS } from '../../../src/theme/css';
import { binColor } from '../../../src/spatial/color-scale';
import { INVALID_PAINT } from '../../../src/spatial/heatmap/render';
import { NO_BIN } from '../../../src/spatial/heatmap/core';
import { buildHeatmapScene, cellTagOf, heatmapSvgMarks, MISSING_PAINT } from '../../../src/spatial/heatmap/render';
import { TestDocument, type TestElement } from '../../core/n3-dom';
import { grid, stage, typedGrid } from './fixtures';

const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: ['var(--axylo-series-color-1)'] };
const theme: ResolvedTheme = { scheme: 'light', forcedColors: false, moreContrast: false, paints: bindings };

function countingDocument() {
  const doc = new TestDocument();
  let created = 0;
  const make = doc.createElementNS.bind(doc);
  doc.createElementNS = (ns: string, tag: string) => { created++; return make(ns, tag); };
  return { doc, created: () => created };
}

function descendants(el: TestElement): TestElement[] {
  return [el, ...el.children.flatMap(descendants)];
}

/** The 250 × 200 fixture: a smooth gradient with a missing cell every 97th and an invalid one every 1,001st. */
function dense() {
  return grid(250, 200, (r, c) => {
    const k = r * 200 + c;
    if (k % 1001 === 500) return 'bad';
    if (k % 97 === 3) return null;
    return Math.sin(r / 17) * 50 + Math.cos(c / 23) * 50;
  });
}

describe('constant DOM', () => {
  it('draws 50,000 cells as ≤ bins + 2 paths and ≤ 80 SVG nodes in the plot', () => {
    const s = stage({ data: dense() }, { width: 900, height: 640 });
    const bins = s.m.domain!.bins;
    const tags = s.scene.marks.map(m => cellTagOf(m)!);
    const binMarks = tags.filter(t => t.kind === 'bin');
    // Per-bin batching: every non-empty bin exactly once, in bin order.
    const used = new Set<number>();
    for (let i = 0; i < s.m.bin.length; i++) if (s.m.bin[i] !== NO_BIN) used.add(s.m.bin[i]!);
    expect(binMarks.map(t => t.kind === 'bin' && t.bin)).toEqual([...used].sort((a, b) => a - b));
    expect(tags.filter(t => t.kind === 'missing')).toHaveLength(1);
    expect(tags.filter(t => t.kind === 'invalid')).toHaveLength(1);
    expect(s.scene.marks.length).toBeLessThanOrEqual(bins + 2);

    const { doc, created } = countingDocument();
    const renderer = svgRendererWith(heatmapSvgMarks, doc as unknown as Document);
    renderer.draw(s.scene, bindings, theme, 1);
    const svg = renderer.element as unknown as TestElement;
    const all = descendants(svg);
    const paths = all.filter(e => e.tagName === 'PATH');
    expect(paths).toHaveLength(s.scene.marks.length);
    expect(all.length).toBeLessThanOrEqual(80);
    expect(created()).toBeLessThanOrEqual(80);
    console.log(`[n8a-ledger] dense fixture (250x200, missing every 97th, invalid every 1001st), 900x640: ${s.scene.marks.length} marks, ${paths.length} paths (${binMarks.length} bins + missing + invalid), ${all.length} SVG nodes, ${created()} created`);
    // Drawing the same scene again creates nothing.
    const before = created();
    renderer.draw(s.scene, bindings, theme, 1);
    expect(created()).toBe(before);
    // A focus outline (8 rules) still keeps the plot under the cap.
    renderer.drawOverlay({ clip: s.scene.clip, clipped: [], unclipped: [] }, bindings, theme, 1);
    expect(descendants(svg).length).toBeLessThanOrEqual(80);
    renderer.destroy();
  });

  it('paints bins through `color` (CSS expression) and strokes missing cells, never filling them', () => {
    const s = stage({ data: grid(2, 3, (_r, c) => [0, null, 'x'][c]) });
    const { doc } = countingDocument();
    const renderer = svgRendererWith(heatmapSvgMarks, doc as unknown as Document);
    renderer.draw(s.scene, bindings, theme, 1);
    const paths = descendants(renderer.element as unknown as TestElement).filter(e => e.tagName === 'PATH');
    const byClass = (c: string) => paths.find(p => (p.getAttribute('class') ?? '').includes(c))!;
    const zero = byClass('axylo-heatmap-bin');
    expect(String(zero.style.color)).toMatch(/^var\(--axylo-forced-series, /);
    expect(zero.style.fill).toBe('currentColor');
    const missing = byClass('axylo-heatmap-missing');
    expect(missing.style.fill).toBe('none');
    expect(missing.style.stroke).toBe('currentColor');
    expect(missing.style.color).toBe(MISSING_PAINT);
    const invalid = byClass('axylo-heatmap-invalid');
    expect(invalid.style.fill).toBe('none');
    // Two cells per row: the zero cell in a bin path, missing hatched once, invalid crossed (three subpaths).
    expect((missing.getAttribute('d')!.match(/M/g) ?? []).length).toBe(2 * 2);
    expect((invalid.getAttribute('d')!.match(/M/g) ?? []).length).toBe(2 * 3);
  });

  it('merges runs of one bin across rows only when cells are too small to separate', () => {
    const big = stage({ data: grid(2, 4, () => 5) });
    const box = (big.scene.marks[0] as RectMark).xywh;
    // Cells ≥ 6 px keep a 0.5 px inset each side: 8 separate rectangles.
    expect(box.length / 4).toBe(8);
    const tiny = stage({ data: typedGrid(100, 300, () => 5) });
    // The 100 equal, touching row spans cover one rectangle.
    expect((tiny.scene.marks[0] as RectMark).xywh.length / 4).toBe(1);
  });

  it('measures the 250 × 200 build (Node; reported for the ledger)', () => {
    const data = typedGrid(250, 200, (r, c) => Math.sin(r / 17) * 50 + Math.cos(c / 23) * 50);
    const warm = stage({ data }, { width: 900, height: 640 });
    expect(warm.scene.marks.length).toBeGreaterThan(0);
    const times: number[] = [];
    let bytes = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const s = stage({ data }, { width: 900, height: 640 });
      const { doc } = countingDocument();
      const renderer = svgRendererWith(heatmapSvgMarks, doc as unknown as Document);
      renderer.draw(s.scene, bindings, theme, 1);
      times.push(performance.now() - t0);
      bytes = descendants(renderer.element as unknown as TestElement).filter(e => e.tagName === 'PATH')
        .reduce((sum, p) => sum + (p.getAttribute('d') ?? '').length, 0);
    }
    times.sort((a, b) => a - b);
    console.log(`[n8a-ledger] 250x200 typed, 900x640, stages+draw ms: median ${times[2]!.toFixed(1)} min ${times[0]!.toFixed(1)} max ${times[4]!.toFixed(1)}; path d bytes ${bytes}`);
    expect(bytes).toBeGreaterThan(0);
  });

  it('forced colors: every heatmap paint switches on the core sheet\'s forced-only variables to system colors', () => {
    // The core stylesheet sets --axylo-forced-series (CanvasText) and --axylo-background (Canvas) with !important
    // inside @media (forced-colors: active) only; the heatmap's paints all start with the first, and the plot's
    // background rect uses the second, so cells become CanvasText on Canvas, separated by background gaps.
    const forced = AXYLO_CSS.slice(AXYLO_CSS.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/--axylo-forced-series: CanvasText !important;/);
    expect(forced).toMatch(/--axylo-background: Canvas !important;/);
    expect(AXYLO_CSS.slice(0, AXYLO_CSS.indexOf('@media (forced-colors: active)'))).not.toMatch(/--axylo-forced-series:/);
    for (const paint of [binColor('sequential', 3, 32), binColor('diverging', 30, 32), MISSING_PAINT, INVALID_PAINT]) {
      expect(paint.startsWith('var(--axylo-forced-series, ')).toBe(true);
    }
  });

  it('cells of 6 px or more keep a 1 px gap of background between neighbours (visible outlines in forced colors)', () => {
    const s = stage({ data: grid(2, 3, (r, c) => r * 3 + c) });
    const boxes: number[][] = [];
    for (const m of s.scene.marks) {
      const q = (m as RectMark).xywh;
      for (let i = 0; i < q.length; i += 4) boxes.push([q[i]!, q[i + 1]!, q[i + 2]!, q[i + 3]!]);
    }
    boxes.sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);
    expect(boxes).toHaveLength(6);
    const right = boxes[1]![0]! - (boxes[0]![0]! + boxes[0]![2]!);
    const below = boxes[3]![1]! - (boxes[0]![1]! + boxes[0]![3]!);
    expect(right).toBeCloseTo(1, 4);
    expect(below).toBeCloseTo(1, 4);
  });
});
