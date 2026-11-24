import { describe, expect, it, vi } from 'vitest';
import { areaData, pathData } from '../../src/render/svg';

const f = (v: number): number => Math.round(v * 100) / 100;

describe('svg byte-buffer path serializer edge cases', () => {
  it('handles extreme fallback coordinates beyond +-2e7 without truncation', () => {
    const xy = new Float32Array([2e11, 2e11, 1e20, -123456.78, 0, -0.004, 12.345, -0.05]);
    const d = pathData(xy);
    expect(d).toBe(
      `M${f(xy[0]!)} ${f(xy[1]!)}L${f(xy[2]!)} ${f(xy[3]!)}L${f(xy[4]!)} ${f(xy[5]!)}L${f(xy[6]!)} ${f(xy[7]!)}`,
    );
  });

  it('serializes multi-run area paths with extreme coordinates cleanly', () => {
    const upper = new Float32Array([0, 10, 1e20, 20]);
    const lower = new Float32Array([0, 0, 1e20, -1e20]);
    const d = areaData({
      type: 'area',
      series: 0,
      upper,
      lower,
      runs: new Uint32Array([0, 2, 0, 2]),
      fill: { kind: 'series', index: 0 },
      opacity: 0.25,
    });
    expect(d).toBe(
      `M0 10L${f(upper[2]!)} 20L${f(lower[2]!)} ${f(lower[3]!)}L0 0Z`,
    );
  });

  it('releases scratch storage over 16 KiB and reuses the next small buffer', () => {
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    try {
      const large = new Float32Array(2 * 1024);
      const small = Float32Array.of(1, 2, 3, 4);
      pathData(large);
      pathData(small);
      pathData(small);

      const [first, second, third] = decode.mock.calls.map(([bytes]) => {
        if (!(bytes instanceof Uint8Array)) throw new Error('Expected a byte view');
        return bytes.buffer;
      });
      expect(first!.byteLength).toBeGreaterThan(16 * 1024);
      expect(second!.byteLength).toBeLessThanOrEqual(16 * 1024);
      expect(second).not.toBe(first);
      expect(third).toBe(second);
    } finally {
      decode.mockRestore();
    }
  });
});
