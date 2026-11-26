/**
 * The table's jump box: reads what a reader typed as an x value in the chart's own number and date formats.
 */
import type { XValue } from '../core/contracts';
import { readPosition } from '../reader/x';
import { printedX } from '../reader/table';
import { xKindOf } from './interaction-nav';
import type { ControlsState } from './interaction-types';

export const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
export const normalized = (s: string) => s.normalize('NFKC').replace(BIDI, '').replace(/[\s\u00a0\u202f]+/gu, ' ').trim().toLowerCase();
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseNumberAs(text: string, format: (n: number) => string, count: (n: number) => string): number | null {
  const digits = new Map<string, string>();
  for (let d = 0; d < 10; d++) { const w = count(d); if ([...w].length === 1) digits.set(w, String(d)); }
  const ascii = (s: string) => [...s.replace(BIDI, '')].map(ch => digits.get(ch) ?? ch).join('');
  const m = /^(\D*)(\d.*\d|\d)(\D*)$/u.exec(ascii(format(1234.5)));
  if (!m) return null;
  const pre = m[1]!.trim(), core = m[2]!, suf = m[3]!.trim();
  const marks = [...core.replace(/\d/g, '')];
  const dec = marks.length > 1 || (marks.length === 1 && /\D\d$/u.test(core)) ? marks.at(-1)! : '.';
  const grp = [...ascii(count(1234567)).replace(/\d/g, '')][0] ?? '';
  let body = ascii(text).trim();
  if (pre && body.startsWith(pre)) body = body.slice(pre.length).trim();
  if (suf && body.endsWith(suf)) body = body.slice(0, -suf.length).trim();
  const neg = /^[-−‒–]/u.exec(body);
  if (neg) body = body.slice(neg[0].length);
  const [ip = '', fp, extra] = body.split(dec);
  if (extra !== undefined || !ip) return null;
  const id = grp ? ip.replace(new RegExp(/^[\s\u00a0\u202f]$/u.test(grp) ? '[\\s\\u00a0\\u202f]' : escapeRe(grp), 'gu'), '') : ip;
  if (!/^\d+$/.test(id) || (fp !== undefined && !/^\d+$/.test(fp))) return null;
  if (id !== ip && normalized(ip) !== normalized(ascii(count(Number(id))))) return null;
  const v = Number(`${neg ? '-' : ''}${id}${fp !== undefined ? `.${fp}` : ''}`);
  return Number.isFinite(v) ? v : null;
}

export function resolveJumpTarget(d: ControlsState | null, raw: string): XValue | null {
  if (!d?.reader.table) return null;
  const { view, formatters: f } = d, kind = xKindOf(view);
  if (kind === 'category') return raw;
  const text = raw.trim();
  if (!text) return null;
  const want = normalized(text), written = () => printedX(view, f, p => normalized(p) === want);
  if (kind === 'number') {
    const n = parseNumberAs(text, f.x, f.count);
    return n === null ? written() : normalized(f.x(n)) === want ? n : written() ?? n;
  }
  const zone = view.kind === 'scatter' ? view.frame.timeZone : view.kind === 'donut' ? null : view.frame.x.timeZone;
  const pos = (v: XValue) => { try { return readPosition(v, kind, zone); } catch { return NaN; } };
  if (Number.isFinite(pos(text))) return text;
  const parsed = Date.parse(text.replace(/,?\s*(?:UTC|GMT)$/u, ' UTC'));
  if (!Number.isFinite(parsed)) return written();
  const at = new Date(parsed), pad = (n: number) => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const cand: XValue = kind === 'time' ? at : kind === 'date' ? day : `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  const p = pos(cand);
  return Number.isFinite(p) && normalized(f.x(p)) === want ? cand : written();
}
