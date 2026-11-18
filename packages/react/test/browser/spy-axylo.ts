/**
 * Stands in for `axylo` in the browser test bundle (see open.ts): the real core, from source, with every
 * created chart recorded, so tests can count creates, `update` calls and destroys, and see thrown errors.
 * Charts and their elements are held weakly, so the record keeps nothing alive.
 */
import * as core from '../../../axylo/src/index';

export * from '../../../axylo/src/index';

type Handle = { update(patch: Record<string, unknown>): void; append(rows: unknown, options?: unknown): void; destroy(): void };

export interface Recorded {
  kind: string;
  element: WeakRef<HTMLElement>;
  chart: WeakRef<Handle>;
  updates: Record<string, unknown>[];
  appends: number;
  destroys: number;
}

export const spy = { attempts: 0, charts: [] as Recorded[], errors: [] as unknown[], failOn: false, failDestroy: false };

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
    const record: Recorded = { kind, element: new WeakRef(target), chart: new WeakRef(chart), updates: [], appends: 0, destroys: 0 };
    spy.charts.push(record);
    const { update, append, destroy } = chart;
    chart.append = function (rows, options) { record.appends++; append.call(this, rows, options); };
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
    const failDestroy = spy.failDestroy;
    spy.failDestroy = false;
    chart.destroy = function () {
      record.destroys++;
      destroy.call(this);
      if (failDestroy) throw new Error('destroy failed');
    };
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
