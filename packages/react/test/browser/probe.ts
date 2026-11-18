/**
 * Leak probes, installed before React or the core run: ResizeObserver and MutationObserver instances still
 * observing, ResizeObserver callbacks delivered, event listeners still registered on live targets, and
 * animation frames still pending.
 */
const originalFrame = window.requestAnimationFrame.bind(window);
const originalCancel = window.cancelAnimationFrame.bind(window);

/** Waits n frames without counting as a pending frame. */
export const nextFrames = (n: number): Promise<void> =>
  new Promise(resolve => { const step = (k: number): void => { if (k === 0) resolve(); else originalFrame(() => step(k - 1)); }; step(n); });

const pendingFrames = new Set<number>();
window.requestAnimationFrame = callback => {
  const id = originalFrame(time => { pendingFrames.delete(id); callback(time); });
  pendingFrames.add(id);
  return id;
};
window.cancelAnimationFrame = id => { pendingFrames.delete(id); originalCancel(id); };

let resizeCallbacks = 0;
const observing = new Set<object>();
const Resize = window.ResizeObserver;
window.ResizeObserver = class extends Resize {
  constructor(callback: ResizeObserverCallback) {
    super((entries, observer) => { resizeCallbacks++; callback(entries, observer); });
  }
  override observe(target: Element, options?: ResizeObserverOptions): void { observing.add(this); super.observe(target, options); }
  override disconnect(): void { observing.delete(this); super.disconnect(); }
};
const Mutation = window.MutationObserver;
window.MutationObserver = class extends Mutation {
  override observe(target: Node, options?: MutationObserverInit): void { observing.add(this); super.observe(target, options); }
  override disconnect(): void { observing.delete(this); super.disconnect(); }
};

interface Entry { id: number; target: EventTarget; type: string; listener: unknown; capture: boolean }
const listeners: Entry[] = [];
let ids = 0;
const add = EventTarget.prototype.addEventListener;
const remove = EventTarget.prototype.removeEventListener;
const captureOf = (options: unknown): boolean => typeof options === 'boolean' ? options : !!(options as { capture?: boolean } | undefined)?.capture;
const drop = (target: EventTarget, type: string, listener: unknown, capture: boolean): void => {
  const i = listeners.findIndex(e => e.target === target && e.type === type && e.listener === listener && e.capture === capture);
  if (i >= 0) listeners.splice(i, 1);
};
EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
  const capture = captureOf(options);
  if (listener && !listeners.some(e => e.target === this && e.type === type && e.listener === listener && e.capture === capture)) {
    listeners.push({ id: ++ids, target: this, type, listener, capture });
    const signal = typeof options === 'object' ? options.signal : undefined;
    if (signal) add.call(signal, 'abort', () => drop(this, type, listener, capture));
    // A `once` listener is gone after its first event: a companion registered after it sees the same event.
    if (typeof options === 'object' && options.once) add.call(this, type, () => drop(this, type, listener, capture), { once: true, capture });
  }
  add.call(this, type, listener, options);
};
EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
  drop(this, type, listener, captureOf(options));
  remove.call(this, type, listener, options);
};

export const probe = {
  get resizeCallbacks() { return resizeCallbacks; },
  get observers() { return observing.size; },
  get pendingFrames() { return pendingFrames.size; },
  mark: () => ids,
  /** Listeners added after `mark` and still registered on something that can still fire them. */
  leakedSince: (mark: number): string[] => listeners
    .filter(e => e.id > mark && (!(e.target instanceof Node) || e.target.isConnected))
    .map(e => `${(e.target as { constructor: { name: string } }).constructor.name}:${e.type}`),
  detachedTargets: (mark: number): Element[] => listeners
    .filter(e => e.id > mark && e.target instanceof Element && !e.target.isConnected).map(e => e.target as Element),
  /** Listeners added after `mark` and still registered on nodes that have left the document. */
  detachedSince: (mark: number): string[] => listeners
    .filter(e => e.id > mark && e.target instanceof Node && !e.target.isConnected)
    .map(e => `${(e.target as { constructor: { name: string } }).constructor.name}:${e.type}`),
};
