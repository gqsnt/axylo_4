/**
 * Server rendering (plan 1.7, spec DX8): each component renders its empty container in Node, where there is
 * no DOM, and no chart is created.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

const created: string[] = [];
// Bundled from source: the core's dist is not part of this package's tests. The spy shows that the
// server never calls a chart function.
vi.mock('axylo', async () => {
  const core = await import('../../axylo/src/index');
  const wrap = <F extends (...args: never[]) => unknown>(name: string, f: F) => ((...args: Parameters<F>) => { created.push(name); return f(...args); }) as F;
  return { ...core, line: wrap('line', core.line), area: wrap('area', core.area), bar: wrap('bar', core.bar), scatter: wrap('scatter', core.scatter), donut: wrap('donut', core.donut) };
});

const { Area, Bar, Donut, Line, Scatter } = await import('../src/index');

type Row = (typeof rows)[number];
const rows = [{ day: '2026-01-01', channel: 'Direct', sessions: 10, visits: 4 }, { day: '2026-01-02', channel: 'Direct', sessions: 12, visits: 5 }];

describe('server rendering', () => {
  it('runs without a DOM', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
  });

  const cases: [string, ReactElement][] = [
    ['Line', createElement(Line<Row>, { data: rows, x: 'day', y: 'sessions', series: 'channel', title: 'Sessions' })],
    ['Area', createElement(Area<Row>, { data: rows, x: 'day', y: 'sessions', stacked: true })],
    ['Bar', createElement(Bar<Row>, { data: rows, x: 'channel', y: 'sessions' })],
    ['Scatter', createElement(Scatter<Row>, { data: rows, x: 'visits', y: 'sessions' })],
    ['Donut', createElement(Donut<Row>, { data: rows, label: 'channel', value: 'sessions' })],
  ];

  for (const [name, element] of cases) {
    it(`${name} renders the empty container and creates no chart`, () => {
      created.length = 0;
      expect(renderToString(element)).toBe('<div class="axylo"></div>');
      expect(created).toEqual([]);
    });
  }

  it('passes className and style to the container', () => {
    const html = renderToString(createElement(Line<Row>, { data: rows, x: 'day', y: 'sessions', className: 'card wide', style: { height: 300 } }));
    expect(html).toBe('<div class="axylo card wide" style="height:300px"></div>');
  });

  it('marks the module as a client module', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(source.startsWith("'use client';")).toBe(true);
  });
});
