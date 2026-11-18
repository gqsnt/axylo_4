/**
 * Minimal PNG decoder for Playwright screenshots (8-bit, non-interlaced, grayscale/RGB/RGBA), so pixels can
 * be sampled in Node without a dependency.
 */
import zlib from 'node:zlib';

export interface Image { readonly width: number; readonly height: number; readonly data: Uint8Array }

export function decodePng(buf: Buffer): Image {
  let pos = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const name = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; type = data[9]!; interlace = data[12]!; }
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (depth !== 8 || interlace !== 0 || channels === undefined) throw new Error(`unsupported PNG: depth ${depth}, type ${type}, interlace ${interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const v = raw[src + i]!;
      const a = i >= channels ? px[row + i - channels]! : 0;
      const b = y > 0 ? px[row - stride + i]! : 0;
      const c = y > 0 && i >= channels ? px[row - stride + i - channels]! : 0;
      let out: number;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      px[row + i] = out & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const o = i * 4;
    if (channels >= 3) { data[o] = px[j]!; data[o + 1] = px[j + 1]!; data[o + 2] = px[j + 2]!; data[o + 3] = channels === 4 ? px[j + 3]! : 255; }
    else { data[o] = data[o + 1] = data[o + 2] = px[j]!; data[o + 3] = channels === 2 ? px[j + 1]! : 255; }
  }
  return { width, height, data };
}
