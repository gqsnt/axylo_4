/** Sizes as readers see them: per locale and meta (spec F6, with the size field's unit and format). */
import type { Messages } from '../../public';
import { createNumberReadout } from '../../format/number';
import type { BubbleMeta } from './options';

let readouts: WeakMap<BubbleMeta, Map<string, (v: number) => string>> | undefined;
let failures: WeakSet<BubbleMeta> | undefined;
let watchers: WeakMap<BubbleMeta, () => void> | undefined;

/**
 * Calls `onFirst` the first time the size format throws for `meta` (once per meta, however many rows fail): rows
 * are formatted lazily (table, tooltip, export), often outside any frame, so the chart must be told to run a
 * frame that reports AX160. A later watcher for the same meta replaces the earlier one.
 */
export function watchSizeFormat(meta: BubbleMeta, onFirst: () => void): void {
  (watchers ??= new WeakMap()).set(meta, onFirst);
}

/** Whether the author's size format has thrown for this meta (the default text was shown instead: AX160). */
export function sizeFormatFailed(meta: BubbleMeta): boolean { return !!failures?.has(meta); }

/** NaN (no size given) reads "No data"; any other number, drawable or not, is written as given. */
export function sizeText(meta: BubbleMeta, locale: string, value: number, messages: Pick<Messages, 'noData'>): string {
  if (Number.isNaN(value)) return messages.noData;
  let byLocale = (readouts ??= new WeakMap()).get(meta);
  if (!byLocale) readouts.set(meta, byLocale = new Map());
  let read = byLocale.get(locale);
  if (!read) byLocale.set(locale, read = createNumberReadout({ locale, unit: meta.unit, format: meta.format, onError: () => failed(meta) }));
  return read(value);
}

function failed(meta: BubbleMeta): void {
  const set = failures ??= new WeakSet();
  if (set.has(meta)) return;
  set.add(meta);
  watchers?.get(meta)?.();
}
