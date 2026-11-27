/**
 * N6 `createDashboard` teardown with real charts, in Node on the minimal DOM of n3-dom.ts (the browser evidence
 * is tests/dist/n6-sync-dashboard.browser.test.ts, whose 0/0/0 check this mirrors).
 *
 * The packed subpaths are separate bundles, each with its own copy of the core and so its own page-level hubs
 * (environment and theme media listeners, theme and language MutationObservers, the shared ResizeObservers).
 * Here `axylo`, `axylo/cartesian`, `axylo/finance` and `axylo/sync` are loaded as separate module instances to
 * match. The flow is the browser test's: hover with peers following, a brush, reset and zoom, add and remove,
 * then a panel and the whole grid disconnected by the page before teardown. Expected: nothing the charts
 * registered on the window, the document, media queries or `document.fonts` stays, no observer observes
 * anything, and the page has the nodes it had before the dashboard (spec DX8).
 */
import { describe, expect, it, vi } from 'vitest';
import { TestDocument, TestEvent, type TestElement } from './n3-dom';

interface Observed { readonly observed: TestElement[]; readonly disconnected: boolean; readonly cb: (entries: unknown[], observer: unknown) => void }
interface Listened { readonly _listeners: { readonly type: string }[] }

/** Media query lists and MutationObservers that remember what is registered on them (n3-dom's are inert). */
function instrument(doc: TestDocument) {
  const win = doc.defaultView as unknown as Record<string, unknown> & Listened & { observers: Observed[] };
  const Target = Object.getPrototypeOf(Object.getPrototypeOf(doc)).constructor as new () => Listened;
  const lists: (Listened & { media: string })[] = [];
  win.matchMedia = (media: string) => {
    const list = Object.assign(new Target(), { media, matches: false });
    lists.push(list);
    return list;
  };
  const mutations: { targets: Set<unknown> }[] = [];
  win.MutationObserver = class {
    readonly targets = new Set<unknown>();
    constructor() { mutations.push(this); }
    observe(target: unknown) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
    takeRecords() { return []; }
  };
  const all = (el: TestElement): TestElement[] => [el, ...el.children.flatMap(all)];
  const live = () => ({
    window: win._listeners.map(l => l.type),
    document: (doc as unknown as Listened)._listeners.map(l => l.type),
    fonts: (doc.fonts as unknown as Listened)._listeners.length,
    media: lists.reduce((n, l) => n + l._listeners.length, 0),
    mutationTargets: mutations.reduce((n, m) => n + m.targets.size, 0),
    resizeTargets: win.observers.filter(o => !o.disconnected).reduce((n, o) => n + o.observed.length, 0),
    // Descendants of <body>, as the browser test counts them (`body.getElementsByTagName("*")`).
    nodes: all(doc.body).length - 1,
  });
  /** One ResizeObserver delivery for every observed target: its border box, zero once out of the document. */
  const deliver = () => {
    for (const o of win.observers.filter(o => !o.disconnected && o.observed.length)) {
      o.cb(o.observed.map(t => {
        const on = t.isConnected;
        return { target: t, borderBoxSize: [{ inlineSize: on ? t.rect.width : 0, blockSize: on ? t.rect.height : 0 }], contentRect: { width: on ? t.rect.width : 0, height: on ? t.rect.height : 0 } };
      }), o);
    }
  };
  return { live, deliver };
}

const DAYS = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

