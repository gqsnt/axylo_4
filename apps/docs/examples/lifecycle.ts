import { line, type Chart, type LineOptions } from 'axylo';

// The three moments any framework gives a component: its element exists, its inputs change, its
// element goes away. Hook these three functions to them.
interface Row { day: string; sessions: number }

let chart: Chart<Row, LineOptions<Row>> | null = null;

/** The element exists: create the chart in it. */
export function mount(element: HTMLElement, data: readonly Row[]): void {
  chart = line(element, { title: 'Daily sessions', data, x: 'day', y: 'sessions' });
}

/** The data changed: update the chart that exists. Creating a second chart is never needed. */
export function refresh(data: readonly Row[]): void {
  chart?.update({ data });
}

/** The element goes away: destroy the chart, which removes everything it added and its listeners. */
export function unmount(): void {
  chart?.destroy();
  chart = null;
}

// The rest drives the three functions as a page would.
/** @returns seven days of March, starting on day `start` */
const week = (start: number): Row[] => Array.from({ length: 7 }, (_, i) => ({
  day: `2026-03-${String(start + i).padStart(2, '0')}`,
  sessions: 3000 + 100 * ((start + i) % 5),
}));

const element = document.getElementById('chart');
if (!element) throw new Error('#chart is missing from the page');

// A framework's development mode mounts, unmounts and mounts again on the same element. That is supported:
// the element ends with one chart.
mount(element, week(2));
unmount();
mount(element, week(2));

// New data later: the same chart shows it.
refresh(week(9));
