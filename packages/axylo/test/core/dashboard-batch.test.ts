/**
 * Unit tests for Wave 2A dashboard layout batching fixes (Fixes 1–5) and 1-frame microtask zoom.
 */
import { describe, expect, it, vi } from 'vitest';
import { cancelScheduledFrame, scheduleFrame } from '../../src/core/chart';
import { createController, type Controller, type FrameRun, type Host, type Size } from '../../src/core/controller';
import type { AlignedView, TextStyle } from '../../src/core/contracts';
import type { Committed } from '../../src/dom/interaction';
import { subscribeTreeMutations, watchLanguage } from '../../src/core/environment';
import { applyTheme, createThemeBatch, finalizeTheme, prepareTheme, probeTheme, resolveTheme } from '../../src/theme/resolve';
import { watchTheme } from '../../src/theme/watch';
import { DARK, LIGHT } from '../../src/theme/palette';
import { TOKEN_BINDINGS } from '../../src/theme';

const sampleRows = () => Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 10 + 5 }));

// ── Fix 1: Unique frame handles across successive rAF batches ────────────────────────────────────

describe('Fix 1: globally monotonic frame handles across rAF batches', () => {
  it('never reuses handles across batches so batch 1 beginFrame cannot cancel batch 2', () => {
    const rafQueue = new Map<number, (time: number) => void>();
    let rafSeq = 0;
    const win = {
      requestAnimationFrame(cb: (time: number) => void) {
        const id = ++rafSeq;
        rafQueue.set(id, cb);
        return id;
      },
      cancelAnimationFrame(id: number) {
        rafQueue.delete(id);
      },
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    const doc = {} as Document;

    const flushRaf = (time: number) => {
      const entries = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of entries) cb(time);
    };

    let batch2Handle = 0;
    let batch2Ran = 0;
    const noopRun = (onPhase1?: () => void): FrameRun => ({
      phase1: () => { onPhase1?.(); },
      phase2() {},
      phase3Theme() {},
      phase3Measure() {},
      phase3Probe() {},
      phase3LayoutCheck: () => false,
      phase3StripMount() {},
      phase3StripRead() {},
      phase3StripRemove() {},
      phase3ReadoutDecide() {},
      phase4StripWrite() {},
      phase4StripMeasure() {},
      phase4Init() {},
      phase4PassWrite: () => false,
      phase4PassMeasure() {},
      phase5() {},
      after() {},
    });

    let h1 = 0;
    let h2 = 0;

    // Chart A schedules a new frame into Batch 2 while Batch 1's Phase 1 is executing.
    const ctrlA = {
      beginFrame: () => {
        cancelScheduledFrame(win, h1);
        return noopRun(() => {
          batch2Handle = scheduleFrame(win, doc, () => null, () => { batch2Ran++; });
        });
      },
    } as unknown as Controller;

    // Chart B calls cancelScheduledFrame(win, h2) when its beginFrame runs right after Chart A's phase1.
    const ctrlB = {
      beginFrame: () => {
        cancelScheduledFrame(win, h2);
        return noopRun();
      },
    } as unknown as Controller;

    h1 = scheduleFrame(win, doc, () => ctrlA, () => {});
    h2 = scheduleFrame(win, doc, () => ctrlB, () => {});
    expect(h2).toBeGreaterThan(h1);

    // Run Batch 1: Chart A queues Batch 2; Chart B cancels its own old handle h2.
    flushRaf(16);
    expect(batch2Handle).toBeGreaterThan(h2);
    expect(rafQueue.size).toBe(1);

    // Run Batch 2: its callback must NOT have been cancelled by Chart B's cancelFrame(h2).
    flushRaf(32);
    expect(batch2Ran).toBe(1);
  });
});

// ── Fix 2: Per-root MutationObserver hubs without cross-root disconnects ─────────────────────────

