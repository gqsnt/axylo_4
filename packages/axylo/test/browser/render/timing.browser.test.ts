/**
 * Rough timing of one path of 4,000 and of 400,000 vertices per renderer. Not a benchmark (bench/ owns
 * those) and not run by default, to keep the machine quiet: set AXYLO_RENDER_TIMING=1 to run it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import type {} from './entries/api';
import { close, open } from './util';

const enabled = process.env.AXYLO_RENDER_TIMING === '1';

describe.runIf(enabled)('rough draw timing', () => {
  beforeAll(start);
  afterAll(stop);

  it('reports draw() and draw-to-frame times', async () => {
    const page = await open();
    const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1]!;
    for (const vertices of [4000, 400000]) {
      for (const kind of ['canvas', 'svg'] as const) {
        const r = await page.evaluate(([k, n]) => window.axr.time(k, n, 5), [kind, vertices] as const);
        console.log(`${kind} ${vertices} vertices: draw() median ${median(r.draw).toFixed(1)} ms (${r.draw.map(v => v.toFixed(1)).join(', ')}); to next frames median ${median(r.painted).toFixed(1)} ms`);
        expect(r.draw).toHaveLength(5);
      }
    }
    await close(page);
  });
});
