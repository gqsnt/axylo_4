/**
 * Stands in for `axylo` when the packed React adapter imports it (first-chart.browser.test.ts, StrictMode):
 * re-exports the packed core's chart functions, numbering every chart created and logging its creation,
 * its destruction and each event its listeners receive, so a test sees the adapter's lifecycle from outside.
 */
import * as real from 'axylo';

type Handle = { destroy(): void; on(event: string, listener: (payload: unknown) => void): () => void };
type Make = (target: unknown, options: unknown) => Handle;
const log: { id: number; what: string }[] = [];
const handles: Handle[] = [];
(window as unknown as { __spy: unknown }).__spy = { log, handles };

const wrap = (make: Make): Make => (target, options) => {
  const chart = make(target, options);
  handles.push(chart);
  const id = handles.length;
  log.push({ id, what: 'create' });
  const destroy = chart.destroy.bind(chart);
  chart.destroy = () => { log.push({ id, what: 'destroy' }); destroy(); };
  const on = chart.on.bind(chart);
  chart.on = (event, listener) => on(event, payload => { log.push({ id, what: `event:${event}` }); listener(payload); });
  return chart;
};

export const line = wrap(real.line as unknown as Make);
export const area = wrap(real.area as unknown as Make);
export const bar = wrap(real.bar as unknown as Make);
export const scatter = wrap(real.scatter as unknown as Make);
export const donut = wrap(real.donut as unknown as Make);
export const validate = real.validate;
