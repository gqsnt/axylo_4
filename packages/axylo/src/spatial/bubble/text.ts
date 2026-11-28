/** Sizes as readers see them: per locale and meta (spec F6, with the size field's unit and format). */
import type { Messages } from '../../public';
import { createNumberReadout } from '../../format/number';
import type { BubbleMeta } from './options';

let readouts: WeakMap<BubbleMeta, Map<string, Readout>> | undefined;
let failures: WeakSet<BubbleMeta> | undefined;
let watchers: WeakMap<BubbleMeta, () => boolean> | undefined;
/** Set by the wrapped author format when it throws: which read fell back is known per call, not once per readout. */
let threw = false;

interface Readout {
  read: (v: number) => string;
  /** Options the engine rejected: every read of this readout shows the default text. */
  broken: boolean;
}

/**
 * Calls `onFailure` for every read whose size format threw (the default text was shown instead). Rows are
 * formatted lazily (table, tooltip, export), often outside any frame and possibly from a table of a revision
 * that is no longer the active one, so the caller decides whether a failure belongs to the revision it can
 * report against: it returns false for a read it does not own, which then is not counted as this meta's failure
 * (sizeFormatFailed) either. A later watcher for the same meta replaces the earlier one.
 */
export function watchSizeFormat(meta: BubbleMeta, onFailure: () => boolean): void {
  (watchers ??= new WeakMap()).set(meta, onFailure);
}

/** Whether the author's size format has thrown for this meta on a counted read (AX160). */
export function sizeFormatFailed(meta: BubbleMeta): boolean { return !!failures?.has(meta); }

/** NaN (no size given) reads "No data"; any other number, drawable or not, is written as given. */
export function sizeText(meta: BubbleMeta, locale: string, value: number, messages: Pick<Messages, 'noData'>): string {
  if (Number.isNaN(value)) return messages.noData;
  let byLocale = (readouts ??= new WeakMap()).get(meta);
  if (!byLocale) readouts.set(meta, byLocale = new Map());
  let readout = byLocale.get(locale);
  if (!readout) {
    const format = meta.format, made: Readout = { read: String, broken: false };
    // The readout reports a throw only once (format/number.ts); the wrapper tells each failing read apart.
    made.read = createNumberReadout({
      locale, unit: meta.unit,
      format: typeof format === 'function' ? v => { try { return format(v); } catch (error) { threw = true; throw error; } } : format,
      onError: () => { made.broken = typeof format !== 'function'; },
    });
    byLocale.set(locale, readout = made);
  }
  const outer = threw;
  threw = false;
  const text = readout.read(value);
  const fell = threw || readout.broken;
  threw = outer;
  if (fell) failed(meta);
  return text;
}

/** A failure of this meta found earlier, offered to its watcher again (it decides ownership as for a fresh read). */
export { failed as sizeMissed };

function failed(meta: BubbleMeta): void {
  if (watchers?.get(meta)?.() !== false) (failures ??= new WeakSet()).add(meta);
}
