// Plain Node, no DOM globals (spec DX8): import the packed package by name from this fixture and run
// validate() on the Phase 1 combined `dirty` fixture (spec 3.5; plan 1.6). Prints one JSON line.
// Run by tests/dist/node.test.ts, with and without --conditions=development.
const domGlobals = ['window', 'document', 'navigator', 'HTMLElement', 'ResizeObserver', 'requestAnimationFrame']
  .filter(name => name in globalThis);
const before = new Set(Object.getOwnPropertyNames(globalThis));

const resolved = import.meta.resolve('axylo');
const axylo = await import('axylo');
const addedGlobals = Object.getOwnPropertyNames(globalThis).filter(name => !before.has(name));

// Mon–Sun: 10, 20, null, NaN, '40', absent, 70.
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const values = [10, 20, null, NaN, '40', undefined, 70];
const rows = days.map((day, i) => (values[i] === undefined ? { day } : { day, value: values[i] }));
const diagnostics = axylo.validate('line', { title: 'Dirty input', data: rows, x: 'day', y: 'value' });

let missingTarget = null;
try {
  axylo.line('#nowhere', { title: 'T', data: rows, x: 'day', y: 'value' });
} catch (error) {
  missingTarget = String(error?.message ?? error);
}

console.log(JSON.stringify({ domGlobals, resolved, exports: Object.keys(axylo).sort(), addedGlobals, diagnostics, missingTarget }));
