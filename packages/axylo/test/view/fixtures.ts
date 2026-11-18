import { normalize, resolveOptions } from '../../src/data';
import { DiagnosticCollector } from '../../src/diagnostics';
import { buildView, type AlignedViewState, type DonutViewState, type ScatterViewState } from '../../src/view';

const utc = { timeZone: 'UTC' };
const version = { revision: 8, epoch: 4 };

export function aligned(options: unknown, state: AlignedViewState) {
  const diagnostics = new DiagnosticCollector();
  const resolved = resolveOptions(state.kind, options, diagnostics);
  const frame = normalize(state.kind, resolved, utc, diagnostics, version);
  const view = buildView(frame, {
    xField: resolved.x, valueDomain: resolved.values[0]?.domain, ...state,
  }, diagnostics);
  return { frame, view, diagnostics };
}

export function scatter(options: unknown, state: Omit<ScatterViewState, 'kind'> = {}) {
  const diagnostics = new DiagnosticCollector();
  const resolved = resolveOptions('scatter', options, diagnostics);
  const frame = normalize('scatter', resolved, utc, diagnostics, version);
  const view = buildView(frame, {
    kind: 'scatter', xField: resolved.x, valueDomain: resolved.values[0]?.domain, valueScale: resolved.values[0]?.scale, ...state,
  }, diagnostics);
  return { frame, view, diagnostics };
}

export function donut(data: readonly { label: string; value: number | null }[], state: Partial<DonutViewState> = {}) {
  const diagnostics = new DiagnosticCollector();
  const options = resolveOptions('donut', { label: 'label', value: 'value', data }, diagnostics);
  const frame = normalize('donut', options, utc, diagnostics, version);
  const view = buildView(frame, { kind: 'donut', otherLabel: count => 'Other (' + count + ')', ...state }, diagnostics);
  return { frame, view, diagnostics };
}
