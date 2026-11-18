/**
 * Stands in for `axylo` in the browser test bundle (see open.ts): the real core, from source, with every
 * created chart recorded, so tests can count creates, `update` calls and destroys, and see thrown errors.
 * Charts and their elements are held weakly, so the record keeps nothing alive.
 */
import * as core from '../../../axylo/src/index';

export * from '../../../axylo/src/index';

type Handle = { update(patch: Record<string, unknown>): void; destroy(): void };

export interface Recorded {
  kind: string;
  element: WeakRef<HTMLElement>;
  chart: WeakRef<Handle>;
  updates: Record<string, unknown>[];
  destroys: number;
}

export const spy = { attempts: 0, charts: [] as Recorded[], errors: [] as unknown[], failOn: false };

function wrap<F>(kind: string, create: F): F {
  return ((target: HTMLElement, options: unknown) => {
    spy.attempts++;
    let chart: Handle;
    try {
      chart = (create as unknown as (t: HTMLElement, o: unknown) => Handle)(target, options);
    } catch (error) {
      spy.errors.push(error);
      throw error;
    }
    const record: Recorded = { kind, element: new WeakRef(target), chart: new WeakRef(chart), updates: [], destroys: 0 };
    spy.charts.push(record);
    const { update, destroy } = chart;
    // Called with the handle as receiver: plan 1.5 allows an implementation that uses `this`.
    chart.update = function (patch) {
      record.updates.push(patch);
      try {
        update.call(this, patch);
      } catch (error) {
        spy.errors.push(error);
        throw error;
      }
    };
    chart.destroy = function () { record.destroys++; destroy.call(this); };
    // For the adapter's own setup failure (finding 13): the chart exists, then listener registration throws.
    if (spy.failOn) {
      spy.failOn = false;
      (chart as unknown as { on: () => never }).on = () => { throw new Error('listener registration failed'); };
    }
    return chart;
  }) as F;
}

export const line = wrap('line', core.line);
export const area = wrap('area', core.area);
export const bar = wrap('bar', core.bar);
export const scatter = wrap('scatter', core.scatter);
export const donut = wrap('donut', core.donut);