describe('Fix 2: per-root ref-counted MutationObserver hubs', () => {
  interface MockObserver {
    readonly roots: Node[];
    disconnected: boolean;
    deliver(records: Partial<MutationRecord>[]): void;
  }

  function makeMockDoc() {
    const observers: MockObserver[] = [];
    const mediaListeners = new Map<string, Set<() => void>>();
    const win = {
      matchMedia(query: string) {
        let set = mediaListeners.get(query);
        if (!set) mediaListeners.set(query, set = new Set());
        return {
          matches: false,
          addEventListener(_: string, fn: () => void) { set!.add(fn); },
          removeEventListener(_: string, fn: () => void) { set!.delete(fn); },
        };
      },
      MutationObserver: class {
        readonly record: MockObserver;
        constructor(callback: (records: MutationRecord[]) => void) {
          this.record = {
            roots: [],
            disconnected: false,
            deliver: records => {
              if (!this.record.disconnected) callback(records as MutationRecord[]);
            },
          };
          observers.push(this.record);
        }
        observe(target: Node) {
          this.record.roots.push(target);
        }
        disconnect() {
          this.record.disconnected = true;
        }
      },
    };
    const documentElement = { ownerDocument: null as unknown, parentNode: null, parentElement: null, getAttribute: () => null };
    const doc = { documentElement, defaultView: win };
    documentElement.ownerDocument = doc;
    return { doc, win, documentElement, observers, mediaListeners };
  }

  it('removing the last shadow-root subscriber disconnects only the shadow root observer, never documentElement', () => {
    const { doc, documentElement, observers } = makeMockDoc();
    const lightEl = {
      ownerDocument: doc, parentNode: documentElement, parentElement: documentElement,
      assignedSlot: null, getAttribute: () => null,
    } as unknown as Element;
    const shadowHost = {
      ownerDocument: doc, parentNode: documentElement, parentElement: documentElement,
      assignedSlot: null, getAttribute: () => null,
    };
    const shadowRoot = { nodeType: 11, host: shadowHost };
    const shadowEl = {
      ownerDocument: doc, parentNode: shadowRoot, parentElement: null,
      assignedSlot: null, getAttribute: () => null,
    } as unknown as Element;

    const lightChanges = vi.fn();
    const shadowChanges = vi.fn();

    const stopLight = watchTheme(lightEl, lightChanges);
    expect(observers.length).toBe(1);
    const docObserver = observers[0]!;
    expect(docObserver.roots).toEqual([documentElement]);

    const stopShadow = watchTheme(shadowEl, shadowChanges);
    // Reuses documentElement's observer and creates a separate observer for shadowRoot.
    expect(observers.length).toBe(2);
    const shadowObserver = observers[1]!;
    expect(shadowObserver.roots).toEqual([shadowRoot]);
    expect(docObserver.disconnected).toBe(false);

    // Removing the last subscriber in shadowRoot disconnects ONLY shadowObserver.
    stopShadow();
    expect(shadowObserver.disconnected).toBe(true);
    expect(docObserver.disconnected).toBe(false);

    // Pending/subsequent mutations on documentElement still reach the surviving light-DOM chart.
    docObserver.deliver([{ target: documentElement as unknown as Node, attributeName: 'class' }]);
    expect(lightChanges).toHaveBeenCalledTimes(1);
    expect(shadowChanges).toHaveBeenCalledTimes(0);

    // Removing the last subscriber on documentElement disconnects docObserver cleanly.
    stopLight();
    expect(docObserver.disconnected).toBe(true);
  });

  it('removing a shadow-root watchLanguage subscriber never disconnects the shared documentElement observer', () => {
    const { doc, documentElement, observers } = makeMockDoc();
    const lightEl = {
      ownerDocument: doc, parentNode: documentElement, parentElement: documentElement,
      assignedSlot: null, getAttribute: () => null,
    } as unknown as Element;
    const shadowHost = {
      ownerDocument: doc, parentNode: documentElement, parentElement: documentElement,
      assignedSlot: null, getAttribute: () => null,
    };
    const shadowRoot = { nodeType: 11, host: shadowHost };
    const shadowEl = {
      ownerDocument: doc, parentNode: shadowRoot, parentElement: null,
      assignedSlot: null, getAttribute: () => null,
    } as unknown as Element;

    const lightChanges = vi.fn();
    const shadowChanges = vi.fn();
    const stopLight = watchLanguage(lightEl, lightChanges);
    const docObserver = observers[0]!;
    const stopShadow = watchLanguage(shadowEl, shadowChanges);

    stopShadow();
    expect(docObserver.disconnected).toBe(false);
    docObserver.deliver([{ target: documentElement as unknown as Node, attributeName: 'lang' }]);
    expect(lightChanges).toHaveBeenCalledTimes(1);
    expect(shadowChanges).toHaveBeenCalledTimes(0);

    stopLight();
    expect(docObserver.disconnected).toBe(true);
  });

  it('rolls back cleanly if observe() throws on a shadow root without disconnecting a surviving documentElement hub', () => {
    const { doc, documentElement, observers, win } = makeMockDoc();
    const lightEl = {
      ownerDocument: doc, parentNode: documentElement, parentElement: documentElement,
      assignedSlot: null, getAttribute: () => null,
    } as unknown as Element;
    const shadowHost = {
      ownerDocument: doc, parentNode: documentElement, parentElement: documentElement,
      assignedSlot: null, getAttribute: () => null,
    };
    const failingShadow = { nodeType: 11, host: shadowHost };
    const shadowEl = {
      ownerDocument: doc, parentNode: failingShadow, parentElement: null,
      assignedSlot: null, getAttribute: () => null,
    } as unknown as Element;

    const BaseMO = win.MutationObserver;
    win.MutationObserver = class extends BaseMO {
      override observe(target: Node) {
        if (target === (failingShadow as unknown as Node)) throw new Error('shadow observe failed');
        super.observe(target);
      }
    };

    const lightChanges = vi.fn();
    const stopLight = subscribeTreeMutations('theme', lightEl, { attributes: true, subtree: true }, { element: lightEl, onChange: lightChanges });
    const docObserver = observers[0]!;
    expect(() => subscribeTreeMutations('theme', shadowEl, { attributes: true, subtree: true }, { element: shadowEl, onChange: () => {} })).toThrow(/shadow observe failed/);

    // Surviving documentElement observer is untouched.
    expect(docObserver.disconnected).toBe(false);
    docObserver.deliver([{ target: documentElement as unknown as Node, attributeName: 'class' }]);
    expect(lightChanges).toHaveBeenCalledTimes(1);
    stopLight();
    expect(docObserver.disconnected).toBe(true);
  });
});

