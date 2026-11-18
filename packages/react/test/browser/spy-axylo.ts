/**
 * Stands in for `axylo` in the browser test bundle (see open.ts): the real core, from source, with every
 * created chart recorded, so tests can count creates, `update` calls and destroys.
 */
import * as core from '../../../axylo/src/index';

export * from '../../../axylo/src/index';

export interface Recorded {
  kind: string;
  element: HTMLElement;
  updates: Record<string, unknown>[];
  destroyed: boolean;
}

export const spy = { attempts: 0, charts: [] as Recorded[] };

type Handle = { update(patch: Record<string, unknown>): void; destroy(): void };

function wrap<F>(kind: string, create: F): F {
  return ((target: HTMLElement, options: unknown) => {
    spy.attempts++;
    const chart = (create as unknown as (t: HTMLElement, o: unknown) => Handle)(target, options);
    const record: Recorded = { kind, element: target, updates: [], destroyed: false };
    spy.charts.push(record);
    const { update, destroy } = chart;
    chart.update = patch => { record.updates.push(patch); update(patch); };
    chart.destroy = () => { record.destroyed = true; destroy(); };
    return chart;
  }) as F;
}

export const line = wrap('line', core.line);
export const area = wrap('area', core.area);
export const bar = wrap('bar', core.bar);
export const scatter = wrap('scatter', core.scatter);
export const donut = wrap('donut', core.donut);
