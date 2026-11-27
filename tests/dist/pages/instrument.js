// Loaded first by lifecycle.browser.test.ts and n6-sync-dashboard.browser.test.ts, before the library: records, from the moment the test sets
// `window.__tracking`, every event listener, observer and animation frame the page registers, and which are
// still live, so the test can see what a destroyed chart leaves behind (spec DX8). Listeners registered with
// `once` are not tracked: they remove themselves, and the page cannot tell when.
(() => {
  const listeners = new Map();
  const ids = new WeakMap();
  let next = 0;
  // N6: what a registration was, for a failure to name it: the phase the test was in (`__phase`) and where in
  // the page's code it was made. The stack is read only while tracking, and only the frames outside this file.
  let phase = '';
  const origin = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 16;
    const stack = String(new Error().stack || '');
    Error.stackTraceLimit = limit;
    return stack.split('\n').slice(1).filter(l => !l.includes('/pages/instrument.js')).slice(0, 4)
      .map(l => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/, '')).join(' < ');
  };
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
        listeners.set(id, { target: this, type, capture: key.endsWith('|true'), phase, at: origin(), id });
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
      constructor(...args) { super(...args); this.__targets = new Set(); this.__name = name; this.__made = window.__tracking ? { phase, at: origin() } : null; this.__seen = new Map(); }
      observe(target, ...rest) {
        if (window.__tracking) { this.__targets.add(target); observers.add(this); if (!this.__seen.has(target)) this.__seen.set(target, { phase, at: origin() }); }
        return super.observe(target, ...rest);
      }
      unobserve(target) { this.__targets.delete(target); this.__seen.delete(target); if (this.__targets.size === 0) observers.delete(this); return super.unobserve(target); }
      disconnect() { this.__targets.clear(); this.__seen.clear(); observers.delete(this); return super.disconnect(); }
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
  /** `describe` with where a node is: its id, its dashboard panel or chart host, and whether it is in the document. */
  const where = t => {
    if (t === document.fonts) return 'document.fonts';
    if (!(t instanceof Node) || t === document) return describe(t);
    const el = t.nodeType === 1 ? t : t.parentElement;
    const owner = el?.closest?.('[data-panel], [id]');
    const of = owner && owner !== t ? ` in ${owner.dataset?.panel ? `[data-panel=${owner.dataset.panel}]` : `#${owner.id}`}` : '';
    return `${describe(t)}${t.id ? `#${t.id}` : ''}${of}${t.isConnected ? '' : ' (disconnected)'}`;
  };
  /** What is still live: listeners on the window, the document, media queries or connected nodes; observers; pending frames. */
  window.__live = () => ({
    listeners: [...listeners.values()].filter(({ target }) => target === window || target === document || target instanceof MediaQueryList || (target instanceof Node && target.isConnected))
      .map(({ target, type }) => `${describe(target)} ${type}`),
    observers: [...observers].map(o => `${o.__name}(${o.__targets.size})`),
    frames: frames.size,
    requested,
  });
  /**
   * N6: everything tracked, disconnected targets included (a panel the page removed before the dashboard was
   * destroyed still holds whatever was registered on it). `__live` above is unchanged for its consumers. The
   * counts are of every tracked registration; `detail` names each one (target, type, the phase it was made in
   * and the first frames of the page's stack then) so a failing count says what it counted.
   */
  window.__liveAll = () => {
    const all = [...listeners.values()];
    const live = [...observers];
    return {
      listeners: all.length,
      disconnected: all.filter(({ target }) => target instanceof Node && !target.isConnected).map(({ target, type }) => `${describe(target)} ${type}`),
      observers: live.length,
      observerTargets: live.reduce((n, o) => n + o.__targets.size, 0),
      disconnectedTargets: live.reduce((n, o) => n + [...o.__targets].filter(t => t instanceof Node && !t.isConnected).length, 0),
      frames: frames.size,
      detail: {
        listeners: all.map(l => ({ id: l.id, target: where(l.target), type: l.type, capture: l.capture, phase: l.phase, at: l.at })),
        observers: live.map(o => ({
          name: o.__name, made: o.__made,
          targets: [...o.__targets].map(t => ({ target: where(t), ...(o.__seen.get(t) || { phase: '?', at: '' }) })),
        })),
      },
    };
  };
  /**
   * Names the phase the test is in from now on (each registration records it) and keeps a summary of what is
   * live at that moment: counts, and the live registrations grouped by target and type.
   */
  const snapshots = [];
  window.__phase = label => {
    const all = window.__liveAll();
    const groups = {};
    for (const l of all.detail.listeners) groups[`${l.target} ${l.type}${l.capture ? ' (capture)' : ''}`] = (groups[`${l.target} ${l.type}${l.capture ? ' (capture)' : ''}`] || 0) + 1;
    snapshots.push({
      phase: label, listeners: all.listeners, observers: all.observers, observerTargets: all.observerTargets,
      disconnected: all.disconnected.length, disconnectedTargets: all.disconnectedTargets, frames: all.frames,
      groups, observing: all.detail.observers.map(o => `${o.name}: ${o.targets.map(t => t.target).join(', ')}`),
    });
    phase = label;
  };
  window.__snapshots = () => snapshots.slice();
})();
