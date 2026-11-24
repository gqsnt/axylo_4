import { expect, it, vi } from 'vitest';
import { pageLanguage, resolveLocale, watchLanguage } from '../../src/core/environment';

it('inherits the nearest composed language and watches each tree containing an ancestor', () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  let deliver!: (records: { target: unknown }[]) => void;
  const doc = {
    documentElement: { lang: 'en' },
    defaultView: { navigator: { language: 'en-US' }, MutationObserver: class {
      constructor(callback: typeof deliver) { deliver = callback; }
      observe = observe;
      disconnect = disconnect;
    } },
  };
  const element = (parentNode: object | null, parentElement: object | null, lang?: string) => ({
    ownerDocument: doc, parentNode, parentElement, getAttribute: () => lang ?? null,
  });
  const host = element(null, null, 'fr');
  const outer = { host };
  const section = element(outer, null, 'de');
  const inner = { host: element(section, section) };
  const slot = element(inner, null);
  const target = { ...element(host, host), assignedSlot: slot } as unknown as Element;
  expect(pageLanguage(target)).toBe('de');
  expect(resolveLocale(undefined, doc as unknown as Document, 'de')).toBe('de');
  expect(resolveLocale('it', doc as unknown as Document, 'de')).toBe('it');
  const change = vi.fn();
  const stop = watchLanguage(target, change);
  expect(observe.mock.calls.map(([tree]) => tree)).toEqual([doc.documentElement, inner, outer]);
  deliver([{ target: {} }]);
  expect(change).not.toHaveBeenCalled();
  deliver([{ target: section }, { target: slot }]);
  expect(change).toHaveBeenCalledTimes(1);
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
});
