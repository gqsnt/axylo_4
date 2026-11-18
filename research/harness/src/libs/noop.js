// Measurement floor: an adapter that draws nothing. Whatever main-thread time the probe reports for this is the harness and the browser, not a chart.
export const meta = { name: 'No chart (measurement floor)', pkg: null };
export function scale(el) { el.textContent = ''; return { destroy() {} }; }
export function stream(el) { return { push() {}, destroy() {} }; }