describe('N6 createDashboard teardown with real charts from separate entry bundles', () => {
  it('leaves no listener, observer target or owned node after a panel and the grid were disconnected first', async () => {
    const doc = new TestDocument();
    const { live, deliver } = instrument(doc);
    const win = doc.defaultView;
    vi.resetModules();
    const { line } = await import('../../src/index');
    vi.resetModules();
    const { cartesian } = await import('../../src/cartesian');
    vi.resetModules();
    const { candlestick } = await import('../../src/finance');
    vi.resetModules();
    const { createDashboard } = await import('../../src/sync');
    vi.resetModules();

    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const baseline = live();
    expect(baseline).toEqual({ window: [], document: [], fonts: 0, media: 0, mutationTargets: 0, resizeTargets: 0, nodes: 1 });

    const reqRows = DAYS.map((d, i) => ({ d, requests: 100 + 7 * i }));
    const latRows = DAYS.filter((_, i) => i % 2 === 0).map(d => ({ d, latency: 5000 + 13 * DAYS.indexOf(d) }));
    const cartRows = DAYS.map((d, i) => ({ d, orders: 40 + i, ms: 300 + 3 * i }));
    const finRows = DAYS.map((d, i) => ({ d, o: 200 + i, h: 230 + i, l: 180 + i, c: 210 + i }));
    const made: Record<string, { zoom(domain: unknown): void }> = {};
    const panel = (id: string, make: (el: HTMLElement) => unknown) => ({ id, create: (el: HTMLElement) => (made[id] = make(el) as never) as never });
    const panels = {
      requests: panel('requests', el => line(el, { title: 'Requests', data: reqRows, x: { field: 'd', type: 'date' }, y: { field: 'requests', unit: 'req' }, zoom: true })),
      cart: panel('cart', el => cartesian(el, {
        title: 'Orders and time', data: cartRows, x: { field: 'd', type: 'date' }, zoom: true,
        axes: { orders: { position: 'left', label: 'Orders' }, ms: { position: 'right', label: 'Time', unit: 'ms' } },
        layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }, { type: 'line', y: 'ms', yAxis: 'ms' }],
      } as never)),
      fin: panel('fin', el => candlestick(el, { title: 'Price', data: finRows, x: { field: 'd', type: 'date' }, open: 'o', high: 'h', low: 'l', close: 'c', zoom: true } as never)),
      latency: panel('latency', el => line(el, { title: 'Latency', data: latRows, x: { field: 'd', type: 'date' }, y: { field: 'latency', unit: 'ms' }, zoom: true })),
    };
    const dash = createDashboard(host as unknown as HTMLElement, [panels.requests, panels.cart, panels.fin]);
    const grid = dash.element as unknown as TestElement;
    const element = (id: string) => grid.children.find(p => p.dataset.panel === id)!;
    win.flushFrames(); deliver(); win.flushFrames();

    // While mounted, every bundle holds its page-level hubs: the zero at the end means they were let go.
    const mounted = live();
    expect(mounted.fonts, 'one environment hub per bundle').toBe(3);
    expect(mounted.media, 'environment and theme media listeners per bundle').toBeGreaterThanOrEqual(3 * 5);
    expect(mounted.mutationTargets, 'theme and language observers per bundle').toBeGreaterThanOrEqual(3 * 2);
    expect(mounted.resizeTargets).toBeGreaterThan(0);

    // Pointer on the requests panel: its own hover starts its document listeners, and the peers follow.
    const plot = element('requests').querySelector('.axylo-plot')!;
    const pointer = (type: string, x: number) => plot.dispatchEvent(new TestEvent(type, { pointerType: 'mouse', pointerId: 1, clientX: x, clientY: 150, bubbles: true, button: 0, buttons: 1 }));
    pointer('pointermove', 120); win.flushFrames();
    expect(live().window.length, 'the hovered chart listens on the window').toBeGreaterThan(0);
    for (const id of ['cart', 'fin']) {
      expect(element(id).querySelector('.axylo-figure')!.hasAttribute('data-axylo-sync'), `${id} shows the peer cursor`).toBe(true);
    }
    pointer('pointerdown', 150); pointer('pointermove', 220); pointer('pointermove', 320); pointer('pointerup', 340); win.flushFrames();
    plot.dispatchEvent(new TestEvent('pointerleave', { pointerType: 'mouse', pointerId: 1 })); win.flushFrames();
    dash.reset(); win.flushFrames();
    dash.zoom([DAYS[2]!, DAYS[7]!]); win.flushFrames();

    dash.add(panels.latency as never);
    expect(dash.remove('cart')).toBe(true);
    win.flushFrames(); deliver(); win.flushFrames();

    // The page takes a panel out, then removes it through the dashboard; then it takes the whole grid out.
    const fin = element('fin');
    fin.remove(); deliver(); win.flushFrames();
    expect(dash.remove('fin')).toBe(true);
    grid.remove(); deliver(); win.flushFrames();
    dash.destroy(); win.flushFrames();

    expect(live()).toEqual(baseline);
    // A call on a destroyed chart registers nothing again.
    made.requests!.zoom([DAYS[1]!, DAYS[3]!]);
    made.latency!.zoom([DAYS[1]!, DAYS[3]!]);
    win.flushFrames();
    expect(live()).toEqual(baseline);
    expect(fin.childNodes.length).toBe(0);
    expect(grid.childNodes.length).toBe(0);
  });
});
