import { describe, expect, it } from 'vitest';
import { record } from './host';

describe('public chart handle detached methods', () => {
  it('supports destructured and receiver-less calls to update, append, zoom, on, and destroy', () => {
    const rec = record('line', {
      title: 'Detached handle',
      data: [
        { x: 1, y: 10 },
        { x: 2, y: 20 },
      ],
      x: 'x',
      y: 'y',
    });
    const chart = rec.controller.handle;

    const { update, append, zoom, on, destroy } = chart;
    expect(chart.update).toBe(update);
    expect(chart.append).toBe(append);
    expect(chart.zoom).toBe(zoom);
    expect(chart.on).toBe(on);
    expect(chart.destroy).toBe(destroy);

    const events: unknown[] = [];
    const off = on('zoom', (range) => events.push(range));
    expect(() => update({ subtitle: 'Updated' })).not.toThrow();
    expect(() => append([{ x: 3, y: 30 }])).not.toThrow();
    expect(() => zoom([1, 2])).not.toThrow();
    rec.frames();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(() => off()).not.toThrow();
    expect(() => destroy()).not.toThrow();
    expect(chart.diagnostics).toEqual([]);
  });
});
