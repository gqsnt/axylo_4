/**
 * Decodes the PNG screenshots Chrome returns (8-bit RGB or RGBA, not interlaced) into RGBA pixels, so a
 * test can check what was painted. No dependency: zlib and the five PNG row filters.
 */
import { inflateSync } from 'node:zlib';

export interface Image { width: number; height: number; rgba: Uint8Array }

export function decodePng(png: Uint8Array): Image {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0, height = 0, channels = 0;
  const idat: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = data[8], color = data[9], interlace = data[12];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth}, color ${color}, interlace ${interlace}`);
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      let v = line[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = row[x * channels + k]!;
      out[(y * width + x) * 4 + 3] = channels === 4 ? row[x * channels + 3]! : 255;
    }
    previous = row;
  }
  return { width, height, rgba: out };
}

/** How many pixels are within `tolerance` (per channel) of the colour `rgb`. */
export function countNear(image: Image, rgb: readonly [number, number, number], tolerance = 12): number {
  let n = 0;
  for (let i = 0; i < image.rgba.length; i += 4) {
    if (Math.abs(image.rgba[i]! - rgb[0]) <= tolerance && Math.abs(image.rgba[i + 1]! - rgb[1]) <= tolerance && Math.abs(image.rgba[i + 2]! - rgb[2]) <= tolerance) n++;
  }
  return n;
}

export const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
