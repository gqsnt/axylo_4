// Loaded first by lifecycle.browser.test.ts, before the library: records, from the moment the test sets
// `window.__tracking`, every event listener, observer and animation frame the page registers, and which are
// still live, so the test can see what a destroyed chart leaves behind (spec DX8). Listeners registered with
// `once` are not tracked: they remove themselves, and the page cannot tell when.
(() => {
  const listeners = new Map();
  const ids = new WeakMap();
  let next = 0;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const keyOf = (type, options) => `${type}|${typeof options === 'boolean' ? options : !!options?.capture}`;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (window.__tracking && listener && !(typeof options === 'object' && options?.once)) {
      let byKey = ids.get(this);
      if (!byKey) ids.set(this, byKey = new Map());
      const key = keyOf(type, options);
      let byListener = byKey.get(key);
      if (!byListener) byKey.set(key, byListener = new Map());
      if (!byListener.has(listener)) {
        const id = ++next;
        byListener.set(listener, id);
        listeners.set(id, { target: this, type });
        const signal = typeof options === 'object' ? options?.signal : undefined;
        if (signal) add.call(signal, 'abort', () => { listeners.delete(id); byListener.delete(listener); });
      }
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const byListener = ids.get(this)?.get(keyOf(type, options));
    const id = byListener?.get(listener);
    if (id !== undefined) { listeners.delete(id); byListener.delete(listener); }
    return remove.call(this, type, listener, options);
  };
  // MediaQueryList's older listener API.
  const mqlAdd = MediaQueryList.prototype.addListener, mqlRemove = MediaQueryList.prototype.removeListener;
  MediaQueryList.prototype.addListener = function (l) { return this.addEventListener('change', l); };
  MediaQueryList.prototype.removeListener = function (l) { return this.removeEventListener('change', l); };
  void mqlAdd; void mqlRemove;

  const observers = new Set();
  for (const name of ['ResizeObserver', 'MutationObserver', 'IntersectionObserver']) {
    const Base = window[name];
    if (!Base) continue;
    window[name] = class extends Base {
      constructor(...args) { super(...args); this.__targets = new Set(); this.__name = name; }
      observe(target, ...rest) { if (window.__tracking) { this.__targets.add(target); observers.add(this); } return super.observe(target, ...rest); }
      unobserve(target) { this.__targets.delete(target); if (this.__targets.size === 0) observers.delete(this); return super.unobserve(target); }
      disconnect() { this.__targets.clear(); observers.delete(this); return super.disconnect(); }
    };
  }

  const frames = new Set();
  let requested = 0;
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    if (!window.__tracking) return raf(callback);
    requested++;
    const id = raf(t => { frames.delete(id); callback(t); });
    frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = id => { frames.delete(id); caf(id); };

  const describe = t => t === window ? 'window' : t === document ? 'document' : t instanceof MediaQueryList ? `matchMedia(${t.media})` : t instanceof Node ? (t.nodeName.toLowerCase() + (t.className ? `.${String(t.className).split(' ')[0]}` : '')) : String(t);
  /** What is still live: listeners on the window, the document, media queries or connected nodes; observers; pending frames. */
  window.__live = () => ({
    listeners: [...listeners.values()].filter(({ target }) => target === window || target === document || target instanceof MediaQueryList || (target instanceof Node && target.isConnected))
      .map(({ target, type }) => `${describe(target)} ${type}`),
    observers: [...observers].map(o => `${o.__name}(${o.__targets.size})`),
    frames: frames.size,
    requested,
  });
})();
