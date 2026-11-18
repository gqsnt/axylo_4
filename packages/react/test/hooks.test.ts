/**
 * Review C2: whether a component commits in the layout phase is decided when it first renders, not when the
 * module is imported, so a document installed later in the same runtime still gets the layout phase. React's
 * hooks are replaced by recorders and the component's render function is called directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const used: string[] = [];
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useImperativeHandle() {},
  useInsertionEffect() { used.push('insertion'); },
  useLayoutEffect() { used.push('layout'); },
  useEffect() { used.push('passive'); },
}));
vi.mock('axylo', () => ({ line() {}, area() {}, bar() {}, scatter() {}, donut() {} }));

type Rendered = { render(props: unknown, ref: unknown): unknown };
const { Line } = await import('../src/index') as unknown as { Line: Rendered };
const global = globalThis as { document?: unknown };

afterEach(() => { delete global.document; used.length = 0; });

describe('the commit hook', () => {
  it('is passive where there is no document', () => {
    expect(global.document).toBeUndefined();
    Line.render({ data: [] }, null);
    expect(used).not.toContain('layout');
  });

  it('is the layout effect when a document exists at first render, though it did not at import', () => {
    global.document = {};
    Line.render({ data: [] }, null);
    expect(used).toContain('layout');
  });
});