// ── Fix 3 & Fix 5: Theme --axylo-background dependency order & zero Phase 1 probes ──────────────

describe('Fix 3 & Fix 5: theme --axylo-background order and probe-free Phase 1', () => {
  interface MockThemeEnv {
    readonly doc: Document;
    readonly win: Window;
    readonly body: HTMLElement;
    readonly element: HTMLElement;
    readonly log: string[];
    appendCount: number;
    setBgRule(rule: (inlineProps: Map<string, string>) => string): void;
  }

  function createMockThemeEnv(opts: {
    bodyBg?: string;
    colorScheme?: string;
    canvasColor?: string;
    prefersDark?: boolean;
    bgRule?: (inlineProps: Map<string, string>) => string;
  } = {}): MockThemeEnv {
    const log: string[] = [];
    let appendCount = 0;
    let bgRule = opts.bgRule ?? (() => '');
    const bodyBg = opts.bodyBg ?? 'rgb(255, 255, 255)';
    const colorScheme = opts.colorScheme ?? 'normal';
    const canvasColor = opts.canvasColor ?? 'rgb(255, 255, 255)';
    const prefersDark = opts.prefersDark ?? false;

    const makeStyle = (props = new Map<string, string>(), onWrite?: (name: string, val: string) => void) => {
      const st: Record<string, unknown> = {
        display: '',
        forcedColorAdjust: '',
        color: '',
        getPropertyValue: (name: string) => props.get(name) ?? '',
        setProperty: (name: string, val: string) => {
          props.set(name, val);
          onWrite?.(name, val);
        },
        removeProperty: (name: string) => {
          props.delete(name);
          return '';
        },
      };
      return { style: st as unknown as CSSStyleDeclaration, props };
    };

    const makeProbeNode = () => {
      const { style } = makeStyle();
      const children: ReturnType<typeof makeProbeNode>[] = [];
      const node: Record<string, unknown> = {
        style,
        parentElement: null as unknown,
        children,
        appendChild(child: Record<string, unknown>) {
          child.parentElement = node;
          children.push(child as never);
          return child;
        },
        remove() {
          node.parentElement = null;
        },
        replaceChildren() {
          for (const c of children) (c as Record<string, unknown>).parentElement = null;
          children.length = 0;
        },
      };
      return node;
    };

    const elProps = new Map<string, string>();
    const elAttrs = new Map<string, string>();
    const { style: elStyle } = makeStyle(elProps, (name, val) => log.push(`write:${name}=${val}`));

    const resolveExpression = (expr: string, owner: unknown): string | null => {
      const trimmed = expr.trim();
      if (trimmed === 'Canvas') return canvasColor;
      if (trimmed === 'var(--axylo-background)') {
        const bg = bgRule(elProps).trim();
        if (!bg) return null;
        return resolveExpression(bg, owner);
      }
      if (trimmed === 'var(--axylo-backdrop)') {
        const v = elProps.get('--axylo-backdrop');
        return v ? v : null;
      }
      if (trimmed === 'var(--axylo-series-color-1)') {
        const v = elProps.get('--axylo-series-color-1');
        if (!v) return null;
        if (v.includes('rgb(') || v.includes('#')) {
          const match = /(rgb\([^)]+\)|#[0-9a-fA-F]{6})/.exec(v);
          return match ? match[1]! : null;
        }
        return elAttrs.get('data-axylo-scheme') === 'dark' ? 'rgb(86, 180, 233)' : 'rgb(0, 114, 178)';
      }
      if (trimmed.startsWith('var(--axylo-')) {
        return 'rgb(17, 34, 51)';
      }
      if (/^rgb\(/.test(trimmed) || /^rgba\(/.test(trimmed)) return trimmed;
      if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
        const n = parseInt(trimmed.slice(1), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      }
      return null;
    };

    const docElement = {
      ownerDocument: null as unknown,
      parentNode: null,
      parentElement: null,
      assignedSlot: null,
      isConnected: true,
      appendChild(child: Record<string, unknown>) {
        appendCount++;
        log.push('probe:documentElement');
        child.parentElement = docElement;
        return child;
      },
    };

    const body = {
      ownerDocument: null as unknown,
      parentNode: docElement,
      parentElement: docElement,
      assignedSlot: null,
      isConnected: true,
    };

    const element = {
      ownerDocument: null as unknown,
      parentNode: body,
      parentElement: body,
      assignedSlot: null,
      isConnected: true,
      style: elStyle,
      getAttribute: (name: string) => elAttrs.get(name) ?? null,
      setAttribute: (name: string, val: string) => {
        elAttrs.set(name, val);
        log.push(`attr:${name}=${val}`);
      },
      removeAttribute: (name: string) => {
        elAttrs.delete(name);
        log.push(`removeAttr:${name}`);
      },
      appendChild(child: Record<string, unknown>) {
        appendCount++;
        log.push('probe:element');
        child.parentElement = element;
        return child;
      },
    };

    const win = {
      matchMedia: (q: string) => ({ matches: q.includes('prefers-color-scheme: dark') ? prefersDark : false }),
      getComputedStyle(target: unknown) {
        if (target === element) {
          return {
            backgroundColor: 'rgba(0, 0, 0, 0)',
            backgroundImage: 'none',
            colorScheme,
            color: 'rgb(0, 0, 0)',
            getPropertyValue(name: string) {
              if (name === '--axylo-background') return bgRule(elProps);
              if (name.startsWith('--axylo-default-')) {
                const slot = name.slice('--axylo-default-'.length);
                const scheme = elAttrs.get('data-axylo-scheme');
                const pal = scheme === 'dark' ? DARK : LIGHT;
                const follows = !scheme && colorScheme !== 'normal';
                if (slot.startsWith('series-')) {
                  const idx = Number(slot.slice('series-'.length)) - 1;
                  return follows ? `light-dark(${LIGHT.series[idx]}, ${DARK.series[idx]})` : pal.series[idx] ?? '';
                }
                const lightVal = (LIGHT as unknown as Record<string, string>)[slot];
                const darkVal = (DARK as unknown as Record<string, string>)[slot];
                if (!lightVal) return '';
                return follows ? `light-dark(${lightVal}, ${darkVal})` : (pal as unknown as Record<string, string>)[slot] ?? '';
              }
              if (name.startsWith('--axylo-series-color-')) {
                const idx = Number(name.slice('--axylo-series-color-'.length)) - 1;
                const raw = elProps.get(name) ?? '';
                if (!raw.startsWith('var(--axylo-series-')) return raw;
                const scheme = elAttrs.get('data-axylo-scheme');
                const pal = scheme === 'dark' ? DARK : LIGHT;
                const follows = !scheme && colorScheme !== 'normal';
                return follows ? `light-dark(${LIGHT.series[idx]}, ${DARK.series[idx]})` : pal.series[idx] ?? '';
              }
              return '';
            },
          };
        }
        if (target === body) {
          return { backgroundColor: bodyBg, backgroundImage: 'none', colorScheme, color: 'rgb(0, 0, 0)' };
        }
        if (target === docElement) {
          return { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', colorScheme, color: 'rgb(0, 0, 0)' };
        }
        // Probe span: resolve its assigned color expression or inherit parent's sentinel color if invalid.
        const span = target as { style: { color: string }; parentElement?: { style?: { color?: string } } };
        const resolved = resolveExpression(span.style.color ?? '', target);
        return { color: resolved ?? span.parentElement?.style?.color ?? 'rgb(0, 0, 0)' };
      },
    } as unknown as Window;

    const doc = {
      defaultView: win,
      documentElement: docElement,
      createElement: () => makeProbeNode(),
    } as unknown as Document;

    docElement.ownerDocument = doc;
    body.ownerDocument = doc;
    element.ownerDocument = doc;

    return {
      doc,
      win,
      body: body as unknown as HTMLElement,
      element: element as unknown as HTMLElement,
      log,
      get appendCount() { return appendCount; },
      set appendCount(v: number) { appendCount = v; },
      setBgRule(fn) { bgRule = fn; },
    };
  }

  it('Fix 5: prepareTheme never calls probeColors during Phase 1 (authored colors, cold Canvas backdrop, cold light-dark)', () => {
    // 1. Authored colors (valid + invalid)
    const env1 = createMockThemeEnv({ bodyBg: 'rgb(255, 255, 255)' });
    const batch1 = createThemeBatch(env1.win);
    const p1 = prepareTheme(env1.element, ['a', 'b'], { a: '#112233', b: 'not-a-color' }, batch1);
    expect(env1.appendCount).toBe(0);
    expect(env1.log).toEqual([]);

    applyTheme(p1);
    const res1 = finalizeTheme(p1, true) ?? probeTheme(p1);
    expect(res1.invalidColors).toEqual(['b']);
    expect(env1.element.style.getPropertyValue('--axylo-series-color-1')).toContain('#112233');
    expect(env1.element.style.getPropertyValue('--axylo-series-color-2')).toContain('--axylo-series-2');

    // 2. Transparent page with cold Canvas cache
    const env2 = createMockThemeEnv({ bodyBg: 'rgba(0, 0, 0, 0)', canvasColor: 'rgb(240, 240, 240)' });
    const batch2 = createThemeBatch(env2.win);
    const p2 = prepareTheme(env2.element, ['a'], null, batch2);
    expect(env2.appendCount).toBe(0);
    expect(env2.log).toEqual([]);

    applyTheme(p2);
    const res2 = finalizeTheme(p2, true) ?? probeTheme(p2);
    expect(res2.theme.paints.tokens.background).toBe('rgb(240, 240, 240)');
    expect(res2.theme.scheme).toBe('light');

    // 3. color-scheme: light dark with cold Canvas cache
    const env3 = createMockThemeEnv({ bodyBg: 'rgb(255, 255, 255)', colorScheme: 'light dark', canvasColor: 'rgb(20, 20, 20)', prefersDark: true });
    const batch3 = createThemeBatch(env3.win);
    const p3 = prepareTheme(env3.element, ['a'], null, batch3);
    expect(env3.appendCount).toBe(0);
    expect(env3.log).toEqual([]);

    applyTheme(p3);
    const res3 = finalizeTheme(p3, true) ?? probeTheme(p3);
    expect(res3.theme.scheme).toBe('dark');
  });

  it('Fix 3: writes --axylo-series-color-* and --axylo-backdrop before probing --axylo-background (with fallback, standalone and batched)', () => {
    for (const mode of ['standalone', 'batched'] as const) {
      const env = createMockThemeEnv({
        bodyBg: 'rgb(15, 20, 30)',
        // Non-empty even before applyTheme (e.g. var(--axylo-backdrop, white)) and depends on --axylo-backdrop once written.
        bgRule: props => props.get('--axylo-backdrop') ?? 'rgb(255, 255, 255)',
      });
      let res;
      if (mode === 'standalone') {
        res = resolveTheme(env.element, ['a']);
      } else {
        const p = prepareTheme(env.element, ['a'], null, createThemeBatch(env.win));
        expect(env.appendCount).toBe(0);
        applyTheme(p);
        res = finalizeTheme(p, true) ?? probeTheme(p);
      }
      // Must have written series color and backdrop BEFORE probing --axylo-background.
      const seriesWriteIdx = env.log.findIndex(e => e.startsWith('write:--axylo-series-color-1='));
      const backdropWriteIdx = env.log.findIndex(e => e.startsWith('write:--axylo-backdrop='));
      const firstProbeIdx = env.log.findIndex(e => e === 'probe:element');
      expect(seriesWriteIdx).toBeGreaterThanOrEqual(0);
      expect(backdropWriteIdx).toBeGreaterThan(seriesWriteIdx);
      expect(firstProbeIdx).toBeGreaterThan(backdropWriteIdx);
      expect(res.theme.paints.tokens.background).toBe('rgb(15, 20, 30)');
      expect(res.theme.scheme).toBe('dark');
    }
  });

  it('Fix 3: handles --axylo-background referencing --axylo-series-color-1 without fallback (empty before write, non-empty after)', () => {
    for (const mode of ['standalone', 'batched'] as const) {
      const env = createMockThemeEnv({
        bodyBg: 'rgb(255, 255, 255)',
        // Empty until --axylo-series-color-1 is written (simulating CSS custom property substitution).
        bgRule: props => props.has('--axylo-series-color-1') ? 'var(--axylo-series-color-1)' : '',
      });
      let res;
      if (mode === 'standalone') {
        res = resolveTheme(env.element, ['a'], { a: '#101010' });
      } else {
        const p = prepareTheme(env.element, ['a'], { a: '#101010' }, createThemeBatch(env.win));
        expect(env.appendCount).toBe(0);
        applyTheme(p);
        const f = finalizeTheme(p, true);
        expect(f).toBeNull();
        res = probeTheme(p);
      }
      expect(res.theme.paints.tokens.background).toBe('rgb(16, 16, 16)');
      expect(res.theme.scheme).toBe('dark');
      expect(env.element.getAttribute('data-axylo-scheme')).toBe('dark');
    }
  });
});

// ── Fix 4: Exact batched stripHeight probing & fontEpoch invalidation ───────────────────────────

describe('Fix 4: batched exact stripHeight probing and fontEpoch invalidation', () => {
  function makeSmallHost(stripValue: () => number, log: string[], label: string, failRead = false): {
    host: Host;
    stripReadCount: () => number;
    mountedProbes: () => number;
    readoutModes: () => (string | undefined)[];
  } {
    let stripReads = 0;
    let mounted = 0;
    const readoutModes: (string | undefined)[] = [];
    const style: TextStyle = { font: '400 12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 15 };
    let readout = false;
    const host: Host = {
      id: `chart-${label}`,
      console: null,
      page: {},
      timeZone: 'UTC',
      renderer: { kind: 'svg', draw() {} },
      text: { render() {} },
      figure: { update: () => false, announce() {} },
      interaction: {
        prepare(state) {
          readout = state.readout === true;
          readoutModes.push(state.readoutMode);
          return false;
        },
        commit() {},
        clear() {},
      },
      measurer: { width: text => text.length * 6 },
      requestFrame: () => 1,
      cancelFrame() {},
      locale: () => 'en-US',
      pageLang: () => 'en',
      labelText: () => null,
      textStyle: () => style,
      measure(): Size {
        // Column 220 × 195 px -> plot width < 240 and plot height ~135 px (< 140 px readout threshold).
        // With strip 36 px: ~135 - 36 = ~99 >= 80 -> 'strip'.
        // With strip 70 px: ~135 - 70 = ~65 < 80 -> 'none'.
        const room = { width: 220, height: 195 };
        const used = readout ? stripValue() : 0;
        return { width: room.width, height: room.height - used, room };
      },
      stripProbeMount() {
        mounted++;
        log.push(`mount:${label}`);
        return { label };
      },
      stripProbeRead() {
        stripReads++;
        log.push(`read:${label}`);
        if (failRead) throw new Error('probe read failed');
        return stripValue();
      },
      stripProbeRemove() {
        mounted--;
        log.push(`remove:${label}`);
      },
      devicePixelRatio: () => 1,
      theme(keys) {
        const series = keys.map((_, i) => `var(--axylo-series-color-${i + 1})`);
        return {
          bindings: { tokens: TOKEN_BINDINGS, series },
          theme: { scheme: 'light', forcedColors: false, moreContrast: false, paints: { tokens: { ...TOKEN_BINDINGS }, series } },
          resolved: true,
          backdropKnown: false,
        };
      },
      dispose() {},
    };
    return {
      host,
      stripReadCount: () => stripReads,
      mountedProbes: () => mounted,
      readoutModes: () => readoutModes,
    };
  }

  function runBatch(runs: FrameRun[]) {
    for (const r of runs) r.phase1();
    for (const r of runs) r.phase2();
    for (const r of runs) r.phase3Theme();
    for (const r of runs) r.phase3Measure();
    for (const r of runs) r.phase3Probe();
    let anyStrip = false;
    for (const r of runs) if (r.phase3LayoutCheck()) anyStrip = true;
    if (anyStrip) {
      for (const r of runs) r.phase3StripMount();
      try {
        for (const r of runs) r.phase3StripRead();
      } finally {
        for (const r of runs) r.phase3StripRemove();
      }
    }
    for (const r of runs) r.phase3ReadoutDecide();
    for (const r of runs) r.phase4StripWrite();
    for (const r of runs) r.phase4StripMeasure();
    for (const r of runs) r.phase4Init();
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const r of runs) if (r.phase4PassWrite()) moved = true;
      if (!moved) break;
      for (const r of runs) r.phase4PassMeasure();
    }
    for (const r of runs) r.phase5();
    for (const r of runs) r.after();
  }

  it('batches mount -> read -> remove across tiles and preserves distinct per-tile strip heights', () => {
    const log: string[] = [];
    const hA = makeSmallHost(() => 36, log, 'A');
    const hB = makeSmallHost(() => 70, log, 'B');
    const cA = createController('line', { title: 'A', data: sampleRows(), x: 'x', y: 'y' }, hA.host);
    const cB = createController('line', { title: 'B', data: sampleRows(), x: 'x', y: 'y' }, hB.host);

    const rA = cA.beginFrame()!;
    const rB = cB.beginFrame()!;
    runBatch([rA, rB]);

    // Phase A (all mounts) -> Phase B (all reads in 1 layout) -> Phase C (all removes).
    expect(log).toEqual(['mount:A', 'mount:B', 'read:A', 'read:B', 'remove:A', 'remove:B']);
    expect(hA.mountedProbes()).toBe(0);
    expect(hB.mountedProbes()).toBe(0);
    // Distinct per-tile CSS heights produced distinct readout decisions (no stale cross-tile caching).
    expect(hA.readoutModes().at(-1)).toBe('strip');
    expect(hB.readoutModes().at(-1)).toBe('none');
  });

  it('removes mounted strip probe even when stripProbeRead throws', () => {
    const log: string[] = [];
    const h = makeSmallHost(() => 40, log, 'err', true);
    const c = createController('line', { title: 'Err', data: sampleRows(), x: 'x', y: 'y' }, h.host);
    c.flush();
    expect(log).toEqual(['mount:err', 'read:err', 'remove:err']);
    expect(h.mountedProbes()).toBe(0);
  });

  it('invalidates cached stripStyle when invalidate.fonts() bumps fontEpoch', () => {
    const log: string[] = [];
    let currentStrip = 36;
    const h = makeSmallHost(() => currentStrip, log, 'F');
    const c = createController('line', { title: 'F', data: sampleRows(), x: 'x', y: 'y' }, h.host);

    c.flush();
    expect(h.stripReadCount()).toBe(1);
    expect(h.readoutModes().at(-1)).toBe('strip');

    // A regular update without resize or font load reuses stripHeight.
    c.handle.update({ title: 'F2' });
    c.flush();
    expect(h.stripReadCount()).toBe(1);

    // Web font load bumps fontEpoch: even with identical TextStyle object, stripHeight is re-measured.
    currentStrip = 70;
    c.invalidate.fonts();
    c.flush();
    expect(h.stripReadCount()).toBe(2);
    expect(h.readoutModes().at(-1)).toBe('none');
  });
});

// ── Requirement 2: 1-Frame Microtask Zoom Coalescing & Cancellation ─────────────────────────────

describe('1-frame microtask zoom flush (browser host only)', () => {
  function makeMicrotaskHost() {
    const rafQueue = new Map<number, (time?: number) => void>();
    const microtasks: (() => void)[] = [];
    let rafSeq = 0;
    let draws = 0;
    let disposed = false;
    let writesAfterDispose = 0;
    let lastTitle = '';
    let lastCommitted: Committed | null = null;
    const style: TextStyle = { font: '400 12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 15 };

    const host: Host = {
      id: 'zoom-test',
      console: null,
      page: {},
      timeZone: 'UTC',
      renderer: {
        kind: 'svg',
        draw() {
          if (disposed) writesAfterDispose++;
          draws++;
        },
      },
      text: {
        render() {
          if (disposed) writesAfterDispose++;
        },
      },
      figure: {
        update(model) {
          if (disposed) writesAfterDispose++;
          lastTitle = model.title?.text ?? '';
          return false;
        },
        announce() {},
      },
      interaction: {
        prepare: () => false,
        commit(state) {
          if (disposed) writesAfterDispose++;
          lastCommitted = state;
        },
        clear() {
          lastCommitted = null;
        },
      },
      measurer: { width: text => text.length * 7 },
      requestFrame(cb) {
        const id = ++rafSeq;
        rafQueue.set(id, cb);
        return id;
      },
      cancelFrame(id) {
        rafQueue.delete(id);
      },
      scheduleMicrotask(cb) {
        microtasks.push(cb);
      },
      locale: () => 'en-US',
      pageLang: () => 'en',
      labelText: () => null,
      textStyle: () => style,
      measure: () => ({ width: 600, height: 300 }),
      devicePixelRatio: () => 1,
      theme(keys) {
        const series = keys.map((_, i) => `var(--axylo-series-color-${i + 1})`);
        return {
          bindings: { tokens: TOKEN_BINDINGS, series },
          theme: { scheme: 'light', forcedColors: false, moreContrast: false, paints: { tokens: { ...TOKEN_BINDINGS }, series } },
          resolved: true,
          backdropKnown: false,
        };
      },
      dispose() {
        disposed = true;
      },
    };

    const controller = createController('line', { title: 'Initial', data: sampleRows(), x: 'x', y: 'y' }, host);
    const flushRaf = () => {
      const cbs = [...rafQueue.values()];
      rafQueue.clear();
      for (const cb of cbs) cb(16);
    };
    const flushMicrotasks = () => {
      while (microtasks.length) microtasks.shift()!();
    };
    return {
      controller,
      rafQueue,
      microtasks,
      flushRaf,
      flushMicrotasks,
      draws: () => draws,
      writesAfterDispose: () => writesAfterDispose,
      lastTitle: () => lastTitle,
      committed: () => lastCommitted,
    };
  }

  it('draws zoom asynchronously in a microtask before rAF (zero synchronous draws, settles ready)', async () => {
    const h = makeMicrotaskHost();
    // Initial create uses rAF (drawn === null).
    expect(h.rafQueue.size).toBe(1);
    expect(h.microtasks.length).toBe(0);
    h.flushRaf();
    expect(h.draws()).toBe(1);

    const beforeDraws = h.draws();
    h.controller.handle.zoom([2, 7]);
    // Critical invariant: zero synchronous draws.
    expect(h.draws()).toBe(beforeDraws);
    expect(h.rafQueue.size).toBe(0);
    expect(h.microtasks.length).toBe(1);

    let settled = false;
    const readyPromise = h.controller.handle.__bench!.ready().then(() => { settled = true; });
    h.flushMicrotasks();
    await readyPromise;

    expect(settled).toBe(true);
    expect(h.draws()).toBe(beforeDraws + 1);
    expect((h.committed()!.view as AlignedView).xDomain).toEqual([2, 7]);
  });

  it('coalesces multiple zoom calls in one turn into a single microtask draw', () => {
    const h = makeMicrotaskHost();
    h.flushRaf();
    const beforeDraws = h.draws();

    h.controller.handle.zoom([1, 8]);
    h.controller.handle.zoom([3, 6]);
    expect(h.draws()).toBe(beforeDraws);
    expect(h.microtasks.length).toBe(1);

    h.flushMicrotasks();
    expect(h.draws()).toBe(beforeDraws + 1);
    expect((h.committed()!.view as AlignedView).xDomain).toEqual([3, 6]);
  });

  it('update + append + zoom in one turn joins the existing rAF and draws once', () => {
    const h = makeMicrotaskHost();
    h.flushRaf();
    const beforeDraws = h.draws();

    h.controller.handle.update({ data: sampleRows() });
    h.controller.handle.append([{ x: 10, y: 105 }]);
    h.controller.handle.zoom([4, 10]);

    expect(h.draws()).toBe(beforeDraws);
    expect(h.rafQueue.size).toBe(1);
    expect(h.microtasks.length).toBe(0);

    h.flushRaf();
    expect(h.draws()).toBe(beforeDraws + 1);
    expect((h.committed()!.view as AlignedView).xDomain).toEqual([4, 10]);
  });

  it('zoom followed by update in one turn coalesces into the single pending microtask draw', () => {
    const h = makeMicrotaskHost();
    h.flushRaf();
    const beforeDraws = h.draws();

    h.controller.handle.zoom([2, 6]);
    h.controller.handle.update({ title: 'Zoomed' });

    expect(h.draws()).toBe(beforeDraws);
    expect(h.microtasks.length).toBe(1);
    expect(h.rafQueue.size).toBe(0);

    h.flushMicrotasks();
    expect(h.draws()).toBe(beforeDraws + 1);
    expect(h.lastTitle()).toBe('Zoomed');
    expect((h.committed()!.view as AlignedView).xDomain).toEqual([2, 6]);
  });

  it('cancels pending microtask zoom on destroy() and prevents stale microtasks after direct flush()', () => {
    // 1. destroy() cancels pending microtask zoom.
    const h1 = makeMicrotaskHost();
    h1.flushRaf();
    const d1 = h1.draws();
    h1.controller.handle.zoom([1, 5]);
    expect(h1.microtasks.length).toBe(1);
    h1.controller.handle.destroy();
    h1.flushMicrotasks();
    expect(h1.draws()).toBe(d1);
    expect(h1.writesAfterDispose()).toBe(0);

    // 2. Direct flush() followed by update() invalidates the old microtask token so update() stays on rAF.
    const h2 = makeMicrotaskHost();
    h2.flushRaf();
    h2.controller.handle.zoom([1, 5]);
    expect(h2.microtasks.length).toBe(1);
    h2.controller.flush();
    const afterDirectFlush = h2.draws();
    h2.controller.handle.update({ data: Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 50 })) });
    expect(h2.rafQueue.size).toBe(1);

    // Running the stale microtask from zoom must be a no-op and must NOT flush update()'s rAF early.
    h2.flushMicrotasks();
    expect(h2.draws()).toBe(afterDirectFlush);
    expect(h2.rafQueue.size).toBe(1);

    h2.flushRaf();
    expect(h2.draws()).toBe(afterDirectFlush + 1);
  });
});
